import { NextResponse } from 'next/server'
import { OTP_COOLDOWN_SECONDS, discardOtp, issueOtp, normalizeOtpEmail } from '@/lib/otp'
import { getOtpStore } from '@/lib/otp-store'
import { clientIp } from '@/lib/client-ip'
import { isOwnerEmail } from '@/lib/owner-allowlist'
import { readBodyText } from '@/lib/request-body'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_EMAIL_LENGTH = 254
const MAX_BODY_BYTES = 4 * 1024
const DEFAULT_FROM_ADDRESS = 'StealthMark <auth@stealthmark.io>'

function failure(status: number, error: string, retryAfterSeconds?: number): NextResponse {
  return NextResponse.json(
    { error },
    { status, headers: retryAfterSeconds ? { 'Retry-After': String(retryAfterSeconds) } : undefined },
  )
}

function codeEmailHtml(code: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #060709; color: #f1f5f9; padding: 40px 20px; text-align: center;">
      <div style="max-width: 480px; margin: 0 auto; background-color: #0d1017; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 36px; text-align: left;">
        <div style="margin-bottom: 20px;">
          <span style="font-size: 18px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">StealthMark</span>
        </div>
        <h2 style="font-size: 20px; font-weight: 600; color: #ffffff; margin: 0 0 8px 0;">Your sign-in code</h2>
        <p style="font-size: 13px; color: #94a3b8; line-height: 1.5; margin: 0 0 24px 0;">Use the 6-digit code below to sign in to the StealthMark console.</p>
        <div style="background-color: #060709; border: 1px solid rgba(6,182,212,0.4); border-radius: 12px; padding: 18px; text-align: center; margin-bottom: 24px;">
          <span style="font-family: 'SF Mono', Consolas, Monaco, monospace; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #22d3ee;">${code}</span>
        </div>
        <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 0 0 16px 0;">This code works once and expires in <strong>5 minutes</strong>. StealthMark never asks for it by phone or chat.</p>
        <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 20px 0;" />
        <p style="font-size: 11px; color: #475569; margin: 0;">If you did not request this, ignore this email. Nothing was changed on your account.</p>
      </div>
    </div>
  `
}

/** True when the provider accepted the message. */
async function sendCodeEmail(to: string, code: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_ADDRESS,
        to: [to],
        subject: `${code} is your StealthMark sign-in code`,
        html: codeEmailHtml(code),
      }),
    })
    if (!res.ok) console.warn('[OTP] Resend rejected the message with status', res.status)
    return res.ok
  } catch (err) {
    console.warn('[OTP] Resend request failed:', err)
    return false
  }
}

export async function POST(request: Request) {
  const raw = await readBodyText(request, MAX_BODY_BYTES)
  if (raw === null) return failure(413, 'The request body is too large.')
  let email: unknown
  try {
    ;({ email } = JSON.parse(raw))
  } catch {
    return failure(400, 'Send a JSON body with an email address.')
  }

  if (typeof email !== 'string' || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return failure(400, 'Please provide a valid email address.')
  }

  const store = getOtpStore()
  if (!store) return failure(503, 'Email sign-in is temporarily unavailable. Use GitHub or Google instead.')

  const normalizedEmail = normalizeOtpEmail(email)
  if (!isOwnerEmail(normalizedEmail)) {
    return failure(
      403,
      'Console access is restricted to authorized StealthMark operators. To audit a domain use /scan, or email security@stealthmark.io for a Deep Forensic Audit.',
    )
  }
  const issued = await issueOtp(store, normalizedEmail, clientIp(request))
  if (!issued.ok) {
    if (issued.reason === 'cooldown') return failure(429, `Wait ${OTP_COOLDOWN_SECONDS} seconds before requesting another code.`, OTP_COOLDOWN_SECONDS)
    if (issued.reason === 'email_limit' || issued.reason === 'ip_limit') return failure(429, 'Too many codes requested. Try again in an hour.', 3600)
    return failure(503, 'Email sign-in is temporarily unavailable. Use GitHub or Google instead.')
  }

  if (!process.env.RESEND_API_KEY && process.env.NODE_ENV === 'development') {
    console.info(`[OTP] development code for ${normalizedEmail}: ${issued.code}`)
  } else if (!(await sendCodeEmail(normalizedEmail, issued.code))) {
    await discardOtp(store, issued.challengeId)
    return failure(502, 'We could not send the email. Try again in a moment or use GitHub or Google.')
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL
  if (webhookUrl) {
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `Sign-in code requested for \`${normalizedEmail}\``,
        allowed_mentions: { parse: [] },
      }),
    }).catch((err) => console.warn('[OTP] Discord notification failed:', err))
  }

  return NextResponse.json({
    success: true,
    message: `A 6-digit code was sent to ${normalizedEmail}. It is valid for 5 minutes.`,
    email: normalizedEmail,
  })
}
