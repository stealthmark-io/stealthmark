import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Bot, Braces, ChevronDown, ExternalLink, FileJson, Package, Play, Plug, Server, ShieldCheck } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { CopyButton } from '@/components/agents/CopyButton';
import { McpToolsTester } from '@/components/agents/McpToolsTester';
import {
  AGENT_DOCUMENTS,
  AGENT_ENDPOINTS,
  MCP_SERVER,
  SDK_PACKAGES,
  X402_PROVER_ENDPOINTS,
  type CatalogAccess,
  type CatalogEndpoint,
} from '@/lib/agent-catalog';
import { SITE_ORIGIN } from '@/lib/site';

const PAGE_URL = `${SITE_ORIGIN}/agents`;
const CATALOG_URL = `${SITE_ORIGIN}/agents.json`;

export const metadata: Metadata = {
  title: 'StealthMark for AI agents: MCP server, security APIs and SDK',
  description:
    'Connect an agent to the StealthMark MCP server or call its REST endpoints directly: website audit, prompt-injection scan, pre-pay trust receipts and manifest generators, plus the SDK for site owners.',
  alternates: {
    canonical: PAGE_URL,
    types: { 'application/json': CATALOG_URL },
  },
};

const ACCESS_BADGE: Record<CatalogAccess, { label: string; variant: NonNullable<BadgeProps['variant']> }> = {
  free: { label: 'Free', variant: 'success' },
  'api-key': { label: 'API key', variant: 'warning' },
  x402: { label: 'x402', variant: 'purple' },
  paid: { label: 'Paid', variant: 'info' },
};

const TOOLS_LIST_CURL = [
  `curl -X POST ${shellQuote(MCP_SERVER.url)}`,
  `-H 'Content-Type: application/json'`,
  `-d ${shellQuote(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))}`,
].join(' \\\n  ');

const SHIELD_SCAN_URL = AGENT_ENDPOINTS.find((endpoint) => endpoint.id === 'shield_scan')?.url;

const ALL_ENDPOINTS = [...AGENT_ENDPOINTS, ...X402_PROVER_ENDPOINTS];

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'StealthMark APIs for AI agents',
  url: PAGE_URL,
  numberOfItems: ALL_ENDPOINTS.length,
  itemListElement: ALL_ENDPOINTS.map((endpoint, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    item: {
      '@type': 'WebAPI',
      name: endpoint.name,
      description: endpoint.summary,
      url: endpoint.url,
      documentation: `${PAGE_URL}#${endpoint.id}`,
      isAccessibleForFree: endpoint.access === 'free',
      provider: { '@type': 'Organization', name: 'StealthMark', url: SITE_ORIGIN },
    },
  })),
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** GET sends the input as a query string, POST as a JSON body; a `{name}` placeholder in the URL stays for the caller to fill. */
function curlFor(endpoint: CatalogEndpoint): string {
  const pathKeys = new Set([...endpoint.url.matchAll(/\{(\w+)\}/g)].map((match) => match[1]));
  const params = Object.entries(endpoint.input).filter(([key]) => !pathKeys.has(key));
  const auth = endpoint.access === 'api-key' ? [`-H 'Authorization: Bearer sk_live_...'`] : [];

  if (endpoint.method === 'GET') {
    const query = new URLSearchParams(params).toString();
    return ['curl', ...auth, shellQuote(query ? `${endpoint.url}?${query}` : endpoint.url)].join(' ');
  }
  return [
    `curl -X POST ${shellQuote(endpoint.url)}`,
    `-H 'Content-Type: application/json'`,
    ...auth,
    `-d ${shellQuote(JSON.stringify(Object.fromEntries(params)))}`,
  ].join(' \\\n  ');
}

function endpointsForTool(tool: string): CatalogEndpoint[] {
  return AGENT_ENDPOINTS.filter((endpoint) => endpoint.mcpTool === tool);
}

const linkStyle =
  'rounded text-cyan-300 underline-offset-4 hover:text-cyan-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70';

function SectionHeading({ id, icon, title, lead }: { id: string; icon: ReactNode; title: string; lead: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5 text-white">
        <span className="text-cyan-400">{icon}</span>
        <h2 id={id} className="text-xl font-bold tracking-tight sm:text-2xl">
          {title}
        </h2>
      </div>
      <p className="max-w-3xl text-sm leading-relaxed text-slate-400">{lead}</p>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-mono uppercase tracking-wider text-slate-400">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 font-mono text-xs sm:text-sm text-cyan-300">
          {value}
        </code>
        <CopyButton value={value} label={`Copy ${label}`} />
      </div>
    </div>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/50 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.02] px-3 py-1.5">
        <span className="font-mono text-[11px] leading-tight text-slate-400 min-w-0">{label}</span>
        <CopyButton value={code} label={label} />
      </div>
      <pre className="overflow-x-auto whitespace-pre p-3 font-mono text-xs leading-relaxed text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MethodBadge({ method }: { method: CatalogEndpoint['method'] }) {
  return (
    <span
      className={
        method === 'GET'
          ? 'rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[11px] font-bold text-cyan-300'
          : 'rounded-md border border-indigo-400/30 bg-indigo-500/10 px-2 py-0.5 font-mono text-[11px] font-bold text-indigo-300'
      }
    >
      {method}
    </span>
  );
}

function EndpointCard({ endpoint }: { endpoint: CatalogEndpoint }) {
  const access = ACCESS_BADGE[endpoint.access];
  return (
    <Card id={endpoint.id} variant="default" hoverEffect="none" glowColor="cyan" className="scroll-mt-24">
      <article className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <MethodBadge method={endpoint.method} />
          <Badge variant={access.variant}>{access.label}</Badge>
          {endpoint.mcpTool && <span className="font-mono text-[11px] text-slate-500 break-words">MCP: {endpoint.mcpTool}</span>}
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold text-white">{endpoint.name}</h3>
          <p className="text-sm leading-relaxed text-slate-400">{endpoint.summary}</p>
        </div>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-cyan-300">
            {endpoint.url}
          </code>
          <CopyButton value={endpoint.url} label={`Copy the ${endpoint.name} URL`} />
        </div>
        <p className="text-xs leading-relaxed text-slate-300">
          <span className="font-mono uppercase tracking-wider text-slate-500">Pricing </span>
          {endpoint.pricing}
        </p>
        <details className="group rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 text-sm font-medium text-slate-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 [&::-webkit-details-marker]:hidden">
            Example request
            <ChevronDown
              className="h-4 w-4 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden
            />
          </summary>
          <div className="px-3 pb-3">
            <CodeBlock code={curlFor(endpoint)} label={`Copy the curl example for ${endpoint.name}`} />
          </div>
        </details>
      </article>
    </Card>
  );
}

function ToolList({ title, lead, tools }: { title: string; lead: string; tools: readonly string[] }) {
  return (
    <Card variant="default" hoverEffect="none" glowColor="cyan" className="p-5">
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-cyan-300">{title}</h3>
          <p className="text-sm text-slate-400">{lead}</p>
        </div>
        <ul className="space-y-3">
          {tools.map((tool) => (
            <li key={tool} className="space-y-1">
              <code className="block font-mono text-sm text-slate-100 overflow-x-auto whitespace-nowrap">{tool}</code>
              <p className="text-xs text-slate-400">
                REST:{' '}
                {endpointsForTool(tool).map((endpoint, index) => (
                  <span key={endpoint.id}>
                    {index > 0 && ', '}
                    <a href={`#${endpoint.id}`} className={linkStyle}>
                      {endpoint.name}
                    </a>
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function ExternalAnchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 ${linkStyle}`}>
      {children}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

export default function AgentsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#060709] text-slate-100 selection:bg-cyan-500/30 selection:text-cyan-200 overflow-x-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, '\\u003c') }}
      />
      <Navbar />

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-16 px-4 pb-24 pt-24 sm:px-6 lg:px-8">
        <section aria-labelledby="agents-title" className="grid gap-8 lg:grid-cols-[1fr_minmax(0,28rem)] lg:items-start">
          <div className="space-y-5">
            <Badge variant="info" size="md">
              <Bot className="h-3.5 w-3.5" aria-hidden />
              For AI agents and the people who run them
            </Badge>
            <h1 id="agents-title" className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
              Security tools your agent can call.
            </h1>
            <p className="max-w-2xl text-base leading-relaxed text-slate-400">
              Agents connect to the MCP server or call the REST endpoints below; people can read what each one does,
              what it costs, and try the MCP server and the prompt-injection scan right here.
            </p>
            <nav aria-label="On this page" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              <a href="#mcp-tools" className={linkStyle}>MCP tools</a>
              <a href="#rest-endpoints" className={linkStyle}>REST endpoints</a>
              <a href="#z3-provers" className={linkStyle}>Z3 x402 provers</a>
              <a href="#live-test" className={linkStyle}>Live test</a>
              <a href="#documents" className={linkStyle}>Manifests</a>
              <a href="#sdk" className={linkStyle}>SDK</a>
            </nav>
          </div>

          <Card variant="glow" hoverEffect="none" glowColor="cyan" className="p-5 sm:p-6">
            <div className="space-y-5">
              <h2 className="flex items-center gap-2 text-sm font-mono font-bold uppercase tracking-wider text-cyan-300">
                <Plug className="h-4 w-4" aria-hidden />
                Agent quick start
              </h2>
              <CopyRow label="MCP endpoint" value={MCP_SERVER.url} />
              <CopyRow label="Catalog JSON" value={CATALOG_URL} />
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div className="space-y-0.5">
                  <dt className="font-mono uppercase tracking-wider text-slate-500">Transport</dt>
                  <dd className="font-mono text-slate-200">{MCP_SERVER.transport}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="font-mono uppercase tracking-wider text-slate-500">Protocol</dt>
                  <dd className="font-mono text-slate-200">{MCP_SERVER.protocolVersion}</dd>
                </div>
              </dl>
              <p className="text-xs leading-relaxed text-slate-300">{MCP_SERVER.access}</p>
              <CodeBlock code={TOOLS_LIST_CURL} label="Copy the tools/list curl command" />
            </div>
          </Card>
        </section>

        <section aria-labelledby="mcp-tools" className="space-y-6">
          <SectionHeading
            id="mcp-tools"
            icon={<Server className="h-5 w-5" aria-hidden />}
            title="MCP tools"
            lead="Each tool has a REST endpoint with the same job, linked under the tool."
          />
          <div className="grid gap-5 md:grid-cols-2">
            <ToolList title="Run without a key" lead="tools/list returns these to any client, and tools/call runs them." tools={MCP_SERVER.publicTools} />
            <ToolList title="Listed with an API key" lead="tools/list adds these when the request carries an sk_live_ key." tools={MCP_SERVER.keyTools} />
          </div>
        </section>

        <section aria-labelledby="rest-endpoints" className="space-y-6">
          <SectionHeading
            id="rest-endpoints"
            icon={<Braces className="h-5 w-5" aria-hidden />}
            title="REST endpoints"
            lead="Plain HTTPS with JSON. Free endpoints need no key; the others say what they charge and how."
          />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {AGENT_ENDPOINTS.map((endpoint) => (
              <EndpointCard key={endpoint.id} endpoint={endpoint} />
            ))}
          </div>
        </section>

        <section aria-labelledby="z3-provers" className="space-y-6">
          <SectionHeading
            id="z3-provers"
            icon={<ShieldCheck className="h-5 w-5 text-emerald-400" aria-hidden />}
            title="Z3 Formal Verification x402 Provers"
            lead="20 automated Z3 formal verification provers on https://gateway.stealthmark.io. Settle per-call micropayments in USDC on Base (eip155:8453) or Solana SPL with Deliver-Then-Settle execution."
          />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {X402_PROVER_ENDPOINTS.map((endpoint) => (
              <EndpointCard key={endpoint.id} endpoint={endpoint} />
            ))}
          </div>
        </section>

        <section aria-labelledby="live-test" className="space-y-6">
          <SectionHeading
            id="live-test"
            icon={<Play className="h-5 w-5" aria-hidden />}
            title="Try it live"
            lead="These buttons call the production endpoints from your browser and show the raw result."
          />
          <McpToolsTester scanUrl={SHIELD_SCAN_URL} />
        </section>

        <section aria-labelledby="documents" className="space-y-6">
          <SectionHeading
            id="documents"
            icon={<FileJson className="h-5 w-5" aria-hidden />}
            title="Machine-readable documents"
            lead="Manifests and indexes an agent can fetch to discover what this site offers."
          />
          <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-[#0d1017]/80">
            {AGENT_DOCUMENTS.map((doc) => (
              <li key={doc.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={doc.url} className={`text-sm font-semibold ${linkStyle}`}>
                      {doc.name}
                    </a>
                    <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-slate-400">
                      {doc.format}
                    </span>
                  </div>
                  <p className="text-sm text-slate-400">{doc.summary}</p>
                  <code className="block font-mono text-xs text-slate-500 overflow-x-auto whitespace-nowrap">{doc.url}</code>
                </div>
                <CopyButton value={doc.url} label={`Copy the ${doc.name} URL`} className="self-start sm:self-center" />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="sdk" className="space-y-6">
          <SectionHeading
            id="sdk"
            icon={<Package className="h-5 w-5" aria-hidden />}
            title="SDK for site owners"
            lead="Open-source middleware that detects, observes or blocks the agents visiting your site and serves them a manifest."
          />
          <div className="max-w-xl">
            <CodeBlock code="npm i @stealthmark/next" label="Copy the npm install command" />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {SDK_PACKAGES.map((pkg) => (
              <Card key={pkg.name} variant="default" hoverEffect="none" glowColor="cyan" className="p-5">
                <div className="space-y-2">
                  <h3 className="font-mono text-sm font-semibold text-white break-words">{pkg.name}</h3>
                  <p className="text-sm text-slate-400">{pkg.summary}</p>
                  <p className="text-sm">
                    <ExternalAnchor href={pkg.url}>View on npm</ExternalAnchor>
                  </p>
                </div>
              </Card>
            ))}
          </div>
          <p className="text-sm text-slate-400">
            Setup guides and configuration are in the{' '}
            <Link href="/docs" className={linkStyle}>
              documentation
            </Link>
            .
          </p>
        </section>
      </main>

      <Footer />
    </div>
  );
}
