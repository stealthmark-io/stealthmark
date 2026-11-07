/**
 * Minimal in-memory stand-in for the supabase-js query builder, enough for the PostgREST calls the web server
 * makes against one table: select (with count), insert, update, delete with eq/neq/is/gt/gte filters.
 * Unique constraints are declared per table so conflicts answer with Postgres error code 23505.
 */
type Row = Record<string, unknown>
type Filter = { op: 'eq' | 'neq' | 'is' | 'gt' | 'gte'; column: string; value: unknown }
interface Result {
  data: Row[] | Row | null
  error: { code: string; message: string } | null
  count: number | null
}

export interface FakeTableOptions {
  defaults?: () => Row
  unique?: string[][]
}

class Query implements PromiseLike<Result> {
  private action: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private filters: Filter[] = []
  private payload: Row = {}
  private head = false
  private wantsCount = false
  private returning = false
  private single_ = false
  private maybeSingle_ = false
  private orderBy: { column: string; ascending: boolean } | null = null
  private max = Infinity

  constructor(private readonly rows: Row[], private readonly options: FakeTableOptions) {}

  select(_columns?: string, options?: { count?: 'exact'; head?: boolean }) {
    if (this.action === 'select') {
      this.head = options?.head === true
      this.wantsCount = options?.count === 'exact'
    } else {
      this.returning = true
    }
    return this
  }
  insert(values: Row) { this.action = 'insert'; this.payload = values; return this }
  update(values: Row) { this.action = 'update'; this.payload = values; return this }
  delete() { this.action = 'delete'; return this }
  eq(column: string, value: unknown) { this.filters.push({ op: 'eq', column, value }); return this }
  neq(column: string, value: unknown) { this.filters.push({ op: 'neq', column, value }); return this }
  is(column: string, value: unknown) { this.filters.push({ op: 'is', column, value }); return this }
  gt(column: string, value: unknown) { this.filters.push({ op: 'gt', column, value }); return this }
  gte(column: string, value: unknown) { this.filters.push({ op: 'gte', column, value }); return this }
  order(column: string, options: { ascending: boolean }) { this.orderBy = { column, ascending: options.ascending }; return this }
  limit(count: number) { this.max = count; return this }
  single() { this.single_ = true; return this }
  maybeSingle() { this.maybeSingle_ = true; return this }

  private matches(row: Row): boolean {
    return this.filters.every(({ op, column, value }) => {
      const actual = row[column]
      switch (op) {
        case 'eq': return actual === value
        case 'neq': return actual !== value
        case 'is': return actual === value
        case 'gt': return String(actual) > String(value)
        case 'gte': return String(actual) >= String(value)
      }
    })
  }

  private run(): Result {
    if (this.action === 'insert') {
      const row: Row = { ...(this.options.defaults?.() ?? {}), ...this.payload }
      for (const columns of this.options.unique ?? []) {
        if (this.rows.some((existing) => columns.every((column) => existing[column] === row[column]))) {
          return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${columns.join(',')}` }, count: null }
        }
      }
      this.rows.push(row)
      return { data: this.single_ ? row : [row], error: null, count: null }
    }
    if (this.action === 'update') {
      const touched = this.rows.filter((row) => this.matches(row))
      for (const row of touched) Object.assign(row, this.payload)
      return { data: this.returning ? touched : null, error: null, count: null }
    }
    if (this.action === 'delete') {
      const keep = this.rows.filter((row) => !this.matches(row))
      this.rows.splice(0, this.rows.length, ...keep)
      return { data: null, error: null, count: null }
    }
    let found = this.rows.filter((row) => this.matches(row))
    if (this.orderBy) {
      const { column, ascending } = this.orderBy
      found = [...found].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1))
    }
    const count = this.wantsCount ? found.length : null
    if (this.maybeSingle_) return { data: found[0] ?? null, error: null, count }
    return { data: this.head ? null : found.slice(0, this.max), error: null, count }
  }

  then<R1 = Result, R2 = never>(
    onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected)
  }
}

export class FakeSupabase {
  private tables = new Map<string, { rows: Row[]; options: FakeTableOptions }>()

  table(name: string, options: FakeTableOptions = {}): Row[] {
    const existing = this.tables.get(name)
    if (existing) return existing.rows
    const created = { rows: [] as Row[], options }
    this.tables.set(name, created)
    return created.rows
  }

  from(name: string) {
    const entry = this.tables.get(name)
    if (!entry) throw new Error(`FakeSupabase: table ${name} is not declared`)
    return new Query(entry.rows, entry.options)
  }
}
