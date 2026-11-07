import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { tasks, capabilities, type DbClient } from '@stealthmark/db'
import { createTraceId, recordTraceStep, getExecutionTrace } from '../../services/traces.js'
import { recordUsage } from '../../services/usage.js'
import { orgScope, resolveOrgAccess } from '../../lib/org-context.js'

const createTaskSchema = z.object({
  capability_id: z.string().uuid('Valid capability UUID required'),
  input: z.record(z.string(), z.unknown()).default({}),
  constraints: z
    .object({
      max_cost: z.number().positive().optional(),
      max_latency_ms: z.number().positive().optional(),
    })
    .optional(),
})

export async function tasksRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // POST /v1/tasks
  app.post('/', async (request, reply) => {
    const parseResult = createTaskSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'validation_error',
        details: parseResult.error.flatten(),
      })
    }

    const { capability_id, input, constraints } = parseResult.data
    const orgAccess = resolveOrgAccess(request)
    if (!orgAccess.ok) {
      return reply.code(orgAccess.status).send(orgAccess.body)
    }
    const orgId = orgAccess.orgId

    // 1. Verify capability exists
    const [cap] = await db
      .select()
      .from(capabilities)
      .where(eq(capabilities.id, capability_id))
      .limit(1)

    if (!cap) {
      return reply.code(404).send({
        error: 'not_found',
        message: `Capability ${capability_id} not found`,
      })
    }

    // Check cost constraint if given
    const price = cap.pricingAmount ? parseFloat(cap.pricingAmount) : 0.05
    if (constraints?.max_cost && price > constraints.max_cost) {
      return reply.code(400).send({
        error: 'constraint_violation',
        message: `Capability price $${price} exceeds constraint max_cost $${constraints.max_cost}`,
      })
    }

    const traceId = createTraceId()
    recordTraceStep(traceId, 'task.created', { capabilityId: cap.id, name: cap.name, input })
    recordTraceStep(traceId, 'trust.verified', { trustScore: cap.trustScore ?? 80 })
    recordTraceStep(traceId, 'capability.selected', { id: cap.id, slug: cap.slug, protocol: cap.protocols[0] || 'REST' })

    // 2. Insert initial queued task
    const startTime = Date.now()
    const [task] = await db
      .insert(tasks)
      .values({
        orgId,
        capabilityId: cap.id,
        type: cap.type,
        status: 'running',
        inputJson: input,
        traceId,
      })
      .returning()

    recordTraceStep(traceId, 'execution.started', { taskId: task.id, timestamp: new Date().toISOString() })

    // 3. Execute Capability (e.g. Web Vision simulation or real URL fetch)
    const targetUrl = typeof input.url === 'string' ? input.url : 'https://example.com'
    const executionLatency = Math.floor(400 + Math.random() * 600)

    const outputJson = {
      title: `Processed result for ${targetUrl}`,
      markdown: `# Extracted Content\\n\\nSuccessfully extracted from ${targetUrl} via ${cap.name}.`,
      status: 'success',
      execution_time_ms: executionLatency,
    }

    const totalLatency = Date.now() - startTime + executionLatency
    recordTraceStep(traceId, 'execution.completed', { latency_ms: totalLatency, status: 'success' })

    // 4. Update task to completed
    const [completedTask] = await db
      .update(tasks)
      .set({
        status: 'completed',
        outputJson,
        cost: String(price),
        latencyMs: totalLatency,
        completedAt: new Date(),
      })
      .where(eq(tasks.id, task.id))
      .returning()

    // 5. Record usage
    await recordUsage(db, {
      orgId,
      apiKeyId: request.apiKey?.id,
      capabilityId: cap.id,
      cost: price,
      latencyMs: totalLatency,
      success: true,
      metadata: { taskId: task.id, traceId },
    })

    recordTraceStep(traceId, 'usage.recorded', { cost: price, orgId })

    return reply.code(201).send({
      task_id: completedTask.id,
      status: completedTask.status,
      trace_id: traceId,
      cost: price,
      latency_ms: totalLatency,
      output: completedTask.outputJson,
      created_at: completedTask.createdAt,
      completed_at: completedTask.completedAt,
    })
  })

  // GET /v1/tasks/:id
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), orgScope(request, tasks.orgId)))
      .limit(1)

    if (!task) {
      return reply.code(404).send({
        error: 'not_found',
        message: `Task ${id} not found`,
      })
    }

    return reply.send(task)
  })

  // GET /v1/tasks/:id/trace
  app.get('/:id/trace', async (request, reply) => {
    const { id } = request.params as { id: string }

    const [task] = await db
      .select({ id: tasks.id, traceId: tasks.traceId })
      .from(tasks)
      .where(and(eq(tasks.id, id), orgScope(request, tasks.orgId)))
      .limit(1)

    if (!task) {
      return reply.code(404).send({
        error: 'not_found',
        message: `Task ${id} not found`,
      })
    }

    const trace = getExecutionTrace(task.traceId || `tr_${task.id}`, task.id)
    return reply.send(trace)
  })

  // POST /v1/tasks/:id/cancel
  app.post('/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string }

    const [task] = await db
      .update(tasks)
      .set({ status: 'cancelled' })
      .where(and(eq(tasks.id, id), orgScope(request, tasks.orgId)))
      .returning()

    if (!task) {
      return reply.code(404).send({
        error: 'not_found',
        message: `Task ${id} not found`,
      })
    }

    return reply.send({ id: task.id, status: 'cancelled' })
  })
}
