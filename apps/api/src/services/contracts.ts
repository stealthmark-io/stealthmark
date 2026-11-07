import { eq, or, and, desc } from 'drizzle-orm'
import {
  contracts,
  capabilities,
  organizations,
  type DbClient,
  type Contract,
} from '@stealthmark/db'
import crypto from 'node:crypto'

export interface ContractTerms {
  pricing: {
    amount: number
    unit: string
    volume?: number
  }
  sla: {
    maxLatencyMs: number
    uptimeGuarantee: number
  }
  deliverablesSchema?: object
  customTerms?: string
}

export async function createContract(
  db: DbClient,
  params: {
    negotiationId?: string
    capabilityId: string
    consumerOrgId: string
    providerOrgId: string
    terms: ContractTerms
    validDays?: number
    autoSignByCreator?: 'consumer' | 'provider'
  }
): Promise<Contract> {
  const termsHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(params.terms))
    .digest('hex')

  const validUntil = new Date(Date.now() + (params.validDays || 30) * 24 * 3600 * 1000)

  const consumerSignedAt = params.autoSignByCreator === 'consumer' ? new Date() : null
  const providerSignedAt = params.autoSignByCreator === 'provider' ? new Date() : null
  const status = consumerSignedAt && providerSignedAt ? 'active' : 'draft'

  const [inserted] = await db
    .insert(contracts)
    .values({
      negotiationId: params.negotiationId || null,
      capabilityId: params.capabilityId,
      consumerOrgId: params.consumerOrgId,
      providerOrgId: params.providerOrgId,
      termsJson: params.terms,
      termsHash,
      consumerSignedAt,
      providerSignedAt,
      status,
      validUntil,
    })
    .returning()

  return inserted
}

export async function signContract(
  db: DbClient,
  params: {
    contractId: string
    orgId: string
  }
): Promise<Contract> {
  const [contract] = await db
    .select()
    .from(contracts)
    .where(eq(contracts.id, params.contractId))
    .limit(1)

  if (!contract) {
    throw new Error(`Contract with id ${params.contractId} not found`)
  }

  if (contract.status !== 'draft') {
    throw new Error(`Contract cannot be signed in '${contract.status}' status`)
  }

  const isConsumer = contract.consumerOrgId === params.orgId
  const isProvider = contract.providerOrgId === params.orgId

  if (!isConsumer && !isProvider) {
    throw new Error('Organization is not a party to this contract')
  }

  const now = new Date()
  const consumerSignedAt = isConsumer ? now : contract.consumerSignedAt
  const providerSignedAt = isProvider ? now : contract.providerSignedAt

  const isBothSigned = Boolean(consumerSignedAt && providerSignedAt)
  const newStatus = isBothSigned ? 'active' : 'draft'

  const [updated] = await db
    .update(contracts)
    .set({
      consumerSignedAt,
      providerSignedAt,
      status: newStatus,
    })
    .where(eq(contracts.id, params.contractId))
    .returning()

  return updated
}

export async function getContract(
  db: DbClient,
  id: string
): Promise<Contract | null> {
  const [contract] = await db
    .select()
    .from(contracts)
    .where(eq(contracts.id, id))
    .limit(1)

  return contract || null
}

export async function listContracts(
  db: DbClient,
  orgId: string
): Promise<Contract[]> {
  return db
    .select()
    .from(contracts)
    .where(or(eq(contracts.consumerOrgId, orgId), eq(contracts.providerOrgId, orgId)))
    .orderBy(desc(contracts.createdAt))
}
