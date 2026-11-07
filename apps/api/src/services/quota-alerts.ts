import { and, asc, eq } from 'drizzle-orm'
import { organizations, users, type DbClient } from '@stealthmark/db'
import { config } from '../config.js'
import { sendEmail, type SendEmailParams, type SendEmailResult } from './email.js'
import type { QuotaSnapshot } from './quota.js'

export type QuotaAlertLevel = 80 | 100

export interface AlertLogger {
  info: (obj: object, msg: string) => void
  warn: (obj: object, msg: string) => void
}

export interface QuotaAlertDeps {
  send?: (params: SendEmailParams) => Promise<SendEmailResult>
  /** Defaults to RESEND_API_KEY. When absent the alert is logged and skipped. */
  apiKey?: string
  /** Defaults to QUOTA_ALERT_FROM. */
  from?: string
  logger?: AlertLogger
}

const silentLogger: AlertLogger = { info: () => undefined, warn: () => undefined }

export function alertLevelFor(quota: QuotaSnapshot): QuotaAlertLevel | null {
  if (quota.alertCap <= 0) return null
  const ratio = quota.used / quota.alertCap
  if (ratio >= 1) return 100
  if (ratio >= 0.8) return 80
  return null
}

function sentThisPeriod(stamp: Date | null, periodStart: Date): boolean {
  return stamp !== null && stamp.getTime() >= periodStart.getTime()
}

function alreadyAlerted(quota: QuotaSnapshot, level: QuotaAlertLevel): boolean {
  const sent100 = sentThisPeriod(quota.alert100SentAt, quota.periodStart)
  const sent80 = sentThisPeriod(quota.alert80SentAt, quota.periodStart)
  return level === 100 ? sent100 : sent80 || sent100
}

interface Claim {
  orgName: string
  previous: { alert80SentAt: Date | null; alert100SentAt: Date | null }
}

/** Stamps the alert inside a locked transaction so concurrent ingests send each alert at most once per period. */
async function claimAlert(
  db: DbClient,
  orgId: string,
  level: QuotaAlertLevel,
  periodStart: Date,
  now: Date,
): Promise<Claim | null> {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .select({
        name: organizations.name,
        quotaAlert80SentAt: organizations.quotaAlert80SentAt,
        quotaAlert100SentAt: organizations.quotaAlert100SentAt,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for('update')
      .limit(1)
    if (!org) return null

    const sent80 = sentThisPeriod(org.quotaAlert80SentAt, periodStart)
    const sent100 = sentThisPeriod(org.quotaAlert100SentAt, periodStart)
    if (level === 100 ? sent100 : sent80 || sent100) return null

    const stamps =
      level === 100
        ? { quotaAlert100SentAt: now, quotaAlert80SentAt: sent80 ? org.quotaAlert80SentAt : now }
        : { quotaAlert80SentAt: now }
    await tx.update(organizations).set(stamps).where(eq(organizations.id, orgId))

    return {
      orgName: org.name,
      previous: { alert80SentAt: org.quotaAlert80SentAt, alert100SentAt: org.quotaAlert100SentAt },
    }
  })
}

async function releaseClaim(db: DbClient, orgId: string, claim: Claim): Promise<void> {
  await db
    .update(organizations)
    .set({
      quotaAlert80SentAt: claim.previous.alert80SentAt,
      quotaAlert100SentAt: claim.previous.alert100SentAt,
    })
    .where(eq(organizations.id, orgId))
}

async function findAlertRecipient(db: DbClient, orgId: string): Promise<string | null> {
  const [owner] = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.role, 'owner')))
    .orderBy(asc(users.createdAt))
    .limit(1)
  if (owner) return owner.email

  const [oldest] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.orgId, orgId))
    .orderBy(asc(users.createdAt))
    .limit(1)
  return oldest?.email ?? null
}

export function buildAlertMessage(
  level: QuotaAlertLevel,
  orgName: string,
  quota: QuotaSnapshot,
): { subject: string; text: string } {
  const usage = `${quota.used.toLocaleString('en-US')} of ${quota.alertCap.toLocaleString('en-US')} agent events`
  if (level === 100) {
    return {
      subject: 'StealthMark: monthly agent event limit reached',
      text: [
        `${orgName} has used ${usage} this month (period ${quota.periodMonth}).`,
        '',
        'Your site keeps serving traffic normally. StealthMark stops reporting and metering new agent events until the next period or until you upgrade.',
        '',
        'Manage your plan: https://stealthmark.io/dashboard',
      ].join('\n'),
    }
  }
  return {
    subject: 'StealthMark: you have used 80% of your monthly agent events',
    text: [
      `${orgName} has used ${usage} this month (period ${quota.periodMonth}).`,
      '',
      'When the limit is reached your site keeps serving traffic normally, but StealthMark stops reporting new agent events.',
      '',
      'Manage your plan: https://stealthmark.io/dashboard',
    ].join('\n'),
  }
}

/**
 * Sends the 80% / 100% quota email once per period to the organization owner (oldest user as fallback).
 * Never throws and never affects the ingest that triggered it.
 */
export async function checkQuotaAlerts(
  db: DbClient,
  orgId: string,
  quota: QuotaSnapshot,
  deps: QuotaAlertDeps = {},
  now: Date = new Date(),
): Promise<QuotaAlertLevel | null> {
  const logger = deps.logger ?? silentLogger
  try {
    const level = alertLevelFor(quota)
    if (level === null || alreadyAlerted(quota, level)) return null

    const apiKey = deps.apiKey ?? config.RESEND_API_KEY
    if (!apiKey) {
      logger.info({ orgId, level }, 'Quota alert skipped: RESEND_API_KEY is not configured')
      return null
    }

    const claim = await claimAlert(db, orgId, level, quota.periodStart, now)
    if (!claim) return null

    const recipient = await findAlertRecipient(db, orgId)
    if (!recipient) {
      await releaseClaim(db, orgId, claim)
      logger.warn({ orgId, level }, 'Quota alert skipped: organization has no users to notify')
      return null
    }

    const message = buildAlertMessage(level, claim.orgName, quota)
    const send = deps.send ?? sendEmail
    const result = await send({
      apiKey,
      from: deps.from ?? config.QUOTA_ALERT_FROM,
      to: recipient,
      ...message,
    })

    if (!result.sent) {
      await releaseClaim(db, orgId, claim)
      logger.warn({ orgId, level, reason: result.reason }, 'Quota alert email failed; it will be retried on the next ingest')
      return null
    }

    logger.info({ orgId, level }, 'Quota alert email sent')
    return level
  } catch (error) {
    logger.warn({ orgId, err: error }, 'Quota alert check failed')
    return null
  }
}
