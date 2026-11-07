import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and, desc, sql } from 'drizzle-orm'
import { capabilities, organizations, reviews, tasks, type DbClient } from '@stealthmark/db'
import '../../middleware/api-key-auth.js'
import { calculateTrustScore } from '../../services/trust.js'

const createReviewSchema = z.object({
  taskId: z.string().uuid('A valid task UUID is required to verify execution authenticity'),
  rating: z.number().int().min(1).max(5, 'Rating must be an integer between 1 and 5'),
  comment: z.string().min(5, 'Comment must be at least 5 characters').max(1000).optional(),
})

export async function reviewsRoutes(app: FastifyInstance, options: { db: DbClient }) {
  const { db } = options

  // POST /v1/capabilities/:id/reviews — Post a verified review linked to a real completed task
  app.post('/capabilities/:id/reviews', async (request, reply) => {
    const callerOrgId = request.orgId
    if (!callerOrgId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Organization context required' })
    }

    const { id: capabilityId } = request.params as { id: string }
    const parseResult = createReviewSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'validation_error', details: parseResult.error.flatten() })
    }

    const { taskId, rating, comment } = parseResult.data

    // 1. Verify capability exists
    const [cap] = await db
      .select({ id: capabilities.id, orgId: capabilities.orgId })
      .from(capabilities)
      .where(eq(capabilities.id, capabilityId))
      .limit(1)

    if (!cap) {
      return reply.code(404).send({ error: 'not_found', message: 'Capability not found' })
    }

    // 2. Prevent self-reviewing
    if (cap.orgId === callerOrgId) {
      return reply.code(403).send({
        error: 'self_review_forbidden',
        message: 'Publishers cannot review their own capabilities',
      })
    }

    // 3. Strict Verification: Check that taskId exists, belongs to callerOrgId, targets capabilityId, and was completed
    const [task] = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.orgId, callerOrgId),
          eq(tasks.capabilityId, capabilityId)
        )
      )
      .limit(1)

    if (!task) {
      return reply.code(403).send({
        error: 'unverified_execution',
        message: 'Verification failed: No matching execution task found for your organization and this capability',
      })
    }

    if (task.status !== 'completed') {
      return reply.code(403).send({
        error: 'task_not_completed',
        message: `Task ${taskId} has status '${task.status}'. Only successfully completed tasks can be reviewed.`,
      })
    }

    // 4. Check if a review already exists for this task
    const [existingReview] = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(eq(reviews.taskId, taskId))
      .limit(1)

    if (existingReview) {
      return reply.code(409).send({
        error: 'duplicate_review',
        message: 'A verified review has already been submitted for this execution task',
      })
    }

    // 5. Insert verified review
    const now = new Date()
    const [review] = await db
      .insert(reviews)
      .values({
        taskId,
        capabilityId,
        reviewerOrgId: callerOrgId,
        rating,
        comment: comment || null,
        verifiedExecution: true,
        createdAt: now,
      })
      .returning()

    // 6. Recalculate dynamic reputation with this new review
    const trustResult = await calculateTrustScore(db, capabilityId)

    return reply.code(201).send({
      message: 'Verified review submitted successfully',
      review: {
        id: review.id,
        capabilityId: review.capabilityId,
        taskId: review.taskId,
        rating: review.rating,
        comment: review.comment,
        verifiedExecution: review.verifiedExecution,
        createdAt: review.createdAt,
      },
      updatedReputation: {
        trustScore: trustResult.score,
        qualityScore: trustResult.qualityScore,
        reputationScore: trustResult.reputationScore,
      },
    })
  })

  // GET /v1/capabilities/:id/reviews — List verified reviews for a capability
  app.get('/capabilities/:id/reviews', async (request, reply) => {
    const { id: capabilityId } = request.params as { id: string }

    const [cap] = await db
      .select({ id: capabilities.id, name: capabilities.name })
      .from(capabilities)
      .where(eq(capabilities.id, capabilityId))
      .limit(1)

    if (!cap) {
      return reply.code(404).send({ error: 'not_found', message: 'Capability not found' })
    }

    const reviewsList = await db
      .select({
        id: reviews.id,
        taskId: reviews.taskId,
        rating: reviews.rating,
        comment: reviews.comment,
        verifiedExecution: reviews.verifiedExecution,
        createdAt: reviews.createdAt,
        reviewerOrgName: organizations.name,
      })
      .from(reviews)
      .leftJoin(organizations, eq(reviews.reviewerOrgId, organizations.id))
      .where(eq(reviews.capabilityId, capabilityId))
      .orderBy(desc(reviews.createdAt))

    // Aggregate summary statistics
    const stats = await db
      .select({
        totalReviews: sql<number>`count(*)::int`,
        avgRating: sql<number>`coalesce(avg(${reviews.rating}), 0)::float`,
      })
      .from(reviews)
      .where(eq(reviews.capabilityId, capabilityId))

    const total = stats[0]?.totalReviews || 0
    const avg = stats[0]?.avgRating ? Number(stats[0].avgRating.toFixed(2)) : 0

    return reply.code(200).send({
      capabilityId,
      summary: {
        totalReviews: total,
        averageRating: avg,
      },
      reviews: reviewsList.map((r) => ({
        id: r.id,
        taskId: r.taskId,
        rating: r.rating,
        comment: r.comment,
        verifiedExecution: r.verifiedExecution,
        reviewerOrgName: r.reviewerOrgName || 'Verified Organization',
        createdAt: r.createdAt,
      })),
    })
  })
}
