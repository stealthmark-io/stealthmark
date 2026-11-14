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
  let lockReleased = false;

  const releaseReaderLock = () => {
    if (!lockReleased) {
      lockReleased = true;
      try {
        reader.releaseLock();
      } catch {
        // already released or closed
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        releaseReaderLock();
        const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
        if (!contentType.includes('multipart/form-data')) {
          await request.body.cancel().catch(() => {});
        }
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    return null;
  } finally {
    releaseReaderLock();
  }
  return text + decoder.decode();
}
