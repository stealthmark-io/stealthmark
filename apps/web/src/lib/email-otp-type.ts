import type { EmailOtpType } from '@supabase/supabase-js';

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'];

/** Narrows the `type` query parameter of an auth link to a value Supabase understands, or null. */
export function parseEmailOtpType(raw: string | null): EmailOtpType | null {
  return EMAIL_OTP_TYPES.find((candidate) => candidate === raw) ?? null;
}
