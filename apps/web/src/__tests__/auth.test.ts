import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  base64UrlEncode,
  base64UrlDecode,
  signData,
  verifySignature,
  createSessionToken,
  verifySessionToken,
  hashOtpCode,
  generate6DigitOtp,
  internalAuthSecret,
  gatewayInternalSecret,
  type AuthUser,
} from '../lib/auth'

describe('StealthMark Autonomous Authentication Suite', () => {
  const sampleUser: AuthUser = {
    id: 'usr-12345',
    orgId: 'org-67890',
    email: 'dev@stealthmark.io',
    name: 'Dev Lead',
    avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
    provider: 'github',
    role: 'owner',
  }

  describe('1. Base64URL and Cryptographic Primitives', () => {
    it('correctly encodes and decodes strings and buffers without padding issues', () => {
      const original = 'StealthMark::WebCrypto::AgentProtocol'
      const encoded = base64UrlEncode(original)
      expect(encoded).not.toContain('+')
      expect(encoded).not.toContain('/')
      expect(encoded).not.toContain('=')

      const decoded = base64UrlDecode(encoded)
      expect(decoded).toBe(original)
    })

    it('signs and verifies HMAC-SHA256 signatures with Web Crypto API', async () => {
      const payload = 'session_payload_sample_data'
      const sig = await signData(payload)

      const isValid = await verifySignature(payload, sig)
      expect(isValid).toBe(true)

      const isInvalid = await verifySignature(payload + '_tampered', sig)
      expect(isInvalid).toBe(false)
    })
  })

  describe('2. Session Token Lifecycle (HMAC-SHA256)', () => {
    it('creates and verifies a valid cryptographic session token', async () => {
      const token = await createSessionToken(sampleUser, 60000)
      expect(token).toContain('.')

      const verified = await verifySessionToken(token)
      expect(verified).not.toBeNull()
      expect(verified?.user.email).toBe('dev@stealthmark.io')
      expect(verified?.user.provider).toBe('github')
      expect(verified?.user.role).toBe('owner')
      expect(verified?.exp).toBeGreaterThan(Date.now())
    })

    it('rejects tampered session tokens', async () => {
      const token = await createSessionToken(sampleUser)
      const [payload, sig] = token.split('.')

      // Tamper payload
      const tamperedPayload = base64UrlEncode(JSON.stringify({ user: { ...sampleUser, role: 'superadmin' } }))
      const tamperedToken = `${tamperedPayload}.${sig}`

      const verified = await verifySessionToken(tamperedToken)
      expect(verified).toBeNull()
    })

    it('rejects expired session tokens', async () => {
      // Token expired 1 second ago
      const token = await createSessionToken(sampleUser, -1000)
      const verified = await verifySessionToken(token)
      expect(verified).toBeNull()
    })

    it('rejects malformed tokens gracefully', async () => {
      expect(await verifySessionToken('')).toBeNull()
      expect(await verifySessionToken('random-gibberish')).toBeNull()
      expect(await verifySessionToken('bad.payload.extra')).toBeNull()
    })
  })

  describe('3. OTP code helpers', () => {
    it('generates a 6-digit numeric code', () => {
      for (let i = 0; i < 20; i++) {
        const otp = generate6DigitOtp()
        expect(otp).toMatch(/^\d{6}$/)
        expect(otp.length).toBe(6)
      }
    })

    it('hashes a code bound to the email, case and whitespace insensitive', async () => {
      const hash = await hashOtpCode('Researcher@Agentic.ai ', '482910')
      expect(hash).toBe(await hashOtpCode('researcher@agentic.ai', ' 482910 '))
      expect(hash).not.toBe(await hashOtpCode('researcher@agentic.ai', '482911'))
      expect(hash).not.toBe(await hashOtpCode('other@agentic.ai', '482910'))
      expect(hash).not.toContain('482910')
    })
  })

  describe('4. Production secrets', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('rejects the development fallbacks in production even though they are long enough', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('AUTH_SECRET', 'dev_stealthmark_session_secret_key_32bytes_min')
      vi.stubEnv('INTERNAL_AUTH_SECRET', 'dev_internal_auth_secret_key_12345')
      vi.stubEnv('GATEWAY_INTERNAL_SECRET', 'dev_gateway_internal_secret_key_12345')

      await expect(signData('payload')).rejects.toThrow('AUTH_SECRET must be set to a non-default value')
      expect(() => internalAuthSecret()).toThrow('INTERNAL_AUTH_SECRET must be set to a non-default value')
      expect(() => gatewayInternalSecret()).toThrow('GATEWAY_INTERNAL_SECRET must be set to a non-default value')
    })

    it('accepts any other secret of at least 32 characters in production', () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('INTERNAL_AUTH_SECRET', 'test-internal-secret-for-vitest-only-0123456789')
      expect(internalAuthSecret()).toBe('test-internal-secret-for-vitest-only-0123456789')
    })

    it('keeps the development fallback outside production', () => {
      vi.stubEnv('NODE_ENV', 'development')
      vi.stubEnv('INTERNAL_AUTH_SECRET', '')
      expect(internalAuthSecret()).toBe('dev_internal_auth_secret_key_12345')
    })
  })
})
