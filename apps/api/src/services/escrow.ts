import { eq, or, and, desc, sql } from 'drizzle-orm'
import {
  escrows,
  contracts,
  organizations,
  type DbClient,
  type Escrow,
} from '@stealthmark/db'

export const PLATFORM_FEE_RATE = 0.05 // 5% StealthMark take-rate

export async function createEscrow(
  db: DbClient,
  params: {
    contractId: string
    taskId?: string
    consumerOrgId: string
    amount: number
    currency?: string
  }
): Promise<Escrow> {
  return db.transaction(async (tx) => {
    const [contract] = await tx
      .select()
      .from(contracts)
      .where(eq(contracts.id, params.contractId))
      .limit(1)

    if (!contract) {
      throw new Error(`Contract with id ${params.contractId} not found`)
    }

    if (contract.status !== 'active') {
      throw new Error(`Cannot fund escrow for contract in '${contract.status}' status (must be 'active')`)
    }

    if (contract.consumerOrgId !== params.consumerOrgId) {
      throw new Error('Only the consumer organization can fund the escrow')
    }

    const feeAmount = Math.round(params.amount * PLATFORM_FEE_RATE * 100) / 100
    const netAmount = Math.round((params.amount - feeAmount) * 100) / 100
    const currency = (params.currency || 'usd').toLowerCase()

    const [inserted] = await tx
      .insert(escrows)
      .values({
        contractId: contract.id,
        taskId: params.taskId || null,
        consumerOrgId: params.consumerOrgId,
        providerOrgId: contract.providerOrgId,
        amount: String(params.amount),
        feeAmount: String(feeAmount),
        netAmount: String(netAmount),
        currency,
        status: 'held', // Funds locked upon creation
        heldAt: new Date(),
      })
      .returning()

    // Update consumer escrow balance atomically
    await tx
      .update(organizations)
      .set({
        escrowBalance: sql`${organizations.escrowBalance} + ${params.amount}`,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, params.consumerOrgId))

    return inserted
  })
}

export async function submitWork(
  db: DbClient,
  params: {
    escrowId: string
    providerOrgId: string
    deliverableJson: unknown
  }
): Promise<Escrow> {
  const [escrow] = await db
    .select()
    .from(escrows)
    .where(eq(escrows.id, params.escrowId))
    .limit(1)

  if (!escrow) {
    throw new Error(`Escrow with id ${params.escrowId} not found`)
  }

  if (escrow.providerOrgId !== params.providerOrgId) {
    throw new Error('Only the assigned provider organization can submit work for this escrow')
  }

  if (escrow.status !== 'held') {
    throw new Error(`Cannot submit work for escrow in '${escrow.status}' status (must be 'held')`)
  }

  const [updated] = await db
    .update(escrows)
    .set({
      status: 'work_submitted',
      deliverableJson: params.deliverableJson,
    })
    .where(eq(escrows.id, params.escrowId))
    .returning()

  return updated
}

export async function validateAndRelease(
  db: DbClient,
  params: {
    escrowId: string
    consumerOrgId: string
  }
): Promise<Escrow> {
  return db.transaction(async (tx) => {
    const [escrow] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, params.escrowId))
      .limit(1)

    if (!escrow) {
      throw new Error(`Escrow with id ${params.escrowId} not found`)
    }

    if (escrow.consumerOrgId !== params.consumerOrgId) {
      throw new Error('Only the consumer organization can release escrow funds')
    }

    if (escrow.status !== 'work_submitted') {
      throw new Error(`Cannot release escrow in '${escrow.status}' status (work must be submitted first)`)
    }

    const amountNum = Number(escrow.amount)
    const netAmountNum = Number(escrow.netAmount)

    const [released] = await tx
      .update(escrows)
      .set({
        status: 'released',
        releasedAt: new Date(),
      })
      .where(eq(escrows.id, params.escrowId))
      .returning()

    // 1. Release consumer escrow hold and record total spent atomically
    await tx
      .update(organizations)
      .set({
        escrowBalance: sql`greatest(0, ${organizations.escrowBalance} - ${amountNum})`,
        totalSpent: sql`${organizations.totalSpent} + ${amountNum}`,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, escrow.consumerOrgId))

    // 2. Credit provider available balance and record total earned atomically
    await tx
      .update(organizations)
      .set({
        availableBalance: sql`${organizations.availableBalance} + ${netAmountNum}`,
        totalEarned: sql`${organizations.totalEarned} + ${netAmountNum}`,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, escrow.providerOrgId))

    return released
  })
}

export async function disputeEscrow(
  db: DbClient,
  params: {
    escrowId: string
    orgId: string
    reason: string
  }
): Promise<Escrow> {
  const [escrow] = await db
    .select()
    .from(escrows)
    .where(eq(escrows.id, params.escrowId))
    .limit(1)

  if (!escrow) {
    throw new Error(`Escrow with id ${params.escrowId} not found`)
  }

  if (escrow.consumerOrgId !== params.orgId && escrow.providerOrgId !== params.orgId) {
    throw new Error('Only parties to the escrow can open a dispute')
  }

  if (escrow.status !== 'held' && escrow.status !== 'work_submitted') {
    throw new Error(`Cannot dispute an escrow with status '${escrow.status}'`)
  }

  const [disputed] = await db
    .update(escrows)
    .set({
      status: 'disputed',
      disputeReason: params.reason,
    })
    .where(eq(escrows.id, params.escrowId))
    .returning()

  return disputed
}

export async function refundEscrow(
  db: DbClient,
  params: {
    escrowId: string
    orgId: string // Provider consenting or admin
  }
): Promise<Escrow> {
  return db.transaction(async (tx) => {
    const [escrow] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, params.escrowId))
      .limit(1)

    if (!escrow) {
      throw new Error(`Escrow with id ${params.escrowId} not found`)
    }

    if (escrow.status !== 'held' && escrow.status !== 'disputed' && escrow.status !== 'work_submitted') {
      throw new Error(`Cannot refund an escrow in '${escrow.status}' status`)
    }

    const amountNum = Number(escrow.amount)

    const [refunded] = await tx
      .update(escrows)
      .set({
        status: 'refunded',
        refundedAt: new Date(),
      })
      .where(eq(escrows.id, params.escrowId))
      .returning()

    // Return held funds back to consumer available balance atomically
    await tx
      .update(organizations)
      .set({
        escrowBalance: sql`greatest(0, ${organizations.escrowBalance} - ${amountNum})`,
        availableBalance: sql`${organizations.availableBalance} + ${amountNum}`,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, escrow.consumerOrgId))

    return refunded
  })
}

export async function getEscrow(
  db: DbClient,
  id: string
): Promise<Escrow | null> {
  const [escrow] = await db
    .select()
    .from(escrows)
    .where(eq(escrows.id, id))
    .limit(1)

  return escrow || null
}

export async function listEscrows(
  db: DbClient,
  orgId: string
): Promise<Escrow[]> {
  return db
    .select()
    .from(escrows)
    .where(or(eq(escrows.consumerOrgId, orgId), eq(escrows.providerOrgId, orgId)))
    .orderBy(desc(escrows.createdAt))
}
