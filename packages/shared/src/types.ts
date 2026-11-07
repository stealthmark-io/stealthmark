// ═══════════════════════════════════════════
// StealthMark — Shared Types
// ═══════════════════════════════════════════

/** Capability type taxonomy */
export type CapabilityType = 'primitive' | 'tool' | 'skill' | 'agent'

/** Supported protocols */
export type Protocol = 'REST' | 'MCP' | 'A2A' | 'ARD'

/** Trust score labels */
export type TrustLabel = 'new' | 'emerging' | 'established' | 'trusted'

/** Task lifecycle statuses */
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

/** API key status */
export type ApiKeyStatus = 'active' | 'revoked' | 'expired'

/** Organization plan */
export type OrgPlan = 'free' | 'starter' | 'pro' | 'enterprise'

/** User role within an organization */
export type UserRole = 'owner' | 'admin' | 'member'

/** Resource status */
export type ResourceStatus = 'active' | 'suspended' | 'deleted'

/** API key scopes */
export const API_SCOPES = [
  'web:vision',
  'web:extract',
  'web:search',
  'web:screenshot',
  'web:browser',
  'capabilities:read',
  'capabilities:write',
  'agents:read',
  'agents:write',
  'discovery:search',
  'tasks:read',
  'tasks:write',
  'billing:read',
  'billing:write',
] as const

export type ApiScope = (typeof API_SCOPES)[number]
