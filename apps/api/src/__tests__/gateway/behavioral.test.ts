import { beforeEach, describe, expect, it } from 'vitest'
import {
  calculateBehavioralScore,
  isAnomalous,
  recordAgentAccess,
} from '../../services/behavioral-score.js'
import { asDb, resetGatewayState, SAMPLE_AGENT_ID, SAMPLE_SITE_ID, SUITE_NAME } from './fixtures.js'

describe(SUITE_NAME, () => {
  beforeEach(resetGatewayState)

  describe('Behavioral Score Engine v0', () => {
    it('computes 100/100 score for normal compliant behavior', async () => {
      for (let i = 0; i < 10; i++) {
        recordAgentAccess(SAMPLE_AGENT_ID, SAMPLE_SITE_ID, { success: true })
      }

      const breakdown = await calculateBehavioralScore(null, SAMPLE_AGENT_ID)
      expect(breakdown.score).toBeGreaterThanOrEqual(90)
      expect(breakdown.errorsLastHour).toBe(0)
      expect(breakdown.scopeViolations).toBe(0)
      expect(breakdown.isAnomalous).toBe(false)
    })

    it('docks score significantly when error rate spikes', async () => {
      for (let i = 0; i < 10; i++) {
        recordAgentAccess('error-agent', SAMPLE_SITE_ID, { success: false })
      }

      const breakdown = await calculateBehavioralScore(null, 'error-agent')
      expect(breakdown.errorRateScore).toBeLessThanOrEqual(40)
      expect(breakdown.score).toBeLessThan(75)
    })

    it('heavily penalizes scope violations and flags anomalous behavior', async () => {
      for (let i = 0; i < 3; i++) {
        recordAgentAccess('bad-agent', SAMPLE_SITE_ID, { success: false, scopeViolation: true })
      }

      const breakdown = await calculateBehavioralScore(null, 'bad-agent')
      expect(breakdown.consistencyScore).toBeLessThanOrEqual(20)
      expect(breakdown.scopeViolations).toBe(3)
      expect(breakdown.isAnomalous).toBe(true)
      expect(isAnomalous('bad-agent')).toBe(true)
    })

    it('flags anomaly on rapid velocity burst (>100 RPM)', () => {
      for (let i = 0; i < 110; i++) {
        recordAgentAccess('spammer-agent', SAMPLE_SITE_ID, { success: true })
      }

      expect(isAnomalous('spammer-agent')).toBe(true)
    })

    it('derives the history score from recorded executions in the database', async () => {
      const db = asDb({
        select: () => ({
          from: () => ({
            where: async () => [
              { totalExecutions: 8, successfulExecutions: 4 },
              { totalExecutions: 2, successfulExecutions: 2 },
            ],
          }),
        }),
      })

      const breakdown = await calculateBehavioralScore(db, 'history-agent')

      expect(breakdown.historyScore).toBe(60)
    })

    it('surfaces a failing history query instead of scoring with a default', async () => {
      const db = asDb({
        select: () => ({
          from: () => ({
            where: async () => {
              throw new Error('connection terminated')
            },
          }),
        }),
      })

      await expect(calculateBehavioralScore(db, 'history-agent')).rejects.toThrow('connection terminated')
    })
  })
})
