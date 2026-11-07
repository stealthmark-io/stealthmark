export interface CookieJar {
  values: Map<string, string>
  set: Array<{ name: string; value: string; options?: Record<string, unknown> }>
  deleted: string[]
}

export function newCookieJar(): CookieJar {
  return { values: new Map(), set: [], deleted: [] }
}

/** What `cookies()` from next/headers resolves to, backed by a jar the test can inspect. */
export function cookieStoreOf(jar: CookieJar) {
  return {
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name) as string } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      jar.values.set(name, value)
      jar.set.push({ name, value, options })
    },
    delete: (name: string) => {
      jar.values.delete(name)
      jar.deleted.push(name)
    },
  }
}
