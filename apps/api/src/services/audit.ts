import { eq, desc, asc, sql } from 'drizzle-orm'
import { auditLogs, type DbClient, type AuditLog } from '@stealthmark/db'
import crypto from 'node:crypto'

export async function logAuditEvent(
  db: DbClient,
  params: {
    orgId: string
    actorId: string
    action: string
    entityType: string
    entityId: string
    payloadJson?: unknown
    ipAddress?: string
  }
): Promise<AuditLog> {
  return db.transaction(async (tx) => {
    // Serializes hash-chain appends per org; a failure here must abort the append, never skip the lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`audit_log:${params.orgId}`}))`)

    // 1. Get latest log hash for this organization to chain
    const [latestLog] = await tx
      .select({ logHash: auditLogs.logHash })
      .from(auditLogs)
      .where(eq(auditLogs.orgId, params.orgId))
      .orderBy(desc(auditLogs.timestamp))
      .limit(1)

    const prevHash = latestLog?.logHash || '0000000000000000000000000000000000000000000000000000000000000000'
    const timestamp = new Date()

    // 2. Compute cryptographic SHA-256 hash of (prevHash + action + timestamp + payload)
    const contentToHash = `${prevHash}|${params.action}|${params.entityType}|${params.entityId}|${timestamp.toISOString()}|${JSON.stringify(params.payloadJson || {})}`
    const logHash = crypto.createHash('sha256').update(contentToHash).digest('hex')

    const [inserted] = await tx
      .insert(auditLogs)
      .values({
        orgId: params.orgId,
        actorId: params.actorId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        payloadJson: params.payloadJson,
        ipAddress: params.ipAddress || null,
        prevHash,
        logHash,
        timestamp,
      })
      .returning()

    return inserted
  })
}

export async function getAuditLogs(
  db: DbClient,
  orgId: string,
  limit = 50
): Promise<AuditLog[]> {
  return db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.orgId, orgId))
    .orderBy(desc(auditLogs.timestamp))
    .limit(limit)
}

export async function verifyAuditChain(
  db: DbClient,
  orgId: string
): Promise<{
  valid: boolean
  totalLogs: number
  verifiedCount: number
  brokenAtId?: string
  message: string
}> {
  const logs = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.orgId, orgId))
    .orderBy(asc(auditLogs.timestamp))

  if (logs.length === 0) {
    return {
      valid: true,
      totalLogs: 0,
      verifiedCount: 0,
      message: 'No audit logs found for organization',
    }
  }

  let expectedPrevHash = '0000000000000000000000000000000000000000000000000000000000000000'

  for (let i = 0; i < logs.length; i++) {
    const row = logs[i]
    if (row.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        totalLogs: logs.length,
        verifiedCount: i,
        brokenAtId: row.id,
        message: `Broken audit chain at record index ${i}: prevHash mismatch`,
      }
    }

    // Recompute row hash
    const contentToHash = `${row.prevHash}|${row.action}|${row.entityType}|${row.entityId}|${row.timestamp.toISOString()}|${JSON.stringify(row.payloadJson || {})}`
    const expectedHash = crypto.createHash('sha256').update(contentToHash).digest('hex')

    if (row.logHash !== expectedHash) {
      return {
        valid: false,
        totalLogs: logs.length,
        verifiedCount: i,
        brokenAtId: row.id,
        message: `Tampered audit record detected at index ${i}: logHash mismatch`,
      }
    }

    expectedPrevHash = row.logHash
  }

  return {
    valid: true,
    totalLogs: logs.length,
    verifiedCount: logs.length,
    message: `Audit chain cryptographically verified: ${logs.length} inmutable records confirmed`,
  }
}
