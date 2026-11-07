import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface StandardWebhookInput {
  secret: string;
  id: string;
  timestamp: string;
  signatureHeader: string;
  rawBody: string;
  nowMs?: number;
}

/**
 * Key candidates for a Standard Webhooks secret. A "whsec_<base64>" secret is
 * decoded to its key bytes; the raw UTF-8 bytes of the secret string are also
 * accepted because Polar's own SDK derives the key that way.
 */
function deriveKeys(secret: string): Buffer[] {
  const keys: Buffer[] = [];
  if (secret.startsWith('whsec_')) {
    const decoded = Buffer.from(secret.slice('whsec_'.length), 'base64');
    if (decoded.length > 0) keys.push(decoded);
  }
  keys.push(Buffer.from(secret, 'utf8'));
  return keys;
}

export function verifyStandardWebhook(input: StandardWebhookInput): boolean {
  const { secret, id, timestamp, signatureHeader, rawBody } = input;
  if (!secret || !id || !timestamp || !signatureHeader) return false;

  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const provided = signatureHeader
    .split(' ')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('v1,'))
    .map((entry) => Buffer.from(entry.slice(3), 'base64'))
    .filter((buf) => buf.length === 32);
  if (provided.length === 0) return false;

  const signedPayload = `${id}.${timestamp}.${rawBody}`;
  return deriveKeys(secret).some((key) => {
    const expected = createHmac('sha256', key).update(signedPayload).digest();
    return provided.some((candidate) => timingSafeEqual(expected, candidate));
  });
}
