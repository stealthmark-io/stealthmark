import { describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { openApiSpec } from '../openapi.js'
import { emptyResultDb, testApiKeyResolver } from './helpers/test-auth.js'

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
type HttpMethod = (typeof HTTP_METHODS)[number]

interface Operation {
  path: string
  method: HttpMethod
  route: string
}

function documentedOperations(): Operation[] {
  const operations: Operation[] = []
  for (const [path, item] of Object.entries(openApiSpec.paths)) {
    for (const method of HTTP_METHODS) {
      if (method in item) operations.push({ path, method, route: path.replace(/\{(\w+)\}/g, ':$1') })
    }
  }
  return operations
}

describe('the published OpenAPI document matches the routes served by default', () => {
  const operations = documentedOperations()

  it('documents at least the routes the SDK calls', () => {
    const documented = operations.map((operation) => `${operation.method} ${operation.path}`)
    expect(documented).toContain('post /v1/usage/ingest')
    expect(documented).toContain('get /v1/usage/quota')
  })

  it.each(operations)('$method $path is registered with every feature flag off', async ({ method, route }) => {
    const app = await buildApp({ db: emptyResultDb(), apiKeyResolver: testApiKeyResolver(), features: {} })
    try {
      const registered = app.hasRoute({ method: method.toUpperCase() as Uppercase<HttpMethod>, url: route })
      expect(registered).toBe(true)
    } finally {
      await app.close()
    }
  })

  it.each(['/v1/web', '/v1/commerce', '/v1/enterprise', '/v1/publisher', '/v1/capabilities', '/v1/intelligence', '/.well-known', '/v1/gateway/passport', '/v1/gateway/verify', '/v1/gateway/public-key'])(
    'does not document the frozen surface %s',
    (prefix) => {
      expect(Object.keys(openApiSpec.paths).filter((path) => path.startsWith(prefix))).toEqual([])
    },
  )

  it('does not point clients at a host that does not exist', () => {
    const urls = openApiSpec.servers.map((server) => server.url)
    expect(urls).toEqual(['https://api.stealthmark.io'])
  })

  it('serves the same document at /v1/openapi.json', async () => {
    const app = await buildApp({ db: emptyResultDb(), apiKeyResolver: testApiKeyResolver() })
    const res = await app.inject({ method: 'GET', url: '/v1/openapi.json' })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(Object.keys(res.json().paths)).toEqual(Object.keys(openApiSpec.paths))
  })
})
