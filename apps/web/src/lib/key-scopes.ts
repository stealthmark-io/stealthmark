/**
 * Console keys report agent events from the SDK and nothing else. Wildcard, admin and platform scopes are never
 * minted here: this route writes straight to the database, so it is the only gate between a customer and a key
 * the API would treat as privileged.
 */
export const ALLOWED_KEY_SCOPES: readonly string[] = ['usage:ingest'];

export function parseScopes(raw: unknown): string[] | null {
  if (raw === undefined) return [...ALLOWED_KEY_SCOPES];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const scopes: string[] = [];
  for (const scope of raw) {
    if (typeof scope !== 'string' || !ALLOWED_KEY_SCOPES.includes(scope)) return null;
    if (!scopes.includes(scope)) scopes.push(scope);
  }
  return scopes;
}
