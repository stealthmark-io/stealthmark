import { describe, it, expect } from 'vitest'
import { organizations, capabilities, apiKeys, users } from '../schema.js'

describe('Database Schema', () => {
  it('defines organizations table correctly', () => {
    expect(organizations.id).toBeDefined()
    expect(organizations.name).toBeDefined()
    expect(organizations.slug).toBeDefined()
  })

  it('defines capabilities table with orgId and slug', () => {
    expect(capabilities.slug).toBeDefined()
    expect(capabilities.orgId).toBeDefined()
    expect(capabilities.type).toBeDefined()
    expect(capabilities.protocols).toBeDefined()
    expect(capabilities.embedding).toBeDefined()
  })

  it('defines api_keys table with keyHash and keyPrefix', () => {
    expect(apiKeys.keyHash).toBeDefined()
    expect(apiKeys.keyPrefix).toBeDefined()
    expect(apiKeys.scopes).toBeDefined()
  })

  it('defines users table with orgId and email', () => {
    expect(users.orgId).toBeDefined()
    expect(users.email).toBeDefined()
    expect(users.role).toBeDefined()
  })

  it('defines negotiations, contracts, and escrows tables correctly', async () => {
    const { negotiations, contracts, escrows } = await import('../schema.js')
    expect(negotiations.currentOffer).toBeDefined()
    expect(negotiations.status).toBeDefined()
    expect(contracts.termsHash).toBeDefined()
    expect(contracts.termsJson).toBeDefined()
    expect(escrows.amount).toBeDefined()
    expect(escrows.feeAmount).toBeDefined()
    expect(escrows.netAmount).toBeDefined()
    expect(escrows.status).toBeDefined()
  })

  it('defines enterprise governance tables (policies, audit_logs, kill_switches, private_registries)', async () => {
    const { policies, auditLogs, killSwitches, privateRegistries } = await import('../schema.js')
    expect(policies.rulesJson).toBeDefined()
    expect(policies.enforcementAction).toBeDefined()
    expect(auditLogs.logHash).toBeDefined()
    expect(auditLogs.prevHash).toBeDefined()
    expect(killSwitches.targetType).toBeDefined()
    expect(killSwitches.targetId).toBeDefined()
    expect(privateRegistries.allowedOrgIds).toBeDefined()
  })

  it('defines agent_context table correctly for Phase 7 Agent Intelligence', async () => {
    const { agentContext } = await import('../schema.js')
    expect(agentContext.agentId).toBeDefined()
    expect(agentContext.capabilityId).toBeDefined()
    expect(agentContext.totalExecutions).toBeDefined()
    expect(agentContext.successfulExecutions).toBeDefined()
    expect(agentContext.preferenceScore).toBeDefined()
    expect(agentContext.contextType).toBeDefined()
  })

  it('defines registered_sites, agent_passports, and gateway_access_events tables for Phase 8 Agent Access & Passport', async () => {
    const { registeredSites, agentPassports, gatewayAccessEvents } = await import('../schema.js')
    expect(registeredSites.domain).toBeDefined()
    expect(registeredSites.dnsVerificationToken).toBeDefined()
    expect(registeredSites.accessPolicy).toBeDefined()
    expect(registeredSites.passportTtlSeconds).toBeDefined()
    expect(agentPassports.passportJti).toBeDefined()
    expect(agentPassports.scopesGranted).toBeDefined()
    expect(agentPassports.trustLevel).toBeDefined()
    expect(agentPassports.behavioralScore).toBeDefined()
    expect(gatewayAccessEvents.prevHash).toBeDefined()
    expect(gatewayAccessEvents.eventHash).toBeDefined()
    expect(gatewayAccessEvents.action).toBeDefined()
  })
})

describe('connection string policy', () => {
  it('requires SSL and disables prepared statements for the Supabase pooler, not for localhost', async () => {
    const { requiresSsl, usesTransactionPooler } = await import('../client.js')
    const pooler = 'postgresql://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres'
    const local = 'postgresql://stealthmark:dev@localhost:5432/stealthmark'
    expect(requiresSsl(pooler)).toBe(true)
    expect(usesTransactionPooler(pooler)).toBe(true)
    expect(requiresSsl(local)).toBe(false)
    expect(usesTransactionPooler(local)).toBe(false)
    expect(requiresSsl('postgresql://u:p@db.example.com:5432/x?sslmode=require')).toBe(true)
  })
})
