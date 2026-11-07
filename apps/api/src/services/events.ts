import { events, type DbClient } from '@stealthmark/db'
import { config } from '../config.js'

export type EventType =
  | 'org.created'
  | 'org.updated'
  | 'user.added'
  | 'apikey.created'
  | 'apikey.revoked'
  | 'agent.created'
  | 'agent.updated'
  | 'agent.suspended'
  | 'capability.created'
  | 'capability.updated'
  | 'usage.recorded'
  | 'task.created'
  | 'task.completed'
  | 'task.failed'
  | 'trust.updated'

export interface EmitEventParams {
  type: EventType | string
  payload: Record<string, unknown>
  orgId?: string
}

export async function emitEvent(db: DbClient, params: EmitEventParams): Promise<void> {
  const { type, payload, orgId } = params

  try {
    // 1. Insert into database events table for auditable trace
    await db.insert(events).values({
      type,
      payload,
      orgId: orgId || null,
      processed: false,
    })

    // 2. In production with GCP Pub/Sub configured, publish to topic
    if (config.GCP_PROJECT_ID && config.NODE_ENV === 'production') {
      // Lazy or dynamic PubSub publish
    }
  } catch (err) {
    // We log and do not break caller transaction for non-critical event delivery
    console.error('Failed to emit event:', type, err)
  }
}
