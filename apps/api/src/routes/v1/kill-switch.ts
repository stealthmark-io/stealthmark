import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type DbClient } from '@stealthmark/db'
import '../../middleware/api-key-auth.js'
import {
  triggerKillSwitch,
  disarmKillSwitch,
  listKillSwitches,
} from '../../services/kill-switch.js'
import { logAuditEvent } from '../../services/audit.js'

const triggerKillSwitchSchema = z.object({
  targetType: z.enum(['organization', 'agent', 'capability', 'api_key']),
  targetId: z.string().min(1),
  reason: z.string().min(5, 'Reason must be at least 5 characters').max(500),
})

export async function killSwitchRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // POST /v1/enterprise/kill-switch/trigger — Immediately halt target agent, capability, or org
  app.post('/enterprise/kill-switch/trigger', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const parseResult = triggerKillSwitchSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    const { targetType, targetId, reason } = parseResult.data

    try {
      const ks = await triggerKillSwitch(db, {
        orgId: callerOrgId,
        targetType,
        targetId,
        reason,
        triggeredBy: request.organization?.name || callerOrgId,
      })

      // Append to cryptographic audit trail
      await logAuditEvent(db, {
        orgId: callerOrgId,
        actorId: callerOrgId,
        action: 'kill_switch.activated',
        entityType: targetType,
        entityId: targetId,
        payloadJson: { reason, killSwitchId: ks.id },
      })

      return reply.code(201).send({
        message: `EMERGENCY HALT ACTIVATED for ${targetType} (${targetId})`,
        killSwitch: ks,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to trigger kill switch'
      return reply.code(400).send({ error: 'bad_request', message: msg })
    }
  })

  // POST /v1/enterprise/kill-switch/:id/disarm — Disarm kill switch and restore execution
  app.post('/enterprise/kill-switch/:id/disarm', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const { id } = request.params as { id: string }

    try {
      const disarmed = await disarmKillSwitch(db, {
        killSwitchId: id,
        orgId: callerOrgId,
      })

      await logAuditEvent(db, {
        orgId: callerOrgId,
        actorId: callerOrgId,
        action: 'kill_switch.disarmed',
        entityType: disarmed.targetType,
        entityId: disarmed.targetId,
        payloadJson: { killSwitchId: id },
      })

      return reply.code(200).send({
        message: 'Kill switch disarmed. Execution capability restored.',
        killSwitch: disarmed,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to disarm kill switch'
      return reply.code(400).send({ error: 'bad_request', message: msg })
    }
  })

  // GET /v1/enterprise/kill-switch — List kill switches
  app.get('/enterprise/kill-switch', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const items = await listKillSwitches(db, callerOrgId)
    return reply.code(200).send({
      total: items.length,
      killSwitches: items,
    })
  })
}
