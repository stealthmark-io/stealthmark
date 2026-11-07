import type { TxtResolver } from '../../services/site-registration.js'

/** TXT resolver backed by a fixed host -> values table; any other host fails like an unregistered name. */
export function fakeTxtResolver(records: Record<string, string[]>): TxtResolver {
  const table = new Map(Object.entries(records).map(([host, values]) => [host.toLowerCase(), values]))
  return async (host) => {
    const values = table.get(host.toLowerCase())
    if (!values) {
      throw Object.assign(new Error(`queryTxt ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
    }
    return values.map((value) => [value])
  }
}
