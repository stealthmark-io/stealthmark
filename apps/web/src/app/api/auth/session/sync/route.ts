import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  createSessionToken,
  upsertUserInBackend,
  SESSION_COOKIE_NAME,
} from '@/lib/auth'
import { verifiedSupabaseEmail } from '@/lib/verified-email'
import { isOwnerEmail } from '@/lib/owner-allowlist'
import { readBodyText } from '@/lib/request-body'

const MAX_BODY_BYTES = 8 * 1024

export async function POST(request: Request) {
  try {
    const raw = await readBodyText(request, MAX_BODY_BYTES)
    if (raw === null) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }
    let body: { accessToken?: unknown } | null
    try {
      body = JSON.parse(raw)
    } catch {
      body = null
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const { accessToken } = body

    if (typeof accessToken !== 'string' || !accessToken) {
      return NextResponse.json(
        { error: 'Missing access token for session sync' },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()
    if (!supabase) {
      return NextResponse.json(
        { error: 'Supabase server client not configured' },
        { status: 500 }
      )
    }

    const { data: { user: sbUser }, error } = await supabase.auth.getUser(accessToken)
    if (error || !sbUser) {
      return NextResponse.json(
        { error: error?.message || 'Invalid or expired Supabase token' },
        { status: 401 }
      )
    }

    const email = verifiedSupabaseEmail(sbUser)
    if (!email) {
      return NextResponse.json({ error: 'email_not_verified' }, { status: 403 })
    }
    if (!isOwnerEmail(email)) {
      return NextResponse.json({ error: 'owner_access_only' }, { status: 403 })
    }
    const name =
      sbUser.user_metadata?.full_name ||
      sbUser.user_metadata?.name ||
      email.split('@')[0] ||
      'User'
    const avatarUrl =
      sbUser.user_metadata?.avatar_url || sbUser.user_metadata?.picture || null

    const rawProvider = sbUser.app_metadata?.provider || 'supabase'
    const provider: 'github' | 'google' | 'email' =
      rawProvider === 'github'
        ? 'github'
        : rawProvider === 'google'
        ? 'google'
        : 'email'

    // Upsert user and sync organization via Fastify backend (Opción A)
    const { user } = await upsertUserInBackend({
      email,
      name,
      avatarUrl,
      provider,
      externalId: sbUser.id,
    })

    // Issue cryptographic session cookie
    const cookieStore = await cookies()
    const sessionToken = await createSessionToken(user)
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })

    return NextResponse.json({ success: true, user })
  } catch (error) {
    console.error('[Session Sync Error]:', error)
    const code = error instanceof Error && error.message === 'account_provisioning_failed' ? error.message : 'session_sync_failed'
    return NextResponse.json({ error: code }, { status: 500 })
  }
}
