import type { FastifyRequest } from 'fastify'
import { eq, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

/**
 * Scopes that make a key a platform caller. '*' is deliberately absent: it means "every scope inside the key's own
 * organization", and the web console mints it for customers, so it must never reach across tenants.
 */
const ADMIN_SCOPES = ['admin', 'platform:admin']

export function hasAdminScope(request: FastifyRequest): boolean {
  const scopes = request.apiKey?.scopes ?? []
  return ADMIN_SCOPES.some((scope) => scopes.includes(scope))
}

export function isPlatformCaller(request: FastifyRequest): boolean {
  return Boolean(request.internalCaller) || hasAdminScope(request)
}

/**
 * A caller may only hand out scopes it already holds ('*' holds every non-admin scope of its own organization).
 * Platform callers (internal secret or admin scope) are the only ones who can mint 'admin' or 'platform:admin'.
 */
export function canGrantScopes(request: FastifyRequest, requestedScopes: readonly string[]): boolean {
  if (isPlatformCaller(request)) return true
  const held = new Set(request.apiKey?.scopes ?? [])
  const holdsAll = held.has('*')
  return requestedScopes.every((scope) => !ADMIN_SCOPES.includes(scope) && (holdsAll || held.has(scope)))
}

/** Resources without an organization belong to the platform: only admin keys or internal callers may touch them. */
export function isAuthorizedForOrg(
  request: FastifyRequest,
  resourceOrgId: string | null | undefined,
): boolean {
  if (isPlatformCaller(request)) return true
  if (!resourceOrgId) return false
  return request.orgId === resourceOrgId
}

/**
 * WHERE fragment that scopes a by-id lookup to the caller's organization.
 * Returns undefined for platform callers so `and(eq(table.id, id), orgScope(...))` keeps working unscoped for them.
 * Unauthorized rows simply do not match, so callers answer 404 and never reveal existence.
 */
export function orgScope(request: FastifyRequest, orgColumn: PgColumn): SQL | undefined {
  if (isPlatformCaller(request)) return undefined
  return eq(orgColumn, request.orgId ?? '')
}

export type OrgAccess =
  | { ok: true; orgId: string }
  | { ok: false; status: 400 | 401 | 403; body: { error: string; message: string } }

/**
 * Resolves which organization a request may act on.
 * Identity always comes from the authenticated API key (or the internal bootstrap secret).
 * A client-supplied orgId is honored only when it matches that identity or the key carries an admin scope.
 */
export function resolveOrgAccess(
  request: FastifyRequest,
  requestedOrgId?: string | null,
): OrgAccess {
  const callerOrgId = request.orgId

  if (!callerOrgId && !request.internalCaller) {
    return {
      ok: false,
      status: 401,
      body: { error: 'unauthorized', message: 'Authentication required' },
    }
  }

  if (requestedOrgId) {
    if (isAuthorizedForOrg(request, requestedOrgId)) {
      return { ok: true, orgId: requestedOrgId }
    }
    return {
      ok: false,
      status: 403,
      body: { error: 'forbidden', message: 'API key is not authorized for the requested organization' },
    }
  }

  if (!callerOrgId) {
    return {
      ok: false,
      status: 400,
      body: { error: 'bad_request', message: 'orgId is required for internal callers' },
    }
  }

  return { ok: true, orgId: callerOrgId }
}
