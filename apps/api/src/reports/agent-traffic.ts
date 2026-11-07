/**
 * Agent traffic report: which self-identified AI agents read which pages of each site in a
 * time window. Built from `usage_records` rows written by the SDK middleware (source
 * 'middleware'). The query lives here so the CLI in `apps/api/scripts/agent-report.ts` and the
 * tests share one definition.
 */

/** One aggregated row: one site, one host, one agent, one path. */
export interface AgentTrafficRow {
  site: string
  /** Request host the middleware saw; one API key can report several hosts. */
  host: string
  agent: string
  path: string
  hits: number
  lastSeen: Date
}

export interface AgentTrafficReportOptions {
  hours: number
  generatedAt: Date
  /** Every site that should appear in the report, including the ones with no agent traffic. */
  sites?: readonly string[]
  topPathsPerAgent?: number
}

/** Agent identifiers of our own smoke tests and tools, never real traffic. */
export const DEFAULT_EXCLUDED_AGENTS: readonly string[] = [
  'dogfood-smoke',
  'StealthMarkBenchmark/1.0',
  'StealthMarkScanner/1.0 (+https://stealthmark.io/docs)',
]

/**
 * Parameters: $1 window in hours, $2 excluded agent identifiers joined with commas (a plain text
 * parameter, so every driver binds it the same way), $3 org id or null.
 * Rows are grouped by site (registered site name, else API key name), request host, agent and path.
 */
export const AGENT_TRAFFIC_SQL = `
SELECT
  COALESCE(rs.display_name, ak.name, 'Sin sitio') AS site,
  COALESCE(ur.metadata->>'host', '(sin host)') AS host,
  COALESCE(ur.agent_identifier, 'desconocido') AS agent,
  COALESCE(ur.metadata->>'path', '(sin ruta)') AS path,
  COUNT(*)::int AS hits,
  MAX(ur.created_at) AS last_seen
FROM usage_records ur
LEFT JOIN registered_sites rs ON rs.id = ur.site_id
LEFT JOIN api_keys ak ON ak.id = ur.api_key_id
WHERE ur.source = 'middleware'
  AND ur.created_at >= now() - make_interval(hours => $1::int)
  AND (ur.agent_identifier IS NULL OR NOT (ur.agent_identifier = ANY(string_to_array($2::text, ','))))
  AND ($3::uuid IS NULL OR ur.org_id = $3::uuid)
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 5 DESC
`

const AGENT_COMPANIES: Readonly<Record<string, string>> = {
  'GPTBot': 'OpenAI',
  'ChatGPT-User': 'OpenAI',
  'OAI-SearchBot': 'OpenAI',
  'ClaudeBot': 'Anthropic',
  'Claude-User': 'Anthropic',
  'Claude-SearchBot': 'Anthropic',
  'Claude-Agent': 'Anthropic',
  'PerplexityBot': 'Perplexity',
  'Perplexity-User': 'Perplexity',
  'Google-CloudVertexBot': 'Google',
  'Meta-ExternalAgent': 'Meta',
  'Amazonbot': 'Amazon',
  'Bytespider': 'ByteDance',
  'CCBot': 'Common Crawl',
  'cohere-ai': 'Cohere',
  'DuckAssistBot': 'DuckDuckGo',
  'YouBot': 'You.com',
}

export function agentCompany(agent: string): string {
  return Object.hasOwn(AGENT_COMPANIES, agent) ? AGENT_COMPANIES[agent] : '—'
}

interface AgentSummary {
  agent: string
  hits: number
  pages: number
  lastSeen: Date
  paths: { path: string; hits: number }[]
}

function summarizeSite(rows: readonly AgentTrafficRow[]): AgentSummary[] {
  const byAgent = new Map<string, AgentSummary>()
  for (const row of rows) {
    const summary = byAgent.get(row.agent) ?? { agent: row.agent, hits: 0, pages: 0, lastSeen: row.lastSeen, paths: [] }
    summary.hits += row.hits
    summary.pages += 1
    if (row.lastSeen > summary.lastSeen) summary.lastSeen = row.lastSeen
    summary.paths.push({ path: row.path, hits: row.hits })
    byAgent.set(row.agent, summary)
  }
  return [...byAgent.values()].sort((a, b) => b.hits - a.hits || a.agent.localeCompare(b.agent))
}

function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** Reported text (agent, site, host) in one Markdown line: line breaks (U+2028 and U+2029 included, which end a heading or table row in marked) become spaces, markup characters and the table pipe are escaped, and `<`, `~` and the backtick become entities, since a GFM autolink would swallow a backslash, some renderers close a strikethrough at an escaped `~`, and marked pairs an escaped backtick with a code span's. */
function markdownText(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/[\\*_[\]|]/g, '\\$&').replace(/</g, '&lt;').replace(/~/g, '&#126;').replace(/`/g, '&#96;')
}

/** A heading also ends at a closing run of #, so text that ends in one keeps it escaped. */
function markdownHeading(value: string): string {
  return markdownText(value).replace(/(^|\s)(#+)(?=\s*$)/, '$1\\$2')
}

/** A path as a code span: a backtick, backslash, angle bracket, parenthesis or tilde is percent-encoded, so no path can close its span early, hide its closing backtick behind an escape, let a link or HTML reach past it, or close a strikethrough opened before it (marked's strikethrough runs across code spans), and a space pads a path that an edge space would change. */
function codeSpan(value: string): string {
  const text = value.replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/[`\\<>()~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  const pad = text === '' || /^ | $/.test(text) ? ' ' : ''
  return `\`${pad}${text}${pad}\``
}

/** Renders the report as Markdown, one section per site. */
export function renderAgentTrafficReport(rows: readonly AgentTrafficRow[], options: AgentTrafficReportOptions): string {
  const topPaths = options.topPathsPerAgent ?? 5
  const siteNames = [...new Set([...(options.sites ?? []), ...rows.map((row) => row.site)])].sort((a, b) => a.localeCompare(b))
  const lines: string[] = [
    `# Agentes de IA que leyeron tus páginas · últimas ${options.hours} horas`,
    '',
    `Generado: ${formatUtc(options.generatedAt)}. Solo cuenta agentes que se identifican a sí mismos (User-Agent o headers); no detecta bots que se hacen pasar por navegadores.`,
  ]

  if (siteNames.length === 0) {
    lines.push('', 'Sin visitas de agentes de IA identificados en este período.')
    return `${lines.join('\n')}\n`
  }

  for (const site of siteNames) {
    const siteRows = rows.filter((row) => row.site === site)
    const hosts = [...new Set(siteRows.map((row) => row.host))].sort((a, b) => a.localeCompare(b))
    if (hosts.length === 0) {
      lines.push('', `## ${markdownHeading(site)}`, '', 'Sin visitas de agentes de IA identificados en este período.')
      continue
    }
    for (const host of hosts) renderSection(lines, `${site} · ${host}`, siteRows.filter((row) => row.host === host), topPaths)
  }
  return `${lines.join('\n')}\n`
}

function renderSection(lines: string[], heading: string, rows: readonly AgentTrafficRow[], topPaths: number): void {
  const agents = summarizeSite(rows)
  const total = agents.reduce((sum, agent) => sum + agent.hits, 0)
  lines.push('', `## ${markdownHeading(heading)}`, '')
  lines.push(`${total} visita${total === 1 ? '' : 's'} de ${agents.length} agente${agents.length === 1 ? '' : 's'}.`, '')
  lines.push('| Agente | Empresa | Visitas | Páginas distintas | Última visita |', '| :-- | :-- | --: | --: | :-- |')
  for (const agent of agents) {
    lines.push(`| ${markdownText(agent.agent)} | ${agentCompany(agent.agent)} | ${agent.hits} | ${agent.pages} | ${formatUtc(agent.lastSeen)} |`)
  }
  for (const agent of agents) {
    const shown = [...agent.paths].sort((a, b) => b.hits - a.hits || a.path.localeCompare(b.path)).slice(0, topPaths)
    const rest = agent.paths.length - shown.length
    lines.push('', `**${markdownText(agent.agent)}** leyó: ${shown.map((p) => `${codeSpan(p.path)} (${p.hits})`).join(', ')}${rest > 0 ? ` y ${rest} página${rest === 1 ? '' : 's'} más` : ''}.`)
  }
}
