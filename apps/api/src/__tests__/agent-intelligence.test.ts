import { describe, it, expect } from 'vitest'
import { buildApp } from '../app.js'
import { authHeaders, testApiKeyResolver, ENABLED_FEATURES } from './helpers/test-auth.js'
import type { DbClient } from '@stealthmark/db'
import {
  calculateExperienceSignal,
  recordAgentExecution,
  setAgentPreference,
  getAgentContext,
} from '../services/agent-context.js'
import { routeTask } from '../services/router.js'

describe('Phase 7 — Agent Intelligence & Context (Slim)', () => {
  const sampleOrgId = '777e4567-e89b-12d3-a456-426614174777'
  const sampleAgentId = '999e4567-e89b-12d3-a456-426614174999'
  const sampleCapId1 = '888e4567-e89b-12d3-a456-426614174888'
  const sampleCapId2 = '888e4567-e89b-12d3-a456-426614174889'

  describe('calculateExperienceSignal', () => {
    it('returns neutral boost for null or empty context record', () => {
      const signal = calculateExperienceSignal(null)
      expect(signal.scoreBoost).toBe(0)
      expect(signal.reliabilityPercent).toBeNull()
      expect(signal.isBlocked).toBe(false)
      expect(signal.reason).toContain('No prior agent execution history')
    })

    it('calculates positive boost and stars for high reliability executions', () => {
      const mockRecord: any = {
        totalExecutions: 20,
        successfulExecutions: 19,
        preferenceScore: '0.50',
      }
      const signal = calculateExperienceSignal(mockRecord)
      expect(signal.reliabilityPercent).toBe(95)
      expect(signal.scoreBoost).toBeGreaterThan(0.1)
      expect(signal.isBlocked).toBe(false)
      expect(signal.reason).toContain('★ Used 20x by this agent (95% success')
    })

    it('calculates negative boost for low reliability', () => {
      const mockRecord: any = {
        totalExecutions: 10,
        successfulExecutions: 3,
        preferenceScore: '0.00',
      }
      const signal = calculateExperienceSignal(mockRecord)
      expect(signal.reliabilityPercent).toBe(30)
      expect(signal.scoreBoost).toBeLessThan(0)
      expect(signal.isBlocked).toBe(false)
    })

    it('hard blocks candidates when preferenceScore <= -0.8', () => {
      const mockRecord: any = {
        totalExecutions: 5,
        successfulExecutions: 1,
        preferenceScore: '-1.00',
        preferenceReason: 'Security policy violation',
      }
      const signal = calculateExperienceSignal(mockRecord)
      expect(signal.isBlocked).toBe(true)
      expect(signal.scoreBoost).toBe(-1.0)
      expect(signal.reason).toContain('Blocked by agent preference: Security policy violation')
    })
  })

  describe('Agent Context Service Logic', () => {
    it('records first execution and inserts new context row', async () => {
      let insertedValues: any = null
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [],
            }),
          }),
        }),
        insert: () => ({
          values: (val: any) => {
            insertedValues = val
            return {
              returning: async () => [{ id: 'ctx-1', ...val }],
            }
          },
        }),
      } as unknown as DbClient

      const result = await recordAgentExecution(mockDb, {
        orgId: sampleOrgId,
        agentId: sampleAgentId,
        capabilityId: sampleCapId1,
        success: true,
        latencyMs: 250,
        costUsd: 0.01,
      })

      expect(result.id).toBe('ctx-1')
      expect(insertedValues.totalExecutions).toBe(1)
      expect(insertedValues.successfulExecutions).toBe(1)
      expect(insertedValues.avgLatencyMs).toBe(250)
      expect(insertedValues.avgCostUsd).toBe('0.01')
    })

    it('updates rolling average and counts on subsequent execution', async () => {
      let updatedValues: any = null
      const mockExisting = {
        id: 'ctx-existing',
        totalExecutions: 4,
        successfulExecutions: 4,
        avgLatencyMs: 200,
        avgCostUsd: '0.02',
        metadata: { tag: 'worker' },
      }

      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [mockExisting],
            }),
          }),
        }),
        update: () => ({
          set: (val: any) => {
            updatedValues = val
            return {
              where: () => ({
                returning: async () => [{ ...mockExisting, ...val }],
              }),
            }
          },
        }),
      } as unknown as DbClient

      const result = await recordAgentExecution(mockDb, {
        orgId: sampleOrgId,
        agentId: sampleAgentId,
        capabilityId: sampleCapId1,
        success: false,
        latencyMs: 300,
        costUsd: 0.03,
      })

      expect(updatedValues.totalExecutions).toBe(5)
      expect(updatedValues.successfulExecutions).toBe(4)
      // Rolling latency: (200 * 4 + 300) / 5 = 220
      expect(updatedValues.avgLatencyMs).toBe(220)
    })

    it('sets agent explicit preference score and reason', async () => {
      let setValues: any = null
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [],
            }),
          }),
        }),
        insert: () => ({
          values: (val: any) => {
            setValues = val
            return {
              returning: async () => [{ id: 'pref-1', ...val }],
            }
          },
        }),
      } as unknown as DbClient

      const result = await setAgentPreference(mockDb, {
        orgId: sampleOrgId,
        agentId: sampleAgentId,
        capabilityId: sampleCapId1,
        preferenceScore: 0.75,
        preferenceReason: 'Faster response for web extraction',
      })

      expect(setValues.preferenceScore).toBe('0.75')
      expect(setValues.preferenceReason).toBe('Faster response for web extraction')
      expect(setValues.contextType).toBe('provider_preference')
    })
  })

  describe('Discovery v2 & Router Experience Integration', () => {
    it('applies experience signal to routeTask when agent_id is provided', async () => {
      const mockCapA = {
        id: sampleCapId1,
        slug: 'web-vision-a',
        name: 'Web Vision Extractor',
        description: 'Web vision model A',
        protocols: ['REST'],
        status: 'active',
        trustScore: 80,
        pricingAmount: '0.05',
        embedding: null,
      }

      const mockCapB = {
        id: sampleCapId2,
        slug: 'web-vision-b',
        name: 'Web Vision Extractor Alt',
        description: 'Web vision model B',
        protocols: ['REST'],
        status: 'active',
        trustScore: 80,
        pricingAmount: '0.05',
        embedding: null,
      }

      // Agent has high preference and executions on CapB
      const mockContextB = {
        id: 'ctx-b',
        agentId: sampleAgentId,
        capabilityId: sampleCapId2,
        totalExecutions: 30,
        successfulExecutions: 30,
        preferenceScore: '0.90',
        preferenceReason: 'Ultra fast OCR',
        contextType: 'provider_preference',
        lastExecutionAt: new Date(),
      }

      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => {
              const p = Promise.resolve([mockCapA, mockCapB]) as any
              p.orderBy = async () => [mockContextB]
              return p
            },
          }),
        }),
      } as unknown as DbClient


      const routeResult = await routeTask(mockDb, 'web vision', {
        agent_id: sampleAgentId,
      })

      // CapB should win due to the experience signal boost
      expect(routeResult.capability.id).toBe(sampleCapId2)
      expect(routeResult.experienceSignal).toBeDefined()
      expect(routeResult.experienceSignal?.totalExecutions).toBe(30)
      expect(routeResult.reason).toContain('★ Used 30x by this agent')
    })
  })

  describe('API Endpoints (Agent Context & Network Intelligence)', () => {
    it('GET /v1/agents/:id/context returns execution history', async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [{ id: sampleAgentId }],
              orderBy: async () => [
                {
                  id: 'ctx-1',
                  agentId: sampleAgentId,
                  capabilityId: sampleCapId1,
                  totalExecutions: 10,
                  successfulExecutions: 9,
                  avgLatencyMs: 210,
                  avgCostUsd: '0.01',
                  preferenceScore: '0.50',
                  preferenceReason: 'Very stable',
                  contextType: 'execution_outcome',
                  lastExecutionAt: new Date(),
                  metadata: null,
                },
              ],
            }),
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'GET',
        url: `/v1/agents/${sampleAgentId}/context`,
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.agent_id).toBe(sampleAgentId)
      expect(body.total_records).toBe(1)
      expect(body.context[0].reliability_percent).toBe(90)
    })

    it('POST /v1/agents/:id/context updates agent preference', async () => {
      let selectCalls = 0
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => (selectCalls++ === 0 ? [{ id: sampleAgentId }] : []),
            }),
          }),
        }),
        insert: () => ({
          values: (val: any) => ({
            returning: async () => [{ id: 'ctx-new', ...val }],
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'POST',
        url: `/v1/agents/${sampleAgentId}/context`,
        headers: authHeaders,
        payload: {
          org_id: sampleOrgId,
          capability_id: sampleCapId1,
          preference_score: 0.8,
          preference_reason: 'Preferred OCR capability',
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.message).toContain('updated')
      expect(body.context.preferenceScore).toBe('0.80')
    })

    it('POST /v1/agents/:id/context/record logs execution outcome', async () => {
      let selectCalls = 0
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => (selectCalls++ === 0 ? [{ id: sampleAgentId }] : []),
            }),
          }),
        }),
        insert: () => ({
          values: (val: any) => ({
            returning: async () => [{ id: 'ctx-rec', ...val }],
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'POST',
        url: `/v1/agents/${sampleAgentId}/context/record`,
        headers: authHeaders,
        payload: {
          org_id: sampleOrgId,
          capability_id: sampleCapId1,
          success: true,
          latency_ms: 195,
          cost_usd: 0.005,
        },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.message).toContain('recorded')
      expect(body.context.successfulExecutions).toBe(1)
    })

    it('GET /v1/intelligence/network returns anonymous network stats', async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            groupBy: async () => [
              {
                capabilityId: sampleCapId1,
                totalExecutions: 1540,
                successfulExecutions: 1520,
                avgLatencyMs: 230,
                participatingAgentsCount: 14,
              },
            ],
          }),
        }),
      } as unknown as DbClient

      const app = await buildApp({ db: mockDb, apiKeyResolver: testApiKeyResolver(), features: ENABLED_FEATURES })

      const response = await app.inject({
        method: 'GET',
        url: '/v1/intelligence/network',
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.network_intelligence.length).toBe(1)
      expect(body.network_intelligence[0].reliabilityPercent).toBe(99)
      expect(body.network_intelligence[0].participatingAgentsCount).toBe(14)
    })
  })
})
