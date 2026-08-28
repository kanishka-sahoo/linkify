export class BodyTooLargeError extends Error {}

export async function readBodyLimited(request: Request, maxBytes: number) {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError()
  if (!request.body) return ''

  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new BodyTooLargeError()
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

export async function readJsonLimited(request: Request, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readBodyLimited(request, maxBytes))
}
