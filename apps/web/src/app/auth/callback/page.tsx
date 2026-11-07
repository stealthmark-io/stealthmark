'use client'

import { parseEmailOtpType } from '@/lib/email-otp-type'
import React, { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import { StealthMarkLogo } from '@/components/StealthMarkLogo'
import { Loader2, ShieldCheck, AlertCircle } from 'lucide-react'
import { describeSyncFailure } from '@/lib/session-sync'

function AuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refreshSession } = useAuth()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('Verifying cryptographic identity token...')

  useEffect(() => {
    let isMounted = true

    const processAuth = async () => {
      try {
        const supabase = createSupabaseBrowserClient()
        if (!supabase) {
          // If no Supabase client, refresh native session and redirect
          await refreshSession()
          router.replace('/console')
          return
        }

        // 1. Check if token_hash is in URL query parameters
        const tokenHash = searchParams.get('token_hash')
        const type = parseEmailOtpType(searchParams.get('type'))
        const code = searchParams.get('code')

        if (code) {
          setStatusText('Exchanging authorization code for session...')
          const { data, error } = await supabase.auth.exchangeCodeForSession(code)
          if (!error && data.session) {
            await syncAndRedirect(data.session.access_token)
            return
          }
        }

        if (tokenHash && type) {
          setStatusText('Verifying single-use email token...')
          const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
          if (!error && data.session) {
            await syncAndRedirect(data.session.access_token)
            return
          }
        }

        // 2. Check if access_token is in hash fragment (#access_token=...)
        if (typeof window !== 'undefined' && window.location.hash.includes('access_token')) {
          setStatusText('Parsing secure credentials from authorization provider...')
          // Give Supabase client a moment to auto-parse the hash fragment
          const { data: { session }, error: sessionError } = await supabase.auth.getSession()
          if (!sessionError && session) {
            await syncAndRedirect(session.access_token)
            return
          }
        }

        // 3. Fallback: Check existing session in Supabase client
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          await syncAndRedirect(session.access_token)
          return
        }

        // If nothing was found, show error after short grace period
        setTimeout(() => {
          if (isMounted) {
            setErrorMessage('No authentication token or authorization code was detected.')
          }
        }, 1500)
      } catch (err: unknown) {
        console.error('[Auth Callback] Error:', err)
        if (isMounted) {
          setErrorMessage(err instanceof Error && err.message ? err.message : 'Failed to complete authentication.')
        }
      }
    }

    const syncAndRedirect = async (accessToken: string) => {
      try {
        setStatusText('Issuing StealthMark enterprise session cookie...')
        const res = await fetch('/api/auth/session/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken }),
        })

        if (!res.ok) {
          const errData: unknown = await res.json().catch(() => ({}))
          console.warn('[Auth Callback] Session sync failed:', res.status, errData)
          if (isMounted) setErrorMessage(describeSyncFailure(res.status, errData))
          return
        }

        await refreshSession()
        router.replace('/console')
      } catch (syncErr) {
        console.warn('[Auth Callback] Sync fetch exception:', syncErr)
        if (isMounted) setErrorMessage(describeSyncFailure(0, null))
      }
    }

    processAuth()

    return () => {
      isMounted = false
    }
  }, [router, searchParams, refreshSession])

  return (
    <div className="min-h-screen bg-[#060709] flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Glows */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm bg-[#0d1017] border border-white/10 rounded-3xl p-8 backdrop-blur-2xl shadow-2xl relative z-10 text-center">
        <div className="flex justify-center mb-5">
          <StealthMarkLogo className="w-10 h-10" />
        </div>

        {errorMessage ? (
          <div className="space-y-4">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-base font-bold text-white">Authentication Verification Issue</h2>
            <p className="text-xs text-slate-400 leading-relaxed">{errorMessage}</p>
            <button
              onClick={() => router.replace('/login')}
              className="w-full py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs transition"
            >
              Return to Sign In
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center">
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
            </div>
            <h2 className="text-base font-bold text-white">Authenticating with StealthMark</h2>
            <p className="text-xs text-slate-400 font-mono leading-relaxed">{statusText}</p>
            <div className="inline-flex items-center gap-1.5 text-[11px] text-cyan-400 font-mono bg-cyan-500/10 px-3 py-1 rounded-full border border-cyan-500/20">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>TLS 1.3 Enterprise Handshake</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#060709] flex items-center justify-center text-slate-400 font-mono text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-400 mr-2" />
          <span>Verifying identity...</span>
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  )
}
