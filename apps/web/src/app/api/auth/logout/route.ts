import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SESSION_COOKIE_NAME, OTP_COOKIE_NAME, OAUTH_STATE_COOKIE_NAME } from '@/lib/auth'

export async function POST() {
  try {
    const cookieStore = await cookies()
    cookieStore.delete(SESSION_COOKIE_NAME)
    cookieStore.delete(OTP_COOKIE_NAME)
    cookieStore.delete(OAUTH_STATE_COOKIE_NAME)

    return NextResponse.json({ success: true, message: 'Logged out successfully' })
  } catch (error) {
    console.error('[Logout API Error]:', error)
    return NextResponse.json({ error: 'Failed to logout' }, { status: 500 })
  }
}
