import { eq, and, or, desc } from 'drizzle-orm'
import { killSwitches, type DbClient, type KillSwitch } from '@stealthmark/db'

export async function triggerKillSwitch(
  db: DbClient,
  params: {
    orgId: string
    targetType: 'organization' | 'agent' | 'capability' | 'api_key'
    targetId: string // specific ID or '*' for entire organization
    reason: string
    triggeredBy: string
  }
): Promise<KillSwitch> {
  const [inserted] = await db
    .insert(killSwitches)
    .values({
      orgId: params.orgId,
      targetType: params.targetType,
      targetId: params.targetId,
      reason: params.reason,
      triggeredBy: params.triggeredBy,
      status: 'active',
      triggeredAt: new Date(),
    })
    .returning()

  return inserted
}

export async function disarmKillSwitch(
  db: DbClient,
  params: {
    killSwitchId: string
    orgId: string
  }
): Promise<KillSwitch> {
  const [updated] = await db
    .update(killSwitches)
    .set({
      status: 'disarmed',
      disarmedAt: new Date(),
    })
    .where(and(eq(killSwitches.id, params.killSwitchId), eq(killSwitches.orgId, params.orgId)))
    .returning()

  if (!updated) {
    throw new Error(`Kill switch ${params.killSwitchId} not found or unauthorized`)
  }

  return updated
}

export async function isTargetKilled(
  db: DbClient,
  params: {
    orgId: string
    targetType?: 'organization' | 'agent' | 'capability' | 'api_key'
    targetId?: string
  }
): Promise<{ killed: boolean; reason?: string; killSwitchId?: string }> {
  // Check if entire organization is killed OR specific target is killed
  const activeHalt = await db
    .select()
    .from(killSwitches)
    .where(
      and(
        eq(killSwitches.orgId, params.orgId),
        eq(killSwitches.status, 'active')
      )
    )

  for (const ks of activeHalt) {
    if (ks.targetId === '*' || ks.targetType === 'organization') {
      return {
        killed: true,
        reason: `Organization-wide Emergency Kill Switch active: ${ks.reason}`,
        killSwitchId: ks.id,
      }
    }
    if (params.targetId && ks.targetId === params.targetId) {
      return {
        killed: true,
        reason: `Target ${params.targetType} is halted: ${ks.reason}`,
        killSwitchId: ks.id,
      }
    }
  }

  return { killed: false }
}

export async function listKillSwitches(
  db: DbClient,
  orgId: string
): Promise<KillSwitch[]> {
  return db
    .select()
    .from(killSwitches)
    .where(eq(killSwitches.orgId, orgId))
    .orderBy(desc(killSwitches.triggeredAt))
}
