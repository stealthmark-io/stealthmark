'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { AuthUser } from '@/lib/auth'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface AuthContextType {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  /** Decided by the server from its admin list; never derived from an email in the browser. */
  isAdmin: boolean
  loginWithGitHub: () => void
  loginWithGoogle: () => void
  sendOtp: (email: string) => Promise<{ success: boolean; message?: string; error?: string }>
  verifyOtp: (email: string, code: string) => Promise<{ success: boolean; user?: AuthUser; error?: string }>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  const refreshSession = useCallback(async () => {
    try {
      // 1. Check native StealthMark session
      const res = await fetch('/api/auth/session', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        if (data.authenticated && data.user) {
          setUser(data.user)
          setIsAdmin(data.isAdmin === true)
          return
        }
      }

      // 2. Development only: map a bare Supabase browser session. In production the server cookie
      // is the only source of truth; a client-side user has no organization and every API call fails.
      const supabase = process.env.NODE_ENV === 'production' ? null : createSupabaseBrowserClient()
      if (supabase) {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          const sbUser = session.user
          const rawProvider = sbUser.app_metadata?.provider || 'email'
          const provider: 'github' | 'google' | 'email' =
            rawProvider === 'github'
              ? 'github'
              : rawProvider === 'google'
              ? 'google'
              : 'email'

          const mappedUser: AuthUser = {
            id: sbUser.id,
            email: sbUser.email || '',
            name:
              sbUser.user_metadata?.full_name ||
              sbUser.user_metadata?.name ||
              sbUser.email?.split('@')[0] ||
              'User',
            avatarUrl:
              sbUser.user_metadata?.avatar_url ||
              sbUser.user_metadata?.picture ||
              null,
            provider,
            orgId: `org_${sbUser.id.replace(/-/g, '').slice(0, 12)}`,
            role: 'owner',
            createdAt: sbUser.created_at,
          }
          setUser(mappedUser)
          return
        }
      }

      setUser(null)
      setIsAdmin(false)
    } catch (err) {
      console.warn('[AuthContext] Session check warning:', err)
      setUser(null)
      setIsAdmin(false)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshSession()
  }, [refreshSession])

  const loginWithGitHub = async () => {
    const supabase = createSupabaseBrowserClient()
    if (supabase) {
      const redirectUrl = `${window.location.origin}/api/auth/callback/supabase`
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: redirectUrl,
        },
      })
      if (!error) return
      console.warn('[Auth] Supabase GitHub error:', error)
    }

    // Direct fallback only if Supabase client not present or failed
    window.location.href = '/api/auth/github'
  }

  const loginWithGoogle = async () => {
    const supabase = createSupabaseBrowserClient()
    if (supabase) {
      const redirectUrl = `${window.location.origin}/api/auth/callback/supabase`
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent select_account',
          },
        },
      })
      if (!error) return
      console.warn('[Auth] Supabase Google error, falling back to direct route:', error)
    }

    window.location.href = '/api/auth/google'
  }

  const sendOtp = async (email: string) => {
    const supabase = createSupabaseBrowserClient()
    if (supabase) {
      try {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            shouldCreateUser: true,
          },
        })
        if (!error) {
          return {
            success: true,
            message: 'Verification link or 6-digit code dispatched to your email.',
          }
        }
        console.warn('[Auth] Supabase OTP send warning, falling back to native OTP:', error.message)
      } catch (sbErr) {
        console.warn('[Auth] Supabase OTP exception:', sbErr)
      }
    }

    // Fallback to Native StealthMark Resend OTP
    try {
      const res = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to dispatch code' }
      }
      return { success: true, message: data.message }
    } catch {
      return { success: false, error: 'Network error communicating with auth server' }
    }
  }

  const verifyOtp = async (email: string, code: string) => {
    const supabase = createSupabaseBrowserClient()
    if (supabase) {
      try {
        const { data, error } = await supabase.auth.verifyOtp({
          email,
          token: code,
          type: 'email',
        })
        if (!error && data.session?.user) {
          const sbUser = data.session.user
          const mappedUser: AuthUser = {
            id: sbUser.id,
            email: sbUser.email || email,
            name: sbUser.user_metadata?.full_name || email.split('@')[0],
            avatarUrl: sbUser.user_metadata?.avatar_url || null,
            provider: 'email',
            orgId: `org_${sbUser.id.replace(/-/g, '').slice(0, 12)}`,
            role: 'owner',
            createdAt: sbUser.created_at,
          }
          setUser(mappedUser)
          return { success: true, user: mappedUser }
        }
      } catch (sbErr) {
        console.warn('[Auth] Supabase verify exception, falling back to native verify:', sbErr)
      }
    }

    // Fallback to Native StealthMark Verify
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      })
      const data = await res.json()
      if (!res.ok) {
        return { success: false, error: data.error || 'Verification failed' }
      }
      setUser(data.user)
      return { success: true, user: data.user }
    } catch {
      return { success: false, error: 'Network error verifying code' }
    }
  }

  const logout = async () => {
    try {
      const supabase = createSupabaseBrowserClient()
      if (supabase) {
        await supabase.auth.signOut()
      }
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (err) {
      console.warn('[AuthContext] Logout warning:', err)
    } finally {
      setUser(null)
      window.location.href = '/'
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        isAdmin,
        loginWithGitHub,
        loginWithGoogle,
        sendOtp,
        verifyOtp,
        logout,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
