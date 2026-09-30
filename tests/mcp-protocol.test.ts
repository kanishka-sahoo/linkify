import assert from 'node:assert/strict'
import test from 'node:test'
import {
  JSONRPC_INTERNAL_ERROR, JSONRPC_INVALID_PARAMS, JSONRPC_INVALID_REQUEST, JSONRPC_METHOD_NOT_FOUND, MAX_BATCH,
  SUPPORTED_PROTOCOL_VERSIONS, ToolError, handleBody, handleMessage, type McpServer,
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

test('initialize falls back to the newest version for unknown ones', async () => {
  const res = await handleMessage(server, rpc('initialize', { protocolVersion: '1999-01-01' }), ctx)
  assert.equal((res?.result as { protocolVersion: string }).protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0])
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

test('batches answer each request, skip notifications, and are size-limited', async () => {
  const res = await handleBody(server, [
    rpc('ping', undefined, 1),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    rpc('ping', undefined, 2),
  ], ctx)
  assert.deepEqual(res, [{ jsonrpc: '2.0', id: 1, result: {} }, { jsonrpc: '2.0', id: 2, result: {} }])
  assert.equal(await handleBody(server, [{ jsonrpc: '2.0', method: 'notifications/initialized' }], ctx), null)
  assert.equal((await handleBody(server, [], ctx) as { error: { code: number } }).error.code, JSONRPC_INVALID_REQUEST)
  const tooMany = Array.from({ length: MAX_BATCH + 1 }, (_, i) => rpc('ping', undefined, i))
  assert.equal((await handleBody(server, tooMany, ctx) as { error: { code: number } }).error.code, JSONRPC_INVALID_REQUEST)
})
