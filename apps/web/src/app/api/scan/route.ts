/**
 * `/api/scan?domain=` is the short form of the audit endpoint. The redirect is relative so it keeps the public
 * host behind the tunnel, and the audit route applies its own validation, rate limit and scan quota.
 */
export function GET(request: Request): Response {
  const { search } = new URL(request.url);
  return new Response(null, { status: 308, headers: { Location: `/api/scan/audit${search}` } });
}
