/**
 * Reads a request body up to maxBytes. Next.js route handlers put no cap on the body (proxyClientMaxBodySize covers
 * only the proxy, which skips /api), so request.json() and request.formData() would buffer whatever a client sends.
 * Returns null when the declared or the actual size passes the cap.
 */
export async function readBodyText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    return null;
  }
  return text + decoder.decode();
}
