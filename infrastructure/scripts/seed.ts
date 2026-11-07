import { eq } from 'drizzle-orm'
import {
  createDb,
  organizations,
  capabilities,
  agents,
  apiKeys,
} from '@stealthmark/db'
import { hashApiKey } from '../../apps/api/src/lib/crypto.js'
import { generateEmbedding } from '../../apps/api/src/services/embeddings.js'

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://stealthmark:dev_password@localhost:5432/stealthmark'

export async function runSeed() {
  console.log('Connecting to database:', DATABASE_URL.replace(/:[^:@]*@/, ':****@'))
  const db = createDb(DATABASE_URL)

  console.log('Seeding StealthMark organization...')
  let [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, 'stealthmark'))
    .limit(1)

  if (!org) {
    ;[org] = await db
      .insert(organizations)
      .values({
        name: 'StealthMark',
        slug: 'stealthmark',
        domain: 'stealthmark.io',
        plan: 'enterprise',
        status: 'active',
      })
      .returning()
    console.log('Created StealthMark org:', org.id)
  } else {
    console.log('StealthMark org already exists:', org.id)
  }

  // ── Seed Core Capabilities ─────────────────────────
  const coreCapabilities = [
    {
      type: 'primitive' as const,
      name: 'Web Vision',
      slug: 'web-vision',
      category: 'web_intelligence',
      description:
        'High-fidelity visual web understanding with anti-bot bypass and DOM structure capture.',
      protocols: ['REST', 'MCP'],
      pricingUnit: 'request',
      pricingAmount: '0.005',
      version: '1.0.0',
    },
    {
      type: 'primitive' as const,
      name: 'Web Extract',
      slug: 'web-extract',
      category: 'web_intelligence',
      description: 'Dynamic URL to clean Markdown / JSON extraction.',
      protocols: ['REST', 'MCP'],
      pricingUnit: 'request',
      pricingAmount: '0.002',
      version: '1.0.0',
    },
    {
      type: 'primitive' as const,
      name: 'Screenshot',
      slug: 'screenshot',
      category: 'web_intelligence',
      description: 'Full-page or viewport browser screenshot rendering.',
      protocols: ['REST', 'MCP'],
      pricingUnit: 'request',
      pricingAmount: '0.003',
      version: '1.0.0',
    },
    {
      type: 'primitive' as const,
      name: 'Browser',
      slug: 'browser',
      category: 'execution',
      description: 'Managed stealth browser execution session.',
      protocols: ['REST', 'CDP'],
      pricingUnit: 'minute',
      pricingAmount: '0.020',
      version: '1.0.0',
    },
    {
      type: 'primitive' as const,
      name: 'Web Search',
      slug: 'web-search',
      category: 'search',
      description: 'Real-time web search and index retrieval.',
      protocols: ['REST'],
      pricingUnit: 'request',
      pricingAmount: '0.001',
      version: '1.0.0',
    },
  ]

  for (const cap of coreCapabilities) {
    const [existing] = await db
      .select({ id: capabilities.id })
      .from(capabilities)
      .where(eq(capabilities.slug, cap.slug))
      .limit(1)

    const embedding = await generateEmbedding(`${cap.name} ${cap.description} ${cap.category}`)

    if (!existing) {
      await db.insert(capabilities).values({
        orgId: org.id,
        ...cap,
        status: 'active',
        embedding,
      })
      console.log(`Registered capability: ${cap.name} (${cap.slug})`)
    } else {
      await db.update(capabilities).set({ embedding }).where(eq(capabilities.id, existing.id))
      console.log(`Updated capability embedding: ${cap.name}`)
    }
  }

  // ── Seed StealthMark Default Agent ────────────────
  const [existingAgent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.name, 'StealthMark Web Intelligence Agent'))
    .limit(1)

  if (!existingAgent) {
    await db.insert(agents).values({
      orgId: org.id,
      name: 'StealthMark Web Intelligence Agent',
      description:
        'Official autonomous web intelligence agent capable of extraction, navigation, and visual parsing.',
      protocols: ['MCP', 'A2A', 'REST'],
      agentCard: {
        version: '1.0.0',
        name: 'StealthMark Web Intelligence Agent',
        description: 'Agentic web intelligence and extraction provider.',
        capabilities: coreCapabilities.map((c) => c.slug),
        protocol_support: ['A2A/v0', 'MCP/2024-11-05'],
      },
      status: 'active',
    })
    console.log('Created default StealthMark agent')
  }

  // ── Seed Dev API Key ──────────────────────────────
  const devKeyRaw = 'sk_live_stealthmark_foundation_dev_key_12345'
  const devKeyHash = hashApiKey(devKeyRaw)

  const [existingKey] = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, devKeyHash))
    .limit(1)

  if (!existingKey) {
    await db.insert(apiKeys).values({
      orgId: org.id,
      keyHash: devKeyHash,
      keyPrefix: 'sk_live_stea...2345',
      name: 'Foundation Dev Key',
      scopes: ['*'],
      rateLimitRpm: 120,
      rateLimitRpd: 50000,
      status: 'active',
    })
    console.log('Created foundation dev API key')
  }

  console.log('Seed process completed successfully!')
}

if (process.argv[1]?.endsWith('seed.ts')) {
  runSeed().catch((err) => {
    console.error('Seed error:', err)
    process.exit(1)
  })
}
