import { cookies } from 'next/headers';
import { LOCAL_FALLBACK_ORG_ID, SESSION_COOKIE_NAME, verifySessionToken, type AuthUser } from '@/lib/auth';

export interface OrgSession {
  user: AuthUser;
  orgId: string;
}

/** Resolves the verified session cookie to a user bound to an organization, or null. */
export async function getOrgSession(): Promise<OrgSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  const user = payload?.user;
  if (!user || !user.id || !user.orgId) return null;
  // Sessions minted while the API was unreachable carry a synthesized org that has no row in production.
  if (process.env.NODE_ENV === 'production' && user.orgId === LOCAL_FALLBACK_ORG_ID) return null;

  return { user, orgId: user.orgId };
}
