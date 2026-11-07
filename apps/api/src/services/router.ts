import { eq } from 'drizzle-orm'
import { capabilities, type Capability, type DbClient } from '@stealthmark/db'
import { generateEmbedding, cosineSimilarity } from './embeddings.js'

import { getAgentContext, calculateExperienceSignal, type ExperienceSignal } from './agent-context.js'

export interface TaskConstraints {
  max_cost?: number
  max_latency_ms?: number
  required_protocols?: string[]
  agent_id?: string
}

export interface RouteResult {
  capability: Capability
  providerEndpoint: string
  protocol: string
  relevanceScore: number
  trustScore: number
  experienceSignal?: ExperienceSignal
  reason: string
}


export async function routeTask(
  db: DbClient,
  intent: string,
  constraints: TaskConstraints = {}
): Promise<RouteResult> {
  const queryEmbedding = await generateEmbedding(intent)
  const lowerIntent = intent.toLowerCase()

  const allCapabilities = await db
    .select()
    .from(capabilities)
    .where(eq(capabilities.status, 'active'))

  if (allCapabilities.length === 0) {
    throw new Error('No active capabilities found in the network')
  }

  // Fetch agent context if agent_id is provided
  const agentContexts = constraints.agent_id
    ? await getAgentContext(db, constraints.agent_id)
    : []
  const contextByCapId = new Map(agentContexts.map((ctx) => [ctx.capabilityId, ctx]))

  const scored: Array<{
    cap: Capability
    relevance: number
    trust: number
    combined: number
    experienceSignal?: ExperienceSignal
    reason: string
  }> = []

  for (const cap of allCapabilities) {
    // Constraint check: protocols
    if (constraints.required_protocols && constraints.required_protocols.length > 0) {
      const hasProtocol = constraints.required_protocols.some((p) => cap.protocols.includes(p))
      if (!hasProtocol) continue
    }

    // Constraint check: max_cost
    const price = cap.pricingAmount ? parseFloat(cap.pricingAmount) : 0
    if (constraints.max_cost !== undefined && price > constraints.max_cost) {
      continue
    }

    // Experience signal check
    const agentCtx = contextByCapId.get(cap.id)
    const expSignal = constraints.agent_id ? calculateExperienceSignal(agentCtx) : undefined

    // Skip blocked capabilities based on agent preference policy
    if (expSignal?.isBlocked) {
      continue
    }

    // Calculate semantic similarity
    let relevance = 0.5
    if (cap.embedding && Array.isArray(cap.embedding)) {
      relevance = Math.max(0, cosineSimilarity(queryEmbedding, cap.embedding))
    } else {
      const text = `${cap.name} ${cap.description || ''} ${cap.category || ''}`.toLowerCase()
      if (text.includes(lowerIntent)) relevance = 0.9
    }

    // Boost exact keyword matches in name or description
    if (
      cap.name.toLowerCase().includes(lowerIntent) ||
      (cap.description && cap.description.toLowerCase().includes(lowerIntent))
    ) {
      relevance = Math.min(1.0, relevance + 0.2)
    }

    const trust = cap.trustScore ?? 75
    let combined = relevance * 0.6 + (trust / 100) * 0.4

    let reason = `Matched intent '${intent}' with ${Math.round(relevance * 100)}% semantic relevance and ${trust}/100 trust rating.`

    // Discovery v2: Experience Signal Boost
    if (expSignal) {
      combined = Math.max(0, Math.min(1.0, combined + expSignal.scoreBoost))
      if (expSignal.totalExecutions > 0 || expSignal.preferenceScore !== 0) {
        reason += ` ${expSignal.reason}`
      }
    }

    scored.push({
      cap,
      relevance,
      trust,
      combined,
      experienceSignal: expSignal,
      reason,
    })
  }

  if (scored.length === 0) {
    throw new Error(`No capabilities satisfy the specified constraints for intent: '${intent}'`)
  }

  scored.sort((a, b) => b.combined - a.combined)
  const best = scored[0]

  const protocol = best.cap.protocols.includes('MCP') ? 'MCP' : best.cap.protocols[0] || 'REST'
  const providerEndpoint = best.cap.endpoint || `https://api.stealthmark.io/v1/capabilities/${best.cap.slug}`

  return {
    capability: best.cap,
    providerEndpoint,
    protocol,
    relevanceScore: Number(best.relevance.toFixed(3)),
    trustScore: best.trust,
    experienceSignal: best.experienceSignal,
    reason: best.reason,
  }
}

