import { eq, or, and, desc } from 'drizzle-orm'
import {
  negotiations,
  contracts,
  capabilities,
  organizations,
  type DbClient,
  type Negotiation,
} from '@stealthmark/db'
import crypto from 'node:crypto'

export interface OfferPayload {
  price: number
  unit: string
  volume?: number
  slaMs?: number
  customTerms?: string
}

export interface NegotiationHistoryItem {
  role: 'consumer' | 'provider'
  action: 'offer' | 'counter' | 'accept' | 'reject'
  offer: OfferPayload
  note?: string
  timestamp: string
}

export async function createNegotiation(
  db: DbClient,
  params: {
    capabilityId: string
    consumerOrgId: string
    agentId?: string
    offer: OfferPayload
    expiresInHours?: number
  }
): Promise<Negotiation> {
  const [cap] = await db
    .select()
    .from(capabilities)
    .where(eq(capabilities.id, params.capabilityId))
    .limit(1)

  if (!cap) {
    throw new Error(`Capability with id ${params.capabilityId} not found`)
  }

  const providerOrgId = cap.orgId
  if (providerOrgId === params.consumerOrgId) {
    throw new Error('Consumer and provider organization cannot be the same')
  }

  const hours = params.expiresInHours || 72
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000)

  const initialHistory: NegotiationHistoryItem[] = [
    {
      role: 'consumer',
      action: 'offer',
      offer: params.offer,
      note: 'Initial offer proposed',
      timestamp: new Date().toISOString(),
    },
  ]

  const [inserted] = await db
    .insert(negotiations)
    .values({
      capabilityId: params.capabilityId,
      consumerOrgId: params.consumerOrgId,
      providerOrgId,
      agentId: params.agentId || null,
      status: 'proposed',
      currentOffer: params.offer,
      history: initialHistory,
      expiresAt,
    })
    .returning()

  return inserted
}

export async function counterNegotiation(
  db: DbClient,
  params: {
    negotiationId: string
    orgId: string
    offer: OfferPayload
    note?: string
  }
): Promise<Negotiation> {
  const [neg] = await db
    .select()
    .from(negotiations)
    .where(eq(negotiations.id, params.negotiationId))
    .limit(1)

  if (!neg) {
    throw new Error(`Negotiation with id ${params.negotiationId} not found`)
  }

  if (neg.status !== 'proposed' && neg.status !== 'countered') {
    throw new Error(`Cannot counter a negotiation with status '${neg.status}'`)
  }

  let role: 'consumer' | 'provider'
  if (params.orgId === neg.consumerOrgId) {
    role = 'consumer'
  } else if (params.orgId === neg.providerOrgId) {
    role = 'provider'
  } else {
    throw new Error('Organization is not a party to this negotiation')
  }

  const history = (neg.history as NegotiationHistoryItem[]) || []
  history.push({
    role,
    action: 'counter',
    offer: params.offer,
    note: params.note || 'Counter-offer proposed',
    timestamp: new Date().toISOString(),
  })

  const [updated] = await db
    .update(negotiations)
    .set({
      status: 'countered',
      currentOffer: params.offer,
      history,
      updatedAt: new Date(),
    })
    .where(eq(negotiations.id, params.negotiationId))
    .returning()

  return updated
}

export async function acceptNegotiation(
  db: DbClient,
  params: {
    negotiationId: string
    orgId: string
    note?: string
  }
): Promise<{ negotiation: Negotiation; contractId?: string }> {
  const [neg] = await db
    .select()
    .from(negotiations)
    .where(eq(negotiations.id, params.negotiationId))
    .limit(1)

  if (!neg) {
    throw new Error(`Negotiation with id ${params.negotiationId} not found`)
  }

  if (neg.status !== 'proposed' && neg.status !== 'countered') {
    throw new Error(`Cannot accept negotiation with status '${neg.status}'`)
  }

  let role: 'consumer' | 'provider'
  if (params.orgId === neg.consumerOrgId) {
    role = 'consumer'
  } else if (params.orgId === neg.providerOrgId) {
    role = 'provider'
  } else {
    throw new Error('Organization is not a party to this negotiation')
  }

  const history = (neg.history as NegotiationHistoryItem[]) || []
  history.push({
    role,
    action: 'accept',
    offer: neg.currentOffer as OfferPayload,
    note: params.note || 'Offer accepted',
    timestamp: new Date().toISOString(),
  })

  const [updated] = await db
    .update(negotiations)
    .set({
      status: 'accepted',
      history,
      updatedAt: new Date(),
    })
    .where(eq(negotiations.id, params.negotiationId))
    .returning()

  // Auto-generate contract draft upon acceptance
  const offer = neg.currentOffer as OfferPayload
  const termsJson = {
    pricing: {
      amount: offer.price,
      unit: offer.unit,
      volume: offer.volume || 1,
    },
    sla: {
      maxLatencyMs: offer.slaMs || 2000,
      uptimeGuarantee: 99.9,
    },
    customTerms: offer.customTerms || 'Standard machine execution terms apply.',
  }
  const termsHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(termsJson))
    .digest('hex')

  const [contract] = await db
    .insert(contracts)
    .values({
      negotiationId: neg.id,
      capabilityId: neg.capabilityId,
      consumerOrgId: neg.consumerOrgId,
      providerOrgId: neg.providerOrgId,
      termsJson,
      termsHash,
      status: 'draft',
      // Sign for the accepting party
      consumerSignedAt: role === 'consumer' ? new Date() : null,
      providerSignedAt: role === 'provider' ? new Date() : null,
      validUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000), // 30 days valid
    })
    .returning()

  return { negotiation: updated, contractId: contract.id }
}

export async function rejectNegotiation(
  db: DbClient,
  params: {
    negotiationId: string
    orgId: string
    note?: string
  }
): Promise<Negotiation> {
  const [neg] = await db
    .select()
    .from(negotiations)
    .where(eq(negotiations.id, params.negotiationId))
    .limit(1)

  if (!neg) {
    throw new Error(`Negotiation with id ${params.negotiationId} not found`)
  }

  if (neg.status !== 'proposed' && neg.status !== 'countered') {
    throw new Error(`Cannot reject negotiation with status '${neg.status}'`)
  }

  let role: 'consumer' | 'provider'
  if (params.orgId === neg.consumerOrgId) {
    role = 'consumer'
  } else if (params.orgId === neg.providerOrgId) {
    role = 'provider'
  } else {
    throw new Error('Organization is not a party to this negotiation')
  }

  const history = (neg.history as NegotiationHistoryItem[]) || []
  history.push({
    role,
    action: 'reject',
    offer: neg.currentOffer as OfferPayload,
    note: params.note || 'Negotiation declined',
    timestamp: new Date().toISOString(),
  })

  const [updated] = await db
    .update(negotiations)
    .set({
      status: 'rejected',
      history,
      updatedAt: new Date(),
    })
    .where(eq(negotiations.id, params.negotiationId))
    .returning()

  return updated
}

export async function getNegotiation(
  db: DbClient,
  id: string
): Promise<Negotiation | null> {
  const [neg] = await db
    .select()
    .from(negotiations)
    .where(eq(negotiations.id, id))
    .limit(1)

  return neg || null
}

export async function listNegotiations(
  db: DbClient,
  orgId: string
): Promise<Negotiation[]> {
  return db
    .select()
    .from(negotiations)
    .where(or(eq(negotiations.consumerOrgId, orgId), eq(negotiations.providerOrgId, orgId)))
    .orderBy(desc(negotiations.createdAt))
}
