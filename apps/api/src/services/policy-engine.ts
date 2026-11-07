import { eq, and, desc } from 'drizzle-orm'
import { policies, type DbClient, type Policy } from '@stealthmark/db'

export interface PolicyRules {
  maxCostPerTask?: number
  dailySpendCap?: number
  allowedCapabilities?: string[]
  blockedCapabilities?: string[]
  allowedIps?: string[]
  requireApprovalOverCost?: number
}

export interface PolicyEvaluationResult {
  allowed: boolean
  action: 'allow' | 'block' | 'flag' | 'require_approval'
  violations: Array<{
    policyId: string
    policyName: string
    rule: string
    reason: string
  }>
}

export async function createPolicy(
  db: DbClient,
  params: {
    orgId: string
    name: string
    description?: string
    type: string
    rules: PolicyRules
    enforcementAction?: 'block' | 'flag' | 'require_approval'
  }
): Promise<Policy> {
  const [inserted] = await db
    .insert(policies)
    .values({
      orgId: params.orgId,
      name: params.name,
      description: params.description || null,
      type: params.type,
      rulesJson: params.rules,
      enforcementAction: params.enforcementAction || 'block',
      status: 'active',
    })
    .returning()

  return inserted
}

export async function listPolicies(
  db: DbClient,
  orgId: string
): Promise<Policy[]> {
  return db
    .select()
    .from(policies)
    .where(eq(policies.orgId, orgId))
    .orderBy(desc(policies.createdAt))
}

export async function evaluateExecutionPolicies(
  db: DbClient,
  params: {
    orgId: string
    capabilityId: string
    cost?: number
    ipAddress?: string
  }
): Promise<PolicyEvaluationResult> {
  const activePolicies = await db
    .select()
    .from(policies)
    .where(and(eq(policies.orgId, params.orgId), eq(policies.status, 'active')))

  const violations: PolicyEvaluationResult['violations'] = []
  let highestAction: 'allow' | 'block' | 'flag' | 'require_approval' = 'allow'

  for (const policy of activePolicies) {
    const rules = policy.rulesJson as PolicyRules
    if (!rules) continue

    // 1. Max Cost per Task check
    if (rules.maxCostPerTask !== undefined && params.cost !== undefined) {
      if (params.cost > rules.maxCostPerTask) {
        violations.push({
          policyId: policy.id,
          policyName: policy.name,
          rule: 'maxCostPerTask',
          reason: `Execution cost $${params.cost} exceeds policy limit of $${rules.maxCostPerTask}`,
        })
        if (policy.enforcementAction === 'block') highestAction = 'block'
        else if (highestAction !== 'block' && policy.enforcementAction === 'require_approval') highestAction = 'require_approval'
      }
    }

    // 2. Blocked Capabilities check
    if (rules.blockedCapabilities?.includes(params.capabilityId)) {
      violations.push({
        policyId: policy.id,
        policyName: policy.name,
        rule: 'blockedCapabilities',
        reason: `Capability ${params.capabilityId} is restricted by policy`,
      })
      highestAction = 'block'
    }

    // 3. Allowed Capabilities check (whitelist mode)
    if (rules.allowedCapabilities && rules.allowedCapabilities.length > 0) {
      if (!rules.allowedCapabilities.includes(params.capabilityId)) {
        violations.push({
          policyId: policy.id,
          policyName: policy.name,
          rule: 'allowedCapabilities',
          reason: `Capability ${params.capabilityId} is not in the allowed capabilities list`,
        })
        highestAction = 'block'
      }
    }

    // 4. IP Allowlist check
    if (rules.allowedIps && rules.allowedIps.length > 0 && params.ipAddress) {
      if (!rules.allowedIps.includes(params.ipAddress)) {
        violations.push({
          policyId: policy.id,
          policyName: policy.name,
          rule: 'allowedIps',
          reason: `Caller IP ${params.ipAddress} is not in the enterprise IP allowlist`,
        })
        highestAction = 'block'
      }
    }
  }

  return {
    allowed: highestAction !== 'block',
    action: highestAction,
    violations,
  }
}
