import assert from 'node:assert/strict'
import test from 'node:test'
import {
  JSONRPC_INTERNAL_ERROR, JSONRPC_INVALID_PARAMS, JSONRPC_INVALID_REQUEST, JSONRPC_METHOD_NOT_FOUND,
  LEGACY_PROTOCOL_VERSIONS, MAX_BATCH, MCP_HEADER_MISMATCH, MCP_UNSUPPORTED_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS, ToolError, decodeHeaderValue, handleMessage, handlePost, type McpServer,
} from '../src/lib/mcp-protocol.ts'

interface Ctx { scopes: string[] }

const server: McpServer<Ctx> = {
  name: 'test',
  version: '0.0.1',
  instructions: 'test server',
  tools: [
    {
      name: 'echo',
      title: 'Echo',
      description: 'Returns its arguments',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
      allowed: () => true,
      deniedMessage: '',
      call: async (args) => ({ args }),
    },
    {
      name: 'secret',
      title: 'Secret',
      description: 'Needs a scope',
      inputSchema: { type: 'object' },
      annotations: {},
      allowed: (ctx) => ctx.scopes.includes('secret'),
      deniedMessage: 'missing scope',
      call: async () => ({ ok: true }),
    },
    {
      name: 'fails',
      title: 'Fails',
      description: 'Throws',
      inputSchema: { type: 'object' },
      annotations: {},
      allowed: () => true,
      deniedMessage: '',
      call: async (args) => {
        if (args.kind === 'tool') throw new ToolError('bad input')
        throw new Error('database exploded')
      },
    },
  ],
}

const ctx: Ctx = { scopes: [] }
const rpc = (method: string, params?: unknown, id: unknown = 1) => ({ jsonrpc: '2.0', id, method, params })

test('initialize echoes a supported protocol version and advertises tools', async () => {
  const res = await handleMessage(server, rpc('initialize', { protocolVersion: '2025-03-26' }), ctx)
  assert.deepEqual(res, {
    jsonrpc: '2.0',
    id: 1,
    result: {
      protocolVersion: '2025-03-26',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'test', version: '0.0.1' },
      instructions: 'test server',
    },
  })
})

test('initialize falls back to the newest handshake version for unknown ones', async () => {
  for (const requested of ['1999-01-01', '2026-07-28']) {
    const res = await handleMessage(server, rpc('initialize', { protocolVersion: requested }), ctx)
    assert.equal((res?.result as { protocolVersion: string }).protocolVersion, LEGACY_PROTOCOL_VERSIONS[0])
  }
})

test('ping returns an empty result', async () => {
  assert.deepEqual(await handleMessage(server, rpc('ping', undefined, 'abc'), ctx), { jsonrpc: '2.0', id: 'abc', result: {} })
})

test('notifications and client responses get no reply', async () => {
  assert.equal(await handleMessage(server, { jsonrpc: '2.0', method: 'notifications/initialized' }, ctx), null)
  assert.equal(await handleMessage(server, { jsonrpc: '2.0', id: 5, result: {} }, ctx), null)
})

test('malformed messages are invalid requests', async () => {
  for (const message of [null, 42, 'x', { id: 1, method: 'ping' }, { jsonrpc: '1.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 1 }]) {
    const res = await handleMessage(server, message, ctx)
    assert.equal(res?.error?.code, JSONRPC_INVALID_REQUEST, JSON.stringify(message))
  }
  assert.equal((await handleMessage(server, rpc('ping', undefined, { nested: true }), ctx))?.error?.code, JSONRPC_INVALID_REQUEST)
  assert.equal((await handleMessage(server, rpc('ping', []), ctx))?.error?.code, JSONRPC_INVALID_PARAMS)
})

test('unknown methods are reported', async () => {
  const res = await handleMessage(server, rpc('resources/list'), ctx)
  assert.equal(res?.error?.code, JSONRPC_METHOD_NOT_FOUND)
})

test('tools/list hides tools the context may not use', async () => {
  const names = async (c: Ctx) =>
    ((await handleMessage(server, rpc('tools/list'), c))?.result as { tools: { name: string }[] }).tools.map((t) => t.name)
  assert.deepEqual(await names({ scopes: [] }), ['echo', 'fails'])
  assert.deepEqual(await names({ scopes: ['secret'] }), ['echo', 'secret', 'fails'])
  const [echo] = ((await handleMessage(server, rpc('tools/list'), ctx))?.result as { tools: Record<string, unknown>[] }).tools
  assert.deepEqual(echo, {
    name: 'echo', title: 'Echo', description: 'Returns its arguments', inputSchema: { type: 'object' },
    annotations: { title: 'Echo', readOnlyHint: true },
  })
})

test('tools/call returns text and structured content', async () => {
  const res = await handleMessage(server, rpc('tools/call', { name: 'echo', arguments: { a: 1 } }), ctx)
  assert.deepEqual(res?.result, {
    content: [{ type: 'text', text: JSON.stringify({ args: { a: 1 } }, null, 2) }],
    structuredContent: { args: { a: 1 } },
    isError: false,
  })
  const noArgs = await handleMessage(server, rpc('tools/call', { name: 'echo' }), ctx)
  assert.deepEqual((noArgs?.result as { structuredContent: unknown }).structuredContent, { args: {} })
})

test('tools/call rejects unknown tools and non-object arguments', async () => {
  assert.equal((await handleMessage(server, rpc('tools/call', { name: 'nope' }), ctx))?.error?.code, JSONRPC_INVALID_PARAMS)
  assert.equal(
    (await handleMessage(server, rpc('tools/call', { name: 'echo', arguments: [1] }), ctx))?.error?.code,
    JSONRPC_INVALID_PARAMS,
  )
})

test('a disallowed tool is a tool error, not a protocol error', async () => {
  const res = await handleMessage(server, rpc('tools/call', { name: 'secret' }), ctx)
  assert.deepEqual(res?.result, { content: [{ type: 'text', text: 'missing scope' }], isError: true })
})

test('ToolError becomes an error result; other errors are internal and not leaked', async () => {
  const toolErr = await handleMessage(server, rpc('tools/call', { name: 'fails', arguments: { kind: 'tool' } }), ctx)
  assert.deepEqual(toolErr?.result, { content: [{ type: 'text', text: 'bad input' }], isError: true })

  const originalError = console.error
  console.error = () => {}
  try {
    const internal = await handleMessage(server, rpc('tools/call', { name: 'fails' }), ctx)
    assert.deepEqual(internal?.error, { code: JSONRPC_INTERNAL_ERROR, message: 'Internal error' })
  } finally {
    console.error = originalError
  }
})

test('legacy batches answer each request, skip notifications, and are size-limited', async () => {
  const headers = new Headers() // no version header: treated as 2025-03-26, the last version with batches
  const res = await handlePost(server, headers, [
    rpc('ping', undefined, 1),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    rpc('ping', undefined, 2),
  ], ctx)
  assert.deepEqual(res, { status: 200, body: [{ jsonrpc: '2.0', id: 1, result: {} }, { jsonrpc: '2.0', id: 2, result: {} }] })
  assert.deepEqual(await handlePost(server, headers, [{ jsonrpc: '2.0', method: 'notifications/initialized' }], ctx), { status: 202, body: null })
  assert.equal(((await handlePost(server, headers, [], ctx)).body as { error: { code: number } }).error.code, JSONRPC_INVALID_REQUEST)
  const tooMany = Array.from({ length: MAX_BATCH + 1 }, (_, i) => rpc('ping', undefined, i))
  assert.equal((await handlePost(server, headers, tooMany, ctx)).status, 400)
  const noBatches = await handlePost(server, new Headers({ 'mcp-protocol-version': '2025-06-18' }), [rpc('ping')], ctx)
  assert.equal(noBatches.status, 400)
})

test('legacy JSON-RPC errors are sent with HTTP 200', async () => {
  const res = await handlePost(server, new Headers({ 'mcp-protocol-version': '2025-11-25' }), rpc('nope'), ctx)
  assert.equal(res.status, 200)
  assert.equal((res.body as { error: { code: number } }).error.code, JSONRPC_METHOD_NOT_FOUND)
})

// ---------- protocol 2026-07-28 ----------

const MODERN = '2026-07-28'
const meta = (version = MODERN) => ({
  'io.modelcontextprotocol/protocolVersion': version,
  'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
})
const modernRpc = (method: string, params: Record<string, unknown> = {}, id: unknown = 1) =>
  ({ jsonrpc: '2.0', id, method, params: { ...params, _meta: meta() } })
const modernHeaders = (method: string, name?: string, extra: Record<string, string> = {}) =>
  new Headers({ 'mcp-protocol-version': MODERN, 'mcp-method': method, ...(name === undefined ? {} : { 'mcp-name': name }), ...extra })
const post = (body: Record<string, unknown>, headers?: Headers) => {
  const params = body.params as { name?: string } | undefined
  return handlePost(server, headers ?? modernHeaders(body.method as string, params?.name), body, ctx)
}
const errorCode = (reply: { body: unknown }) => (reply.body as { error: { code: number } }).error.code

test('server/discover advertises versions, capabilities, identity, and cache hints', async () => {
  const res = await post(modernRpc('server/discover'))
  assert.equal(res.status, 200)
  assert.deepEqual((res.body as { result: unknown }).result, {
    resultType: 'complete',
    supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
    capabilities: { tools: {} },
    instructions: 'test server',
    ttlMs: 3_600_000,
    cacheScope: 'public',
    _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'test', version: '0.0.1' } },
  })
  assert.equal(SUPPORTED_PROTOCOL_VERSIONS[0], MODERN)
})

test('modern tools/list and tools/call carry resultType, serverInfo, and private cache hints', async () => {
  const list = (await post(modernRpc('tools/list'))).body as { result: Record<string, unknown> }
  assert.equal(list.result.resultType, 'complete')
  assert.equal(list.result.ttlMs, 300_000)
  assert.equal(list.result.cacheScope, 'private', 'the list depends on the caller\'s scopes')
  assert.deepEqual(list.result._meta, { 'io.modelcontextprotocol/serverInfo': { name: 'test', version: '0.0.1' } })
  assert.deepEqual((list.result.tools as { name: string }[]).map((t) => t.name), ['echo', 'fails'])

  const call = await post(modernRpc('tools/call', { name: 'echo', arguments: { a: 1 } }))
  assert.equal(call.status, 200)
  const result = (call.body as { result: Record<string, unknown> }).result
  assert.equal(result.resultType, 'complete')
  assert.deepEqual(result.structuredContent, { args: { a: 1 } })
  assert.ok(result._meta)

  const toolError = await post(modernRpc('tools/call', { name: 'fails', arguments: { kind: 'tool' } }))
  assert.equal(toolError.status, 200, 'tool errors are results, not protocol errors')
  assert.equal((toolError.body as { result: { isError: boolean; resultType: string } }).result.isError, true)
})

test('modern requests must carry the required _meta fields', async () => {
  for (const bad of [undefined, {}, { 'io.modelcontextprotocol/protocolVersion': MODERN }, {
    'io.modelcontextprotocol/clientCapabilities': {},
  }]) {
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: bad === undefined ? {} : { _meta: bad } }
    const res = await post(body)
    assert.equal(res.status, 400, JSON.stringify(bad))
    assert.equal(errorCode(res), JSONRPC_INVALID_PARAMS)
  }
})

test('unsupported protocol versions list the supported ones', async () => {
  const res = await handlePost(server, new Headers({ 'mcp-protocol-version': '1900-01-01', 'mcp-method': 'tools/list' }), modernRpc('tools/list'), ctx)
  assert.equal(res.status, 400)
  assert.deepEqual((res.body as { error: unknown }).error, {
    code: MCP_UNSUPPORTED_PROTOCOL_VERSION,
    message: 'Unsupported protocol version',
    data: { supported: SUPPORTED_PROTOCOL_VERSIONS, requested: '1900-01-01' },
  })
  assert.equal((res.body as { id: number }).id, 1)
})

test('mirrored headers must be present and match the body', async () => {
  const listBody = modernRpc('tools/list')
  const callBody = modernRpc('tools/call', { name: 'echo', arguments: {} })
  const cases: [Record<string, unknown>, Headers][] = [
    [listBody, new Headers({ 'mcp-protocol-version': MODERN })], // no Mcp-Method
    [listBody, modernHeaders('tools/call')], // wrong method
    [callBody, modernHeaders('tools/call')], // no Mcp-Name
    [callBody, modernHeaders('tools/call', 'fails')], // wrong name
    [callBody, modernHeaders('tools/call', '=?base64?not base64!?=')], // undecodable
    [{ ...listBody, params: { _meta: meta('2025-11-25') } }, modernHeaders('tools/list')], // _meta version differs
  ]
  for (const [body, headers] of cases) {
    const res = await handlePost(server, headers, body, ctx)
    assert.equal(res.status, 400, JSON.stringify([...headers]))
    assert.equal(errorCode(res), MCP_HEADER_MISMATCH)
  }
  const encoded = await handlePost(server, modernHeaders('tools/call', `=?base64?${btoa('echo')}?=`), callBody, ctx)
  assert.equal(encoded.status, 200, 'base64-encoded Mcp-Name is decoded before comparing')
})

test('decodeHeaderValue handles the base64 sentinel and UTF-8', () => {
  assert.equal(decodeHeaderValue('us-west1'), 'us-west1')
  assert.equal(decodeHeaderValue('=?base64?SGVsbG8sIOS4lueVjA==?='), 'Hello, 世界')
  assert.equal(decodeHeaderValue('=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?='), '=?base64?literal?=')
})

test('handshake-era methods are gone in 2026-07-28 and unknown methods are HTTP 404', async () => {
  for (const method of ['initialize', 'ping', 'resources/list']) {
    const res = await post(modernRpc(method))
    assert.equal(res.status, 404, method)
    assert.equal(errorCode(res), JSONRPC_METHOD_NOT_FOUND)
  }
})

test('modern bodies must be a single message, and notifications get 202', async () => {
  assert.equal((await handlePost(server, modernHeaders('tools/list'), [modernRpc('tools/list')], ctx)).status, 400)
  const note = await handlePost(server, new Headers({ 'mcp-protocol-version': MODERN }), { jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }, ctx)
  assert.deepEqual(note, { status: 202, body: null })
})
