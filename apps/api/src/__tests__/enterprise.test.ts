import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { authHeaders, testApiKeyResolver, ENABLED_FEATURES } from './helpers/test-auth.js'
import type { DbClient } from '@stealthmark/db'
import '../middleware/api-key-auth.js'
import { withTransactions } from './helpers/fake-db.js'
import { logAuditEvent, verifyAuditChain } from '../services/audit.js'
import { triggerKillSwitch, isTargetKilled } from '../services/kill-switch.js'

describe('Phase 6 — Enterprise (Policy Engine, Audit Trail, Kill Switch, FinOps & Private Registry)', () => {
  const sampleOrgId = '777e4567-e89b-12d3-a456-426614174777'
  const sampleCapId = '888e4567-e89b-12d3-a456-426614174888'
  const sampleAgentId = '999e4567-e89b-12d3-a456-426614174999'

  const mockOrg = {
    id: sampleOrgId,
    name: 'Enterprise Corp Labs',
    slug: 'enterprise-corp',
    plan: 'enterprise',
    status: 'active',
  }

  const mockPolicy = {
    id: 'pol-1',
    orgId: sampleOrgId,
    name: 'Max Spend Per Task Limit',
    description: 'Enforce max $2.00 per task execution',
    type: 'spend_limit',
    rulesJson: { maxCostPerTask: 2.0, blockedCapabilities: ['blocked-cap-uuid'] },
    enforcementAction: 'block',
    status: 'active',
    createdAt: new Date(),
  }

  const mockAuditLog = {
    id: 'log-1',
    orgId: sampleOrgId,
    actorId: 'user-admin-1',
    action: 'policy.created',
    entityType: 'policy',
    entityId: 'pol-1',
    payloadJson: { name: 'Max Spend Per Task Limit' },
    ipAddress: '127.0.0.1',
    prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
    logHash: 'mock-hash-1',
    timestamp: new Date(),
  }

  const mockKillSwitch = {
    id: '00000000-0000-4000-8000-0000000000e1',
    orgId: sampleOrgId,
    targetType: 'agent',
    targetId: sampleAgentId,
    reason: 'Detected abnormal token loop in autonomous research agent',
    triggeredBy: 'Security Bot',
    status: 'active',
    triggeredAt: new Date(),
    disarmedAt: null,
  }

  const mockPrivateRegistry = {
    id: 'priv-reg-1',
    orgId: sampleOrgId,
    name: 'Internal Finance Agents',
    slug: 'internal-finance',
    description: 'Private isolated network for banking workflows',
    allowedOrgIds: [sampleOrgId],
    capabilityIds: [sampleCapId],
    status: 'active',
    createdAt: new Date(),
  }

  function createMockDb() {
    return {
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              groupBy: async () => [
                {
                  capabilityId: sampleCapId,
                  capabilityName: 'Private Finance Parser',
                  totalCost: 15.5,
                  taskCount: 30,
                  avgLatencyMs: 650,
                },
              ],
            }),
          }),
          where: () => ({
            limit: async () => [mockPolicy],
            orderBy: () => ({
              limit: async () => [mockAuditLog],
              then: (resolve: any) => resolve([mockPolicy]),
            }),
            then: (resolve: any) => resolve([mockPolicy]),
          }),
          orderBy: async () => [mockPolicy],
          then: (resolve: any) => resolve([mockPolicy]),
        }),
      }),
      insert: () => ({
        values: (data: any) => ({
          returning: async () => [{ ...data, id: data.id || 'gen-ent-id', createdAt: new Date() }],
          then: (resolve: any) => resolve([{ ...data, id: data.id || 'gen-ent-id', createdAt: new Date() }]),
        }),
      }),
      update: () => ({
        set: (data: any) => ({
          where: () => ({
            returning: async () => [{ ...mockKillSwitch, ...data }],
          }),
        }),
      }),
    } as unknown as DbClient
  }

  // 1. Policy Engine Tests
  describe('Enterprise Policy Engine', () => {
    it('POST /v1/enterprise/policies creates an enterprise governance rule', async () => {
      const app = await buildApp({ db: createMockDb(), apiKeyResolver: testApiKeyResolver({ orgId: mockOrg.id }), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'POST',
        url: '/v1/enterprise/policies',
        headers: authHeaders,
        payload: {
          name: 'Spend Cap Policy',
          description: 'Limit cost per task to $2.00',
          type: 'spend_limit',
          rules: { maxCostPerTask: 2.0 },
          enforcementAction: 'block',
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.policy.name).toBe('Spend Cap Policy')
      expect(body.policy.enforcementAction).toBe('block')
    })

    it('POST /v1/enterprise/policies/evaluate detects policy violations', async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: async () => [
              {
                id: 'pol-1',
                name: 'Cost Cap',
                rulesJson: { maxCostPerTask: 1.0 },
                enforcementAction: 'block',
                status: 'active',
              },
            ],
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver({ orgId: mockOrg.id }), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'POST',
        url: '/v1/enterprise/policies/evaluate',
        headers: authHeaders,
        payload: {
          capabilityId: sampleCapId,
          cost: 2.50, // exceeds 1.0
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.allowed).toBe(false)
      expect(body.action).toBe('block')
      expect(body.violations.length).toBeGreaterThan(0)
      expect(body.violations[0].rule).toBe('maxCostPerTask')
    })
  })

  // 2. Cryptographic Audit Trail Tests
  describe('Cryptographic Audit Trail & Hash Verification', () => {
    it('logAuditEvent generates inmutable SHA-256 chain and verifyAuditChain confirms it', async () => {
      const recordedLogs: any[] = []

      const testDb = withTransactions({
        select: () => ({
          from: () => ({
            where: () => {
              const res: any = Promise.resolve(recordedLogs)
              res.orderBy = () => {
                const inner: any = Promise.resolve(recordedLogs)
                inner.limit = async () => {
                  return recordedLogs.length > 0 ? [recordedLogs[recordedLogs.length - 1]] : []
                }
                return inner
              }
              return res
            },
          }),
        }),
        insert: () => ({
          values: (data: any) => ({
            returning: async () => {
              const row = { ...data, id: `log-${recordedLogs.length + 1}` }
              recordedLogs.push(row)
              return [row]
            },
          }),
        }),
      })

      // Append 2 chained audit events
      const log1 = await logAuditEvent(testDb, {
        orgId: sampleOrgId,
        actorId: 'user-1',
        action: 'task.execute',
        entityType: 'task',
        entityId: 'task-101',
        payloadJson: { cost: 0.05 },
      })
      expect(log1.logHash).toBeDefined()
      expect(log1.prevHash).toBe('0000000000000000000000000000000000000000000000000000000000000000')

      const log2 = await logAuditEvent(testDb, {
        orgId: sampleOrgId,
        actorId: 'user-1',
        action: 'escrow.released',
        entityType: 'escrow',
        entityId: 'escrow-202',
        payloadJson: { amount: 50.0 },
      })
      expect(log2.prevHash).toBe(log1.logHash)

      // Verify chain
      const verification = await verifyAuditChain(testDb, sampleOrgId)
      expect(verification.valid).toBe(true)
      expect(verification.verifiedCount).toBe(2)
      expect(verification.message).toContain('cryptographically verified')
    })

    it('POST /v1/enterprise/audit/verify endpoint responds with verified integrity', async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: async () => [],
            }),
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver({ orgId: mockOrg.id }), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'POST',
        url: '/v1/enterprise/audit/verify',
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.valid).toBe(true)
    })
  })

  // 3. Emergency Kill Switch Tests
  describe('Emergency Kill Switch Controls', () => {
    it('POST /v1/enterprise/kill-switch/trigger halts agent and isTargetKilled catches it', async () => {
      const activeSwitches: any[] = []

      const testDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: async () => [],
              }),
            }),
          }),
        }),
        insert: () => ({
          values: (data: any) => ({
            returning: async () => {
              const row = { ...data, id: 'ks-test-1' }
              activeSwitches.push(row)
              return [row]
            },
          }),
        }),
      } as unknown as DbClient

      const ks = await triggerKillSwitch(testDb, {
        orgId: sampleOrgId,
        targetType: 'agent',
        targetId: sampleAgentId,
        reason: 'Rogue infinite loop execution detected',
        triggeredBy: 'Security Engineer',
      })

      expect(ks.status).toBe('active')
      expect(ks.targetId).toBe(sampleAgentId)

      // Query if target is killed
      const checkDb = {
        select: () => ({
          from: () => ({
            where: async () => activeSwitches,
          }),
        }),
      } as unknown as DbClient

      const check = await isTargetKilled(checkDb, {
        orgId: sampleOrgId,
        targetType: 'agent',
        targetId: sampleAgentId,
      })

      expect(check.killed).toBe(true)
      expect(check.reason).toContain('Rogue infinite loop execution detected')
    })

    it('POST /v1/enterprise/kill-switch/:id/disarm disarms the emergency halt', async () => {
      const mockDb = withTransactions({
        update: () => ({
          set: (data: any) => ({
            where: () => ({
              returning: async () => [{ ...mockKillSwitch, ...data, status: 'disarmed' }],
            }),
          }),
        }),
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: async () => [],
              }),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: async () => [mockAuditLog],
          }),
        }),
      })

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver({ orgId: mockOrg.id }), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'POST',
        url: '/v1/enterprise/kill-switch/00000000-0000-4000-8000-0000000000e1/disarm',
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.killSwitch.status).toBe('disarmed')
      expect(body.message).toContain('Execution capability restored')
    })
  })

  // 4. FinOps & Private Registries Tests
  describe('FinOps Analytics & Private Registries', () => {
    it('GET /v1/enterprise/finops/breakdown returns cost attribution and efficiency', async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            leftJoin: () => ({
              where: () => ({
                groupBy: async () => [
                  {
                    capabilityId: sampleCapId,
                    capabilityName: 'Vision Web Extraction',
                    totalCost: 18.25,
                    taskCount: 365,
                    avgLatencyMs: 820,
                  },
                ],
              }),
            }),
            where: () => ({
              then: (resolve: any) => resolve([{ totalCost: 18.25, taskCount: 365, completedCount: 360 }]),
            }),
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver({ orgId: mockOrg.id }), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'GET',
        url: '/v1/enterprise/finops/breakdown',
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.totalTasksCost).toBe(18.25)
      expect(body.avgCostPerTask).toBeDefined()
      expect(body.efficiencyRatio).toBeGreaterThan(0)
    })

    it('POST /v1/enterprise/private-registries creates isolated catalog', async () => {
      const mockDb = {
        insert: () => ({
          values: (data: any) => ({
            returning: async () => [{ ...mockPrivateRegistry, ...data }],
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver({ orgId: mockOrg.id }), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'POST',
        url: '/v1/enterprise/private-registries',
        headers: authHeaders,
        payload: {
          name: 'Private Core Capabilities',
          slug: 'private-core',
          description: 'Internal air-gapped models',
          allowedOrgIds: [sampleOrgId],
          capabilityIds: [sampleCapId],
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.registry.slug).toBe('private-core')
    })
  })
})
