/**
 * A POST whose body streams 4 KB chunks with no content-length, for routes that must stop reading at their cap.
 * The stream ends after 4 MB; pulls() says how many chunks the route asked for.
 */
export function endlessBodyRequest(url: string, headers: Record<string, string> = {}) {
  const chunk = new TextEncoder().encode(' '.repeat(4096));
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls > 1024) controller.close();
      else controller.enqueue(chunk);
    },
  });
  const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers, body: stream, duplex: 'half' };
  return { request: new Request(url, init), pulls: () => pulls };
}
