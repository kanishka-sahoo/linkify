/**
 * A Model Context Protocol server over Streamable HTTP, with JSON responses
 * only (no SSE): every POST is answered in full, which suits serverless
 * hosting. Only the tools capability is offered.
 *
 * Dual-era, as the spec permits: requests declaring protocol 2026-07-28 are
 * served statelessly (per-request `_meta`, `server/discover`, mirrored
 * headers), and older clients still get the `initialize` handshake.
 * https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
 * https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
 *
 * Kept free of app imports so the protocol can be unit-tested without a database.
 */

/** Versions carrying version and capabilities on every request, newest first. */
export const MODERN_PROTOCOL_VERSIONS = ['2026-07-28']
/** Versions that open with an `initialize` handshake, newest first. */
export const LEGACY_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
export const SUPPORTED_PROTOCOL_VERSIONS = [...MODERN_PROTOCOL_VERSIONS, ...LEGACY_PROTOCOL_VERSIONS]

/** Clients older than 2025-06-18 send no MCP-Protocol-Version header; the spec lets servers assume this. */
const HEADERLESS_VERSION = '2025-03-26'
/** JSON-RPC batches were allowed up to and including this version. */
const LAST_BATCH_VERSION = '2025-03-26'

export const JSONRPC_PARSE_ERROR = -32700
export const JSONRPC_INVALID_REQUEST = -32600
export const JSONRPC_METHOD_NOT_FOUND = -32601
export const JSONRPC_INVALID_PARAMS = -32602
export const JSONRPC_INTERNAL_ERROR = -32603
export const MCP_HEADER_MISMATCH = -32020
export const MCP_UNSUPPORTED_PROTOCOL_VERSION = -32022

/** Caps the database work one legacy batch POST can trigger. */
export const MAX_BATCH = 20

/** Cache hints (2026-07-28). Tool lists depend on the key's scopes, so they're private to it. */
const TOOLS_TTL_MS = 5 * 60 * 1000
const DISCOVER_TTL_MS = 60 * 60 * 1000

const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion'
const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities'
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo'

type JsonRpcId = string | number | null

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** A tool failure the model should see and can recover from (bad arguments, not found, …). */
export class ToolError extends Error {}

export interface McpTool<Ctx> {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
  /** Omitted from `tools/list` and refused by `tools/call` when this returns false. */
  allowed: (ctx: Ctx) => boolean
  /** Why the tool isn't allowed, reported to the model. */
  deniedMessage: string
  call: (args: Record<string, unknown>, ctx: Ctx) => Promise<Record<string, unknown>>
}

export interface McpServer<Ctx> {
  name: string
  version: string
  instructions: string
  tools: McpTool<Ctx>[]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isId = (value: unknown): value is string | number =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))

const isModern = (version: string) => MODERN_PROTOCOL_VERSIONS.includes(version)

function errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } }
}

function unsupportedVersion(id: JsonRpcId, requested: string) {
  return errorResponse(id, MCP_UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
    supported: SUPPORTED_PROTOCOL_VERSIONS,
    requested,
  })
}

function toolResult(value: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: 'text', text: isError ? String(value.error) : JSON.stringify(value, null, 2) }],
    ...(isError ? {} : { structuredContent: value }),
    isError,
  }
}

/**
 * Handle one JSON-RPC message sent under protocol `version`. Returns the
 * response to send, or null for notifications and client responses.
 */
export async function handleMessage<Ctx>(
  server: McpServer<Ctx>, message: unknown, ctx: Ctx, version = LEGACY_PROTOCOL_VERSIONS[0],
): Promise<JsonRpcResponse | null> {
  if (!isObject(message) || message.jsonrpc !== '2.0') {
    return errorResponse(isObject(message) && isId(message.id) ? message.id : null, JSONRPC_INVALID_REQUEST, 'Invalid Request')
  }
  if (typeof message.method !== 'string') {
    // A response to a server-initiated request; this server never sends any.
    if ('result' in message || 'error' in message) return null
    return errorResponse(isId(message.id) ? message.id : null, JSONRPC_INVALID_REQUEST, 'Invalid Request')
  }
  if (!('id' in message)) return null // notification: nothing to acknowledge
  if (!isId(message.id)) return errorResponse(null, JSONRPC_INVALID_REQUEST, 'Invalid Request')

  const id = message.id
  const params = message.params === undefined ? {} : message.params
  if (!isObject(params)) return errorResponse(id, JSONRPC_INVALID_PARAMS, 'params must be an object')

  const modern = isModern(version)
  if (modern) {
    // Stateless: every request declares its version and capabilities.
    const meta = params._meta
    if (!isObject(meta) || typeof meta[META_PROTOCOL_VERSION] !== 'string' || !isObject(meta[META_CLIENT_CAPABILITIES])) {
      return errorResponse(id, JSONRPC_INVALID_PARAMS, `_meta must include ${META_PROTOCOL_VERSION} and ${META_CLIENT_CAPABILITIES}`)
    }
    const declared = meta[META_PROTOCOL_VERSION] as string
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(declared)) return unsupportedVersion(id, declared)
    if (declared !== version) {
      return errorResponse(id, MCP_HEADER_MISMATCH, `Header mismatch: MCP-Protocol-Version header '${version}' does not match _meta value '${declared}'`)
    }
  }

  /** A successful response; modern results also carry `resultType` and identify the server. */
  const complete = (result: Record<string, unknown>): JsonRpcResponse => ({
    jsonrpc: '2.0',
    id,
    result: modern
      ? { resultType: 'complete', ...result, _meta: { [META_SERVER_INFO]: { name: server.name, version: server.version } } }
      : result,
  })

  switch (message.method) {
    case 'initialize': {
      if (modern) break // replaced by per-request _meta and server/discover
      const requested = params.protocolVersion
      const protocolVersion = typeof requested === 'string' && LEGACY_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : LEGACY_PROTOCOL_VERSIONS[0]
      return complete({
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server.name, version: server.version },
        instructions: server.instructions,
      })
    }
    case 'ping':
      if (modern) break // removed in 2026-07-28
      return complete({})
    case 'server/discover':
      return complete({
        supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
        capabilities: { tools: {} },
        instructions: server.instructions,
        ...(modern ? { ttlMs: DISCOVER_TTL_MS, cacheScope: 'public' } : {}),
      })
    case 'tools/list':
      return complete({
        tools: server.tools.filter((tool) => tool.allowed(ctx)).map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: { title: tool.title, ...tool.annotations },
        })),
        ...(modern ? { ttlMs: TOOLS_TTL_MS, cacheScope: 'private' } : {}),
      })
    case 'tools/call': {
      const tool = server.tools.find((t) => t.name === params.name)
      if (!tool) return errorResponse(id, JSONRPC_INVALID_PARAMS, `Unknown tool: ${String(params.name)}`)
      const args = params.arguments === undefined ? {} : params.arguments
      if (!isObject(args)) return errorResponse(id, JSONRPC_INVALID_PARAMS, 'arguments must be an object')
      if (!tool.allowed(ctx)) return complete(toolResult({ error: tool.deniedMessage }, true))
      try {
        return complete(toolResult(await tool.call(args, ctx)))
      } catch (err) {
        if (err instanceof ToolError) return complete(toolResult({ error: err.message }, true))
        console.error(`mcp tool ${tool.name} failed`, err)
        return errorResponse(id, JSONRPC_INTERNAL_ERROR, 'Internal error')
      }
    }
  }
  return errorResponse(id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${message.method}`)
}

/** Decodes the `=?base64?…?=` sentinel form clients use for header values that aren't plain ASCII. */
export function decodeHeaderValue(value: string) {
  const match = /^=\?base64\?(.*)\?=$/.exec(value)
  if (!match) return value
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0)))
}

/**
 * Checks the headers that 2026-07-28 clients mirror from the body, so
 * intermediaries routing on headers and this server agree on the request.
 * Returns an error message, or null when they match.
 */
function headerMismatch(headers: Headers, message: Record<string, unknown>) {
  const method = headers.get('mcp-method')
  if (method === null) return 'Missing Mcp-Method header'
  if (method !== message.method) return `Mcp-Method header '${method}' does not match body method '${String(message.method)}'`
  const nameSource = message.method === 'tools/call' || message.method === 'prompts/get'
    ? 'name'
    : message.method === 'resources/read' ? 'uri' : null
  if (!nameSource) return null
  const header = headers.get('mcp-name')
  if (header === null) return 'Missing Mcp-Name header'
  let name: string
  try {
    name = decodeHeaderValue(header)
  } catch {
    return 'Mcp-Name header is not valid base64-encoded UTF-8'
  }
  const expected = isObject(message.params) ? message.params[nameSource] : undefined
  if (name !== expected) return `Mcp-Name header '${name}' does not match body value '${String(expected)}'`
  return null
}

/** HTTP status for a JSON-RPC error under 2026-07-28, which maps protocol errors onto HTTP. */
function modernErrorStatus(code: number) {
  if (code === JSONRPC_METHOD_NOT_FOUND) return 404
  if (code === JSONRPC_INTERNAL_ERROR) return 500
  return 400
}

export interface HttpReply {
  status: number
  /** JSON to send, or null for an empty body. */
  body: unknown
}

/**
 * Handle an authenticated POST to the MCP endpoint whose body parsed as JSON:
 * pick the protocol era from the MCP-Protocol-Version header, apply that
 * era's transport rules, and dispatch.
 */
export async function handlePost<Ctx>(server: McpServer<Ctx>, headers: Headers, body: unknown, ctx: Ctx): Promise<HttpReply> {
  const version = headers.get('mcp-protocol-version') ?? HEADERLESS_VERSION
  const bodyId = isObject(body) && isId(body.id) ? body.id : null
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(version)) return { status: 400, body: unsupportedVersion(bodyId, version) }

  if (Array.isArray(body)) {
    if (version > LAST_BATCH_VERSION) {
      return { status: 400, body: errorResponse(null, JSONRPC_INVALID_REQUEST, `JSON-RPC batches are not supported in protocol ${version}`) }
    }
    if (body.length === 0 || body.length > MAX_BATCH) {
      return { status: 400, body: errorResponse(null, JSONRPC_INVALID_REQUEST, `A batch must hold 1–${MAX_BATCH} messages`) }
    }
    const responses: JsonRpcResponse[] = []
    for (const message of body) {
      const response = await handleMessage(server, message, ctx, version)
      if (response) responses.push(response)
    }
    return responses.length > 0 ? { status: 200, body: responses } : { status: 202, body: null }
  }

  // Header rules cover requests only; the spec defines none for notification POSTs.
  if (isModern(version) && isObject(body) && typeof body.method === 'string' && 'id' in body) {
    const mismatch = headerMismatch(headers, body)
    if (mismatch) return { status: 400, body: errorResponse(bodyId, MCP_HEADER_MISMATCH, `Header mismatch: ${mismatch}`) }
  }
  const response = await handleMessage(server, body, ctx, version)
  if (!response) return { status: 202, body: null }
  if (response.error) return { status: isModern(version) ? modernErrorStatus(response.error.code) : 200, body: response }
  return { status: 200, body: response }
}
