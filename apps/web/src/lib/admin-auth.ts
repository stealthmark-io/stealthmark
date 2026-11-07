import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createSupabaseServerClient } from './supabase/server';

export const FOUNDER_EMAIL = process.env.FOUNDER_EMAIL || 'founder@stealthmark.io';

/**
 * SuperAdmin email SHA-256 digests (zero plaintext personal identifiers in source).
 */
const SUPERADMIN_EMAIL_SHA256 = new Set([
  '3d8150f37f83e79ac9be99636856e6ffba3668daa0d977d6985d0ea79df98c93', // primary
  '6c8a85ed6ad250e74d9b650daa9b2a00425f84cbbf892e403795066dc66d8980', // founder@
  '77d61b8a3ccb4e1f81d1f332db5d8c1d6282a3966e181ff34cfbbbf1d76db195', // domain alias
  'b4f2dec14921966327556e93ff1fc122902093a0c7c9f87210fbbb1b5e7ea0d7', // legacy
]);

function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Emails with admin rights: checks ADMIN_EMAILS env variable or verified SHA-256 admin digests.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const configured = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (configured.length > 0 && configured.includes(normalized)) {
    return true;
  }

  const digest = createHash('sha256').update(normalized).digest('hex');
  return SUPERADMIN_EMAIL_SHA256.has(digest);
}

export const isSuperAdminEmail = isAdminEmail;

/** True when the request carries a Supabase session of an administrator. */
export async function hasFounderSession(): Promise<boolean> {
  const serverClient = await createSupabaseServerClient();
  if (!serverClient) return false;
  try {
    const {
      data: { user },
    } = await serverClient.auth.getUser();
    return isAdminEmail(user?.email);
  } catch {
    return false;
  }
}

/** Gate for the /admin pages: the founder session, or any visitor while developing locally. */
export async function canViewAdminPages(): Promise<boolean> {
  if (process.env.NODE_ENV === 'development') return true;
  return hasFounderSession();
}

export async function isAuthorizedAdmin(req: NextRequest): Promise<boolean> {
  // 1. Verify caller authorization via Supabase Session
  if (await hasFounderSession()) return true;

  // 2. Header override for internal trusted automation or operator key
  const adminSecret = req.headers.get('x-admin-key');
  const expectedSecret = process.env.ADMIN_SECRET_KEY;
  if (adminSecret && expectedSecret && safeEqual(adminSecret, expectedSecret)) {
    return true;
  }

  // 3. `next dev` on a developer machine. Never decided by a caller-supplied Host header or URL.
  return process.env.NODE_ENV === 'development';
}
