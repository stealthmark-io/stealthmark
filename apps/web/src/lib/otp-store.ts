import { createSupabaseAdminClient } from '@/lib/supabase/admin'

/**
 * Server-side storage of email OTP challenges. Every method is a single atomic step, so the service in lib/otp.ts
 * can enforce attempt caps, cooldowns and single use without trusting anything the client holds.
 */
export interface OtpChallengeRow {
  id: string
  email: string
  codeHash: string
  attempts: number
  expiresAt: number
  consumedAt: number | null
  requestedIp: string | null
  windowStart: number
  createdAt: number
}

export interface NewOtpChallenge {
  email: string
  codeHash: string
  requestedIp: string | null
  /** floor(epoch ms / 60 000): at most one challenge per email per window. */
  windowStart: number
  expiresAt: number
}

export interface OtpStore {
  countSince(filter: { email?: string; ip?: string }, sinceMs: number): Promise<number>
  /** Resolves to 'duplicate_window' when the email already has a challenge in the same minute. */
  insert(challenge: NewOtpChallenge): Promise<{ id: string } | 'duplicate_window'>
  /** Marks every other unconsumed challenge of the email as used, so only the newest code can succeed. */
  invalidateOthers(email: string, keepId: string, nowMs: number): Promise<void>
  remove(id: string): Promise<void>
  latestActive(email: string, nowMs: number): Promise<OtpChallengeRow | null>
  /** Compare-and-set on the attempts counter: true for exactly one of several concurrent callers. */
  claimAttempt(id: string, currentAttempts: number): Promise<boolean>
  /** True only for the caller that flips consumed_at from null; a code can therefore succeed once. */
  consume(id: string, nowMs: number): Promise<boolean>
}

export class MemoryOtpStore implements OtpStore {
  private rows: OtpChallengeRow[] = []
  private sequence = 0

  async countSince(filter: { email?: string; ip?: string }, sinceMs: number): Promise<number> {
    return this.rows.filter(
      (row) =>
        row.createdAt >= sinceMs &&
        (filter.email === undefined || row.email === filter.email) &&
        (filter.ip === undefined || row.requestedIp === filter.ip),
    ).length
  }

  async insert(challenge: NewOtpChallenge): Promise<{ id: string } | 'duplicate_window'> {
    if (this.rows.some((row) => row.email === challenge.email && row.windowStart === challenge.windowStart)) {
      return 'duplicate_window'
    }
    this.sequence += 1
    const row: OtpChallengeRow = {
      id: `memory-${this.sequence}`,
      email: challenge.email,
      codeHash: challenge.codeHash,
      attempts: 0,
      expiresAt: challenge.expiresAt,
      consumedAt: null,
      requestedIp: challenge.requestedIp,
      windowStart: challenge.windowStart,
      createdAt: Date.now(),
    }
    this.rows.push(row)
    return { id: row.id }
  }

  async invalidateOthers(email: string, keepId: string, nowMs: number): Promise<void> {
    for (const row of this.rows) {
      if (row.email === email && row.id !== keepId && row.consumedAt === null) row.consumedAt = nowMs
    }
  }

  async remove(id: string): Promise<void> {
    this.rows = this.rows.filter((row) => row.id !== id)
  }

  async latestActive(email: string, nowMs: number): Promise<OtpChallengeRow | null> {
    const active = this.rows
      .filter((row) => row.email === email && row.consumedAt === null && row.expiresAt > nowMs)
      .sort((a, b) => b.createdAt - a.createdAt || b.windowStart - a.windowStart)
    return active[0] ? { ...active[0] } : null
  }

  async claimAttempt(id: string, currentAttempts: number): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id)
    if (!row || row.consumedAt !== null || row.attempts !== currentAttempts) return false
    row.attempts += 1
    return true
  }

  async consume(id: string, nowMs: number): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id)
    if (!row || row.consumedAt !== null) return false
    row.consumedAt = nowMs
    return true
  }
}

const TABLE = 'otp_challenges'
const UNIQUE_VIOLATION = '23505'
const COLUMNS = 'id, email, code_hash, attempts, expires_at, consumed_at, requested_ip, window_start, created_at'

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>

interface OtpChallengeRecord {
  id: string
  email: string
  code_hash: string
  attempts: number
  expires_at: string
  consumed_at: string | null
  requested_ip: string | null
  window_start: number
  created_at: string
}

function toRow(record: OtpChallengeRecord): OtpChallengeRow {
  return {
    id: record.id,
    email: record.email,
    codeHash: record.code_hash,
    attempts: record.attempts,
    expiresAt: Date.parse(record.expires_at),
    consumedAt: record.consumed_at ? Date.parse(record.consumed_at) : null,
    requestedIp: record.requested_ip,
    windowStart: Number(record.window_start),
    createdAt: Date.parse(record.created_at),
  }
}

const iso = (ms: number) => new Date(ms).toISOString()

export class SupabaseOtpStore implements OtpStore {
  constructor(private readonly client: AdminClient) {}

  async countSince(filter: { email?: string; ip?: string }, sinceMs: number): Promise<number> {
    let query = this.client.from(TABLE).select('id', { count: 'exact', head: true }).gte('created_at', iso(sinceMs))
    if (filter.email !== undefined) query = query.eq('email', filter.email)
    if (filter.ip !== undefined) query = query.eq('requested_ip', filter.ip)
    const { count, error } = await query
    if (error) throw new Error(`otp_store_count_failed: ${error.message}`)
    return count ?? 0
  }

  async insert(challenge: NewOtpChallenge): Promise<{ id: string } | 'duplicate_window'> {
    const { data, error } = await this.client
      .from(TABLE)
      .insert({
        email: challenge.email,
        code_hash: challenge.codeHash,
        requested_ip: challenge.requestedIp,
        window_start: challenge.windowStart,
        expires_at: iso(challenge.expiresAt),
      })
      .select('id')
      .single()
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return 'duplicate_window'
      throw new Error(`otp_store_insert_failed: ${error.message}`)
    }
    return { id: String(data.id) }
  }

  async invalidateOthers(email: string, keepId: string, nowMs: number): Promise<void> {
    const { error } = await this.client
      .from(TABLE)
      .update({ consumed_at: iso(nowMs) })
      .eq('email', email)
      .is('consumed_at', null)
      .neq('id', keepId)
    if (error) throw new Error(`otp_store_invalidate_failed: ${error.message}`)
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client.from(TABLE).delete().eq('id', id)
    if (error) throw new Error(`otp_store_remove_failed: ${error.message}`)
  }

  async latestActive(email: string, nowMs: number): Promise<OtpChallengeRow | null> {
    const { data, error } = await this.client
      .from(TABLE)
      .select(COLUMNS)
      .eq('email', email)
      .is('consumed_at', null)
      .gt('expires_at', iso(nowMs))
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) throw new Error(`otp_store_lookup_failed: ${error.message}`)
    const record: OtpChallengeRecord | undefined = data?.[0]
    return record ? toRow(record) : null
  }

  async claimAttempt(id: string, currentAttempts: number): Promise<boolean> {
    const { data, error } = await this.client
      .from(TABLE)
      .update({ attempts: currentAttempts + 1 })
      .eq('id', id)
      .eq('attempts', currentAttempts)
      .is('consumed_at', null)
      .select('id')
    if (error) throw new Error(`otp_store_claim_failed: ${error.message}`)
    return (data?.length ?? 0) === 1
  }

  async consume(id: string, nowMs: number): Promise<boolean> {
    const { data, error } = await this.client
      .from(TABLE)
      .update({ consumed_at: iso(nowMs) })
      .eq('id', id)
      .is('consumed_at', null)
      .select('id')
    if (error) throw new Error(`otp_store_consume_failed: ${error.message}`)
    return (data?.length ?? 0) === 1
  }
}

let memoryStore: MemoryOtpStore | null = null

/**
 * Supabase when the service role is configured. Outside production a process-local store keeps local development
 * working; in production a missing store means the native email login is unavailable, never weaker.
 */
export function getOtpStore(): OtpStore | null {
  const client = createSupabaseAdminClient()
  if (client) return new SupabaseOtpStore(client)
  if (process.env.NODE_ENV === 'production') return null
  memoryStore ??= new MemoryOtpStore()
  return memoryStore
}
