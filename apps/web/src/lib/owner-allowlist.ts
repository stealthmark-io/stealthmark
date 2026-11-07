import { createHash } from 'node:crypto';

/**
 * SHA-256 digests of authorized StealthMark owner email addresses (lowercased & trimmed).
 * Storing SHA-256 digests keeps operator personal email addresses out of source and bundles.
 */
const OWNER_EMAIL_SHA256 = new Set<string>([
  '77d61b8a3ccb4e1f81d1f332db5d8c1d6282a3966e181ff34cfbbbf1d76db195',
  '2d567dff6e372d22463260a7a9992057bbb224bf7fb21b33b5a38c1131a47619',
  'd5d9ff80574131d8d249bb064026c3de1abad98ef376e38911d2c1854f258e9e',
  '3d8150f37f83e79ac9be99636856e6ffba3668daa0d977d6985d0ea79df98c93',
  'b4f2dec14921966327556e93ff1fc122902093a0c7c9f87210fbbb1b5e7ea0d7',
  'bb254fb40e5ae0149c939718c7bbe2d74c959cf1c607097ce5122a1f9442aded',
]);

export function sha256Email(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

export function isOwnerEmail(email: string): boolean {
  const clean = email.trim().toLowerCase();
  if (!clean) return false;
  if (clean.endsWith('@stealthmark.io')) return true;
  const extra = (process.env.STEALTHMARK_OWNER_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (extra.includes(clean)) return true;
  return OWNER_EMAIL_SHA256.has(sha256Email(clean));
}
