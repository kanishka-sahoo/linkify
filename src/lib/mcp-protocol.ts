/**
 * A stateless Model Context Protocol server over Streamable HTTP, with JSON
 * responses only (no SSE): every POST is answered in full, which suits
 * serverless hosting. Only the tools capability is offered.
 * https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
 *
 * Kept free of app imports so the protocol can be unit-tested without a database.
 */

/** Newest first; `initialize` answers with the client's version if listed here, else the newest. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

export const JSONRPC_PARSE_ERROR = -32700
export const JSONRPC_INVALID_REQUEST = -32600
export const JSONRPC_METHOD_NOT_FOUND = -32601
export const JSONRPC_INVALID_PARAMS = -32602
export const JSONRPC_INTERNAL_ERROR = -32603

/** Caps the database work one POST can trigger. */
export const MAX_BATCH = 20

type JsonRpcId = string | number | null

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string }
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

function errorResponse(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function toolResult(value: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: 'text', text: isError ? String(value.error) : JSON.stringify(value, null, 2) }],
    ...(isError ? {} : { structuredContent: value }),
    isError,
  }
}

/**
 * Handle one JSON-RPC message. Returns the response to send, or null for
 * notifications and client responses, which get none.
 */
export async function handleMessage<Ctx>(server: McpServer<Ctx>, message: unknown, ctx: Ctx): Promise<JsonRpcResponse | null> {
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

  switch (message.method) {
    case 'initialize': {
      const requested = params.protocolVersion
      const protocolVersion = typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0]
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: server.name, version: server.version },
          instructions: server.instructions,
        },
      }
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: server.tools.filter((tool) => tool.allowed(ctx)).map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: { title: tool.title, ...tool.annotations },
          })),
        },
      }
    case 'tools/call': {
      const tool = server.tools.find((t) => t.name === params.name)
      if (!tool) return errorResponse(id, JSONRPC_INVALID_PARAMS, `Unknown tool: ${String(params.name)}`)
      const args = params.arguments === undefined ? {} : params.arguments
      if (!isObject(args)) return errorResponse(id, JSONRPC_INVALID_PARAMS, 'arguments must be an object')
      if (!tool.allowed(ctx)) return { jsonrpc: '2.0', id, result: toolResult({ error: tool.deniedMessage }, true) }
      try {
        return { jsonrpc: '2.0', id, result: toolResult(await tool.call(args, ctx)) }
      } catch (err) {
        if (err instanceof ToolError) return { jsonrpc: '2.0', id, result: toolResult({ error: err.message }, true) }
        console.error(`mcp tool ${tool.name} failed`, err)
        return errorResponse(id, JSONRPC_INTERNAL_ERROR, 'Internal error')
      }
    }
    default:
      return errorResponse(id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${message.method}`)
  }
}

/**
 * Handle a POST body: one message or a batch. Returns the JSON to send, or
 * null when nothing needs a response (the transport then answers 202).
 */
export async function handleBody<Ctx>(server: McpServer<Ctx>, body: unknown, ctx: Ctx) {
  if (!Array.isArray(body)) return handleMessage(server, body, ctx)
  if (body.length === 0 || body.length > MAX_BATCH) {
    return errorResponse(null, JSONRPC_INVALID_REQUEST, `A batch must hold 1–${MAX_BATCH} messages`)
  }
  const responses: JsonRpcResponse[] = []
  for (const message of body) {
    const response = await handleMessage(server, message, ctx)
    if (response) responses.push(response)
  }
  return responses.length > 0 ? responses : null
}
