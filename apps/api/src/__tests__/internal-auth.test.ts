import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { config } from '../config.js'
import { users } from '@stealthmark/db'

describe('Internal Auth Routes — POST /internal/auth/upsert-user', () => {
  const internalSecret = config.INTERNAL_AUTH_SECRET

  it('rejects requests with missing or invalid internal secret (401)', async () => {
    const mockDb = {} as any
    const app = await buildApp({ db: mockDb })

    const resNoSecret = await app.inject({
      method: 'POST',
      url: '/internal/auth/upsert-user',
      payload: {
        email: 'dev@example.com',
        provider: 'github',
      },
    })
    expect(resNoSecret.statusCode).toBe(401)
    expect(resNoSecret.json().error).toBe('unauthorized')

    const resBadSecret = await app.inject({
      method: 'POST',
      url: '/internal/auth/upsert-user',
      headers: {
        'x-internal-secret': 'wrong-secret',
      },
      payload: {
        email: 'dev@example.com',
        provider: 'github',
      },
    })
    expect(resBadSecret.statusCode).toBe(401)

    await app.close()
  })

  it('rejects invalid payload (400)', async () => {
    const mockDb = {} as any
    const app = await buildApp({ db: mockDb })

    const res = await app.inject({
      method: 'POST',
      url: '/internal/auth/upsert-user',
      headers: {
        'x-internal-secret': internalSecret,
      },
      payload: {
        email: 'not-an-email',
        provider: 'unsupported_provider',
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('validation_error')

    await app.close()
  })

  it('creates new org and user when user does not exist (201)', async () => {
    const sampleOrg = {
      id: '11111111-1111-1111-1111-111111111111',
      name: "Alex Dev's Workspace",
      slug: 'alex-dev-a1b2c3d4',
      plan: 'free',
      status: 'active',
    }

    const sampleUser = {
      id: '22222222-2222-2222-2222-222222222222',
      orgId: sampleOrg.id,
      email: 'alex@example.com',
      name: 'Alex Dev',
      avatarUrl: 'https://github.com/alex.png',
      provider: 'github',
      externalId: 'gh_9999',
      role: 'owner',
    }

    let insertCallCount = 0

    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [], // No user found initially
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          returning: async () => {
            insertCallCount++
            if (insertCallCount === 1) {
              return [sampleOrg]
            }
            return [sampleUser]
          },
        }),
      }),
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb),
    } as any

    const app = await buildApp({ db: mockDb })

    const res = await app.inject({
      method: 'POST',
      url: '/internal/auth/upsert-user',
      headers: {
        'x-internal-secret': internalSecret,
      },
      payload: {
        email: 'alex@example.com',
        name: 'Alex Dev',
        avatarUrl: 'https://github.com/alex.png',
        provider: 'github',
        externalId: 'gh_9999',
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.isNew).toBe(true)
    expect(body.user.email).toBe('alex@example.com')
    expect(body.user.role).toBe('owner')
    expect(body.organization.id).toBe(sampleOrg.id)

    await app.close()
  })

  it('updates existing user when user already exists (200)', async () => {
    const existingOrg = {
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Existing Org',
      slug: 'existing-org',
      plan: 'growth',
    }

    const existingUser = {
      id: '44444444-4444-4444-4444-444444444444',
      orgId: existingOrg.id,
      email: 'founder@stealthmark.io',
      name: 'Founder Old Name',
      avatarUrl: null,
      provider: 'email',
      role: 'owner',
    }

    const updatedUser = {
      ...existingUser,
      name: 'Founder New Name',
      avatarUrl: 'https://google.com/photo.jpg',
      provider: 'google',
    }

    let selectCount = 0
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              selectCount++
              if (selectCount === 1) {
                return [existingUser] // existing user found
              }
              return [existingOrg] // org lookup
            },
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [updatedUser],
          }),
        }),
      }),
    } as any

    const app = await buildApp({ db: mockDb })

    const res = await app.inject({
      method: 'POST',
      url: '/internal/auth/upsert-user',
      headers: {
        'x-internal-secret': internalSecret,
      },
      payload: {
        email: 'founder@stealthmark.io',
        name: 'Founder New Name',
        avatarUrl: 'https://google.com/photo.jpg',
        provider: 'google',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.isNew).toBe(false)
    expect(body.user.name).toBe('Founder New Name')
    expect(body.user.provider).toBe('google')
    expect(body.organization.id).toBe(existingOrg.id)

    await app.close()
  })

  describe('first login provisioning is atomic', () => {
    const racedUser = {
      id: '55555555-5555-5555-5555-555555555555',
      orgId: '66666666-6666-6666-6666-666666666666',
      email: 'race@example.com',
      role: 'owner',
    }
    const racedOrg = { id: racedUser.orgId, name: 'Winner Org', plan: 'free' }
    const payload = { email: 'race@example.com', provider: 'github' }

    function failingProvisioningDb(existingAfterFailure: unknown[]) {
      const state = { transactions: 0, rolledBack: 0, directInserts: 0, lookups: 0 }
      const tx = {
        insert: (table: unknown) => ({
          values: () => ({
            returning: async () => {
              if (table === users) throw new Error('duplicate key value violates unique constraint "users_email_unique"')
              return [{ id: 'org-created' }]
            },
          }),
        }),
      }
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                state.lookups++
                if (state.lookups === 1) return []
                return state.lookups === 2 ? existingAfterFailure : [racedOrg]
              },
            }),
          }),
        }),
        insert: () => {
          state.directInserts++
          throw new Error('provisioning must go through the transaction')
        },
        transaction: async (callback: (client: unknown) => Promise<unknown>) => {
          state.transactions++
          try {
            return await callback(tx)
          } catch (err) {
            state.rolledBack++
            throw err
          }
        },
      } as any
      return { mockDb, state }
    }

    it('creates the organization and the user inside one transaction that rolls back together', async () => {
      const { mockDb, state } = failingProvisioningDb([])
      const app = await buildApp({ db: mockDb })
      const res = await app.inject({ method: 'POST', url: '/internal/auth/upsert-user', headers: { 'x-internal-secret': internalSecret }, payload })
      await app.close()

      expect(state.transactions).toBe(1)
      expect(state.rolledBack).toBe(1)
      expect(state.directInserts).toBe(0)
      expect(res.statusCode).toBe(500)
      expect(res.json().error).toBe('database_error')
      expect(JSON.stringify(res.json())).not.toMatch(/duplicate key|users_email_unique/)
    })

    it('answers with the existing account when a concurrent first login for the same email won the race', async () => {
      const { mockDb, state } = failingProvisioningDb([racedUser])
      const app = await buildApp({ db: mockDb })
      const res = await app.inject({ method: 'POST', url: '/internal/auth/upsert-user', headers: { 'x-internal-secret': internalSecret }, payload })
      await app.close()

      expect(state.rolledBack).toBe(1)
      expect(res.statusCode).toBe(200)
      expect(res.json().isNew).toBe(false)
      expect(res.json().user.id).toBe(racedUser.id)
      expect(res.json().organization.id).toBe(racedOrg.id)
    })
  })
})
