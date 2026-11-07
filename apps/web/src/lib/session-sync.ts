/** Message shown when the browser login could not be turned into a StealthMark session cookie. */
export function describeSyncFailure(status: number, body: unknown): string {
  const reason =
    body !== null && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
      ? (body as { error: string }).error
      : null
  const detail = status > 0 ? `HTTP ${status}${reason ? ` · ${reason}` : ''}` : 'network error'
  return `Your StealthMark session could not be created (${detail}). Please try signing in again.`
}
