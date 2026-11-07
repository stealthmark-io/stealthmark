/**
 * OpenAPI description of the routes this API serves with every FEATURE_* flag off (the production default).
 * A route belongs here only while it is registered under the default flags: openapi.test.ts fails otherwise.
 * Routes of the frozen surfaces (commerce, passports) are documented when their flag is switched on, not before.
 */

const uuid = { type: 'string', format: 'uuid' } as const

function pathParam(name: string, schema: object = uuid) {
  return { name, in: 'path', required: true, schema }
}

function jsonBody(schema: object, description?: string) {
  return {
    required: true,
    ...(description ? { description } : {}),
    content: { 'application/json': { schema } },
  }
}

function jsonResponse(description: string, schema: object = { type: 'object' }) {
  return { description, content: { 'application/json': { schema } } }
}

const orgIdQuery = {
  name: 'orgId',
  in: 'query',
  required: false,
  description: 'Organization to act on. Honored only when it matches the API key organization or the key is a platform key.',
  schema: uuid,
} as const

const standardErrors = {
  '401': { description: 'Missing or invalid API key' },
  '429': { description: 'Rate limit exceeded' },
} as const

const usageEvent = {
  type: 'object',
  properties: {
    event_id: { ...uuid, description: 'Idempotency key. A repeated (organization, event_id) is stored once and counted as a duplicate.' },
    event_type: { type: 'string', enum: ['agent_request', 'agent_blocked', 'agent_manifest'] },
    site_id: { ...uuid, description: 'A site registered by the same organization. Unknown ids are dropped.' },
    agent_identifier: { type: 'string', minLength: 1, maxLength: 256 },
    occurred_at: { type: 'string', format: 'date-time' },
    metadata: {
      type: 'object',
      description: 'Only path, method, host, status and reason are stored; at most 1024 bytes once serialized.',
    },
  },
} as const

const quotaFields = {
  cap: { type: ['integer', 'null'] },
  used: { type: 'integer' },
  remaining: { type: ['integer', 'null'] },
  billing_mode: { type: 'string', enum: ['free', 'credits', 'enterprise'] },
} as const

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'StealthMark API',
    version: '1.0.0',
    description:
      'Control plane for the StealthMark SDK. Sites register, the SDK reports AI agent events to /v1/usage/ingest, and these routes expose quota, usage, keys and per-site activity.',
    contact: {
      name: 'StealthMark',
      url: 'https://stealthmark.io',
    },
  },
  servers: [
    {
      url: 'https://api.stealthmark.io',
      description: 'Production',
    },
  ],
  paths: {
    '/v1/usage/ingest': {
      post: {
        summary: 'Report agent events from the SDK',
        description:
          'Batches of 1 to 500 events. Units are decided by the server: one per agent_request or agent_manifest, none for agent_blocked. Events beyond the quota are not stored.',
        operationId: 'ingestUsage',
        requestBody: jsonBody({
          type: 'object',
          required: ['events'],
          properties: { events: { type: 'array', minItems: 1, maxItems: 500, items: usageEvent } },
        }),
        responses: {
          '200': jsonResponse('Batch processed', {
            type: 'object',
            properties: {
              accepted: { type: 'integer' },
              rejected: { type: 'integer' },
              duplicates: { type: 'integer' },
              skipped_blocked: { type: 'integer' },
              ...quotaFields,
            },
          }),
          '400': { description: 'Validation error' },
          '429': { description: 'Quota exhausted (quota_exceeded) or rate limit exceeded; honor Retry-After' },
          '401': standardErrors['401'],
        },
      },
    },
    '/v1/usage/quota': {
      get: {
        summary: 'Quota of the organization for the current month',
        operationId: 'getUsageQuota',
        parameters: [orgIdQuery],
        responses: {
          '200': jsonResponse('Quota snapshot', {
            type: 'object',
            properties: { ...quotaFields, percent: { type: 'number' }, period_month: { type: 'string' } },
          }),
          '404': { description: 'Organization not found' },
          ...standardErrors,
        },
      },
    },
    '/v1/usage': {
      get: {
        summary: 'Usage records of the organization',
        operationId: 'listUsage',
        parameters: [
          orgIdQuery,
          { name: 'from', in: 'query', required: false, schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', required: false, schema: { type: 'string', format: 'date-time' } },
        ],
        responses: { '200': jsonResponse('Usage records'), ...standardErrors },
      },
    },
    '/v1/usage/costs': {
      get: {
        summary: 'Request count and cost for the current month',
        operationId: 'getUsageCosts',
        parameters: [orgIdQuery],
        responses: { '200': jsonResponse('Current period totals'), ...standardErrors },
      },
    },
    '/v1/api-keys': {
      get: {
        summary: 'List API keys of the organization',
        operationId: 'listApiKeys',
        parameters: [orgIdQuery],
        responses: { '200': jsonResponse('API keys in data (the secret is never returned)'), ...standardErrors },
      },
      post: {
        summary: 'Create an API key',
        description: 'The key is returned once. A key can only grant scopes it holds itself.',
        operationId: 'createApiKey',
        requestBody: jsonBody({
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            orgId: uuid,
            scopes: { type: 'array', items: { type: 'string' } },
            rateLimitRpm: { type: 'integer', minimum: 1, default: 60 },
            rateLimitRpd: { type: 'integer', minimum: 1, default: 10000 },
          },
        }),
        responses: { '201': jsonResponse('Key created'), '400': { description: 'Validation error' }, '403': { description: 'Scope or organization not allowed' }, ...standardErrors },
      },
    },
    '/v1/api-keys/{id}': {
      delete: {
        summary: 'Revoke an API key',
        operationId: 'revokeApiKey',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'Key revoked' }, '404': { description: 'Key not found' }, ...standardErrors },
      },
    },
    '/v1/organizations': {
      post: {
        summary: 'Create an organization (platform callers only)',
        operationId: 'createOrganization',
        responses: { '201': { description: 'Organization created' }, '400': { description: 'Validation error' }, '403': { description: 'Platform key required' }, '409': { description: 'Slug already taken' }, ...standardErrors },
      },
    },
    '/v1/organizations/{id}': {
      get: {
        summary: 'Get an organization',
        operationId: 'getOrganization',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'Organization' }, '404': { description: 'Not found, or not your organization' }, ...standardErrors },
      },
      patch: {
        summary: 'Update an organization (plan changes require a platform key)',
        operationId: 'updateOrganization',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'Organization updated' }, '400': { description: 'Validation error' }, '403': { description: 'Plan change requires a platform key' }, '404': { description: 'Not found, or not your organization' }, ...standardErrors },
      },
    },
    '/v1/organizations/{id}/users': {
      get: {
        summary: 'List users of an organization',
        operationId: 'listOrganizationUsers',
        parameters: [pathParam('id')],
        responses: { '200': jsonResponse('Users in data'), '404': { description: 'Not found, or not your organization' }, ...standardErrors },
      },
      post: {
        summary: 'Add a user to an organization',
        operationId: 'addOrganizationUser',
        parameters: [pathParam('id')],
        responses: { '201': { description: 'User added' }, '400': { description: 'Validation error' }, '403': { description: 'Roles other than member require a platform key' }, '404': { description: 'Not found, or not your organization' }, ...standardErrors },
      },
    },
    '/v1/users/{id}': {
      get: {
        summary: 'Get a user',
        operationId: 'getUser',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'User' }, '404': { description: 'Not found' }, ...standardErrors },
      },
      delete: {
        summary: 'Delete a user',
        operationId: 'deleteUser',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'User deleted' }, '404': { description: 'Not found' }, ...standardErrors },
      },
    },
    '/v1/agents': {
      get: {
        summary: 'List agents of the organization',
        operationId: 'listAgents',
        responses: { '200': jsonResponse('Agents in data'), ...standardErrors },
      },
      post: {
        summary: 'Register an agent',
        operationId: 'createAgent',
        responses: { '201': { description: 'Agent registered' }, '400': { description: 'Validation error' }, ...standardErrors },
      },
    },
    '/v1/agents/{id}': {
      get: {
        summary: 'Get an agent',
        operationId: 'getAgent',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'Agent' }, '404': { description: 'Not found' }, ...standardErrors },
      },
      patch: {
        summary: 'Update an agent',
        operationId: 'updateAgent',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'Agent updated' }, '404': { description: 'Not found' }, ...standardErrors },
      },
    },
    '/v1/agents/{id}/suspend': {
      post: {
        summary: 'Suspend an agent',
        operationId: 'suspendAgent',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'Agent suspended' }, '404': { description: 'Not found' }, ...standardErrors },
      },
    },
    '/v1/gateway/sites': {
      get: {
        summary: 'List registered sites',
        operationId: 'listSites',
        parameters: [
          orgIdQuery,
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
          { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: { '200': jsonResponse('Sites and nextCursor'), ...standardErrors },
      },
      post: {
        summary: 'Register a site',
        description: 'The site starts as pending and becomes active only after its DNS TXT record is verified.',
        operationId: 'registerSite',
        requestBody: jsonBody({
          type: 'object',
          required: ['domain', 'displayName'],
          properties: { domain: { type: 'string', minLength: 3 }, displayName: { type: 'string', minLength: 1 }, orgId: uuid },
        }),
        responses: { '201': { description: 'Site registered with its DNS verification record' }, '400': { description: 'Validation error' }, '409': { description: 'Domain already registered' }, ...standardErrors },
      },
    },
    '/v1/gateway/sites/{id}': {
      get: {
        summary: 'Get a site',
        operationId: 'getSite',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'Site' }, '403': { description: 'Not your site' }, '404': { description: 'Not found' }, ...standardErrors },
      },
      patch: {
        summary: 'Update site settings',
        description: 'Setting status to active requires a DNS-verified site (409 dns_not_verified otherwise).',
        operationId: 'updateSite',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'Site updated' }, '409': { description: 'dns_not_verified' }, '403': { description: 'Not your site' }, ...standardErrors },
      },
      delete: {
        summary: 'Deregister a site (admin scope)',
        operationId: 'deleteSite',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'Site deleted' }, '403': { description: 'Admin scope required' }, ...standardErrors },
      },
    },
    '/v1/gateway/sites/{id}/verify': {
      post: {
        summary: 'Verify the DNS TXT record of a site',
        operationId: 'verifySiteDns',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'Verified; the site is now active' }, '400': { description: 'Record not found or token mismatch' }, ...standardErrors },
      },
    },
    '/v1/gateway/sites/{id}/access': {
      post: {
        summary: 'Record an agent access event for a site',
        operationId: 'recordSiteAccess',
        parameters: [pathParam('id')],
        responses: { '201': { description: 'Event recorded' }, '400': { description: 'Validation error' }, '403': { description: 'Not your site' }, ...standardErrors },
      },
    },
    '/v1/gateway/sites/{id}/events': {
      get: {
        summary: 'Access events of a site',
        operationId: 'listSiteEvents',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'Events and nextCursor' }, '403': { description: 'Not your site' }, ...standardErrors },
      },
    },
    '/v1/gateway/sites/{id}/events/verify': {
      get: {
        summary: 'Verify the SHA-256 hash chain of the access events of a site',
        operationId: 'verifySiteEventChain',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'Chain verification result' }, '403': { description: 'Not your site' }, ...standardErrors },
      },
    },
    '/v1/gateway/sites/{id}/analytics': {
      get: {
        summary: 'Aggregated access analytics of a site',
        operationId: 'getSiteAnalytics',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'Analytics' }, '403': { description: 'Not your site' }, ...standardErrors },
      },
    },
    '/v1/gateway/sites/{id}/actions': {
      get: {
        summary: 'List the action schemas of a site (owner only)',
        operationId: 'listSiteActions',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'Action schemas' }, '403': { description: 'Not your site' }, '404': { description: 'Site not found' }, ...standardErrors },
      },
      post: {
        summary: 'Create an action schema for a site',
        operationId: 'createSiteAction',
        parameters: [pathParam('id')],
        responses: { '201': { description: 'Action schema created' }, '400': { description: 'Validation error' }, '403': { description: 'Not your site' }, '409': { description: 'Slug already exists for this site' }, ...standardErrors },
      },
    },
    '/v1/gateway/sites/{id}/agent-manifest': {
      get: {
        summary: 'Agent manifest generated for a site',
        operationId: 'getSiteAgentManifest',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'Manifest' }, '404': { description: 'Not found' }, ...standardErrors },
      },
    },
    '/v1/gateway/agents/{id}/behavioral': {
      get: {
        summary: 'Behavioral score breakdown of an agent',
        operationId: 'getAgentBehavioralScore',
        parameters: [pathParam('id')],
        responses: { '200': { description: 'Behavioral score profile' }, '404': { description: 'Agent not found, or not in your organization' }, ...standardErrors },
      },
    },
    '/v1/gateway/manifest/{domain}': {
      get: {
        summary: 'Agent manifest of a registered domain',
        operationId: 'getDomainAgentManifest',
        parameters: [pathParam('domain', { type: 'string' })],
        responses: { '200': { description: 'Manifest' }, '404': { description: 'Domain not registered' }, ...standardErrors },
      },
    },
  },

  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'StealthMark API key (sk_live_...)',
      },
      ApiKeyHeader: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
      },
    },
  },
  security: [{ BearerAuth: [] }, { ApiKeyHeader: [] }],
}
