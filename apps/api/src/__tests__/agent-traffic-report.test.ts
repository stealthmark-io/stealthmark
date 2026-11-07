import { describe, expect, it } from 'vitest'
import {
  AGENT_TRAFFIC_SQL,
  DEFAULT_EXCLUDED_AGENTS,
  agentCompany,
  renderAgentTrafficReport,
  type AgentTrafficRow,
} from '../reports/agent-traffic.js'

const generatedAt = new Date('2026-10-12T15:00:00Z')

const HOSTS: Record<string, string> = { DemoCV: 'www.democv.example.com', 'Example Shop': 'shop.example.com' }

function row(site: string, agent: string, path: string, hits: number, lastSeen = '2026-10-12T14:00:00Z', host = HOSTS[site] ?? 'example.com'): AgentTrafficRow {
  return { site, host, agent, path, hits, lastSeen: new Date(lastSeen) }
}

describe('agent traffic report', () => {
  it('groups each site by agent, ordered by visits, with the company and the most-read pages', () => {
    const report = renderAgentTrafficReport(
      [
        row('DemoCV', 'GPTBot', '/es', 7, '2026-10-11T10:00:00Z'),
        row('DemoCV', 'GPTBot', '/en', 2, '2026-10-12T09:30:00Z'),
        row('DemoCV', 'ClaudeBot', '/es/metodologia', 12),
        row('Example Shop', 'PerplexityBot', '/robots.txt', 1),
      ],
      { hours: 72, generatedAt },
    )

    expect(report).toContain('# Agentes de IA que leyeron tus páginas · últimas 72 horas')
    expect(report).toContain('## DemoCV · www.democv.example.com\n\n21 visitas de 2 agentes.')
    expect(report.indexOf('| ClaudeBot | Anthropic | 12 | 1 |')).toBeLessThan(report.indexOf('| GPTBot | OpenAI | 9 | 2 | 2026-10-12 09:30 UTC |'))
    expect(report).toContain('**GPTBot** leyó: `/es` (7), `/en` (2).')
    expect(report).toContain('## Example Shop · shop.example.com\n\n1 visita de 1 agente.')
    expect(report).toContain('| PerplexityBot | Perplexity | 1 | 1 |')
  })

  it('lists configured sites without agent traffic instead of dropping them', () => {
    const report = renderAgentTrafficReport([row('DemoCV', 'GPTBot', '/es', 1)], {
      hours: 72,
      generatedAt,
      sites: ['DemoCV', 'Example Shop'],
    })

    expect(report).toContain('## Example Shop\n\nSin visitas de agentes de IA identificados en este período.')
  })

  it('splits a site into one section per request host, so one key used on two hosts is visible', () => {
    const report = renderAgentTrafficReport(
      [
        row('Example Shop', 'GPTBot', '/', 1, '2026-10-09T23:01:00Z', 'example-shop.vercel.app'),
        row('Example Shop', 'ClaudeBot', '/turnos', 2),
      ],
      { hours: 72, generatedAt },
    )

    expect(report).toContain('## Example Shop · example-shop.vercel.app\n\n1 visita de 1 agente.')
    expect(report).toContain('## Example Shop · shop.example.com\n\n2 visitas de 1 agente.')
  })

  it('caps the pages listed per agent and says how many were left out', () => {
    const rows = ['/a', '/b', '/c', '/d'].map((path, i) => row('DemoCV', 'GPTBot', path, 10 - i))
    const report = renderAgentTrafficReport(rows, { hours: 72, generatedAt, topPathsPerAgent: 2 })

    expect(report).toContain('**GPTBot** leyó: `/a` (10), `/b` (9) y 2 páginas más.')
  })

  it('escapes reported agents, hosts, sites and paths, so they cannot add links, markup, table cells or lines', () => {
    const agent = 'Evil|Bot [x](https://evil.example)'
    const host = 'evil.example\n# injected #'
    const report = renderAgentTrafficReport(
      [row('DemoCV', agent, '/a`b` [y](https://evil.example)', 3, '2026-10-12T14:00:00Z', host), row('DemoCV', agent, '`', 1, '2026-10-12T14:00:00Z', host)],
      { hours: 72, generatedAt, sites: ['Sitio *raro* #'] },
    )

    expect(report).toContain('## DemoCV · evil.example # injected \\#\n')
    expect(report).toContain('| Evil\\|Bot \\[x\\](https://evil.example) | — | 4 | 2 |')
    expect(report).toContain('**Evil\\|Bot \\[x\\](https://evil.example)** leyó: `/a%60b%60 [y]%28https://evil.example%29` (3), `%60` (1).')
    expect(report).toContain('## Sitio \\*raro\\* \\#\n\nSin visitas')
    expect(report.split('\n').some((line) => line.startsWith('# injected'))).toBe(false)
  })

  it('escapes backslashes, code, emphasis, HTML and strikethrough in agents, and keeps odd paths inside their code spans', () => {
    const agent = 'Evil|Bot <img src=x> `c` ~~s~~ _e_ *b* \\'
    const report = renderAgentTrafficReport(
      [row('DemoCV', agent, '/a\n# h', 3), row('DemoCV', agent, ' a ', 2), row('DemoCV', agent, '', 1)],
      { hours: 72, generatedAt },
    )

    const escaped = 'Evil\\|Bot &lt;img src=x> &#96;c&#96; &#126;&#126;s&#126;&#126; \\_e\\_ \\*b\\* \\\\'
    expect(report).toContain(`| ${escaped} | — | 6 | 3 |`)
    expect(report).toContain(`**${escaped}** leyó: \`/a # h\` (3), \`  a  \` (2), \`  \` (1).`)
  })

  it('percent-encodes a backslash, angle brackets and parentheses in paths, and writes a backtick in an agent as an entity', () => {
    const report = renderAgentTrafficReport(
      [
        row('DemoCV', 'A', '/x**\\', 2),
        row('DemoCV', 'A', '/y**', 1),
        row('DemoCV', 'g`g', '/', 1),
        row('DemoCV', '[x](', '/a)', 3),
        row('DemoCV', '[x](', '/**', 2),
        row('DemoCV', '[x](', '/<script>alert(1)</script>', 1),
      ],
      { hours: 72, generatedAt },
    )

    expect(report).toContain('**A** leyó: `/x**%5C` (2), `/y**` (1).')
    expect(report).toContain('| g&#96;g | — | 1 | 1 |')
    expect(report).toContain('**g&#96;g** leyó: `/` (1).')
    expect(report).toContain('**\\[x\\](** leyó: `/a%29` (3), `/**` (2), `/%3Cscript%3Ealert%281%29%3C/script%3E` (1).')
    expect(report).not.toContain('<script>')
  })

  it('writes a tilde in an agent as an entity and percent-encodes it in paths, so a GFM autolink that swallows the backslash before it cannot open or close a strikethrough', () => {
    const report = renderAgentTrafficReport(
      [row('DemoCV', 'http://e~( a~b', '/a', 2), row('DemoCV', 'http://e~( a~b', '/b.~c', 1)],
      { hours: 72, generatedAt },
    )

    expect(report).toContain('| http://e&#126;( a&#126;b | — | 3 | 2 |')
    expect(report).toContain('**http://e&#126;( a&#126;b** leyó: `/a` (2), `/b.%7Ec` (1).')
    expect(report).not.toContain('~')
  })

  it('turns U+2028 and U+2029 into spaces, since marked ends a heading, row or line at them', () => {
    const report = renderAgentTrafficReport(
      [row('S\u2029# s', 'Bot\u2028| x |', '/p\u2028# q', 1, '2026-10-12T14:00:00Z', 'evil.example\u2028# h')],
      { hours: 72, generatedAt },
    )

    expect(report).toContain('## S # s · evil.example # h\n')
    expect(report).toContain('| Bot \\| x \\| | — | 1 | 1 |')
    expect(report).toContain('**Bot \\| x \\|** leyó: `/p # q` (1).')
    expect(report).not.toMatch(/[\u2028\u2029]/)
  })

  it('says so when there is no traffic and no configured site', () => {
    expect(renderAgentTrafficReport([], { hours: 24, generatedAt })).toContain('Sin visitas de agentes de IA identificados en este período.')
  })

  it('maps known agents to their company and leaves unknown ones unattributed', () => {
    expect(agentCompany('OAI-SearchBot')).toBe('OpenAI')
    expect(agentCompany('Claude-User')).toBe('Anthropic')
    expect(agentCompany('some-new-agent')).toBe('—')
  })

  it('ignores inherited object properties when it looks an agent up', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(agentCompany(name)).toBe('—')
    }
    const report = renderAgentTrafficReport([row('DemoCV', 'constructor', '/es', 1), row('DemoCV', '__proto__', '/en', 1)], { hours: 24, generatedAt })
    expect(report).toContain('| constructor | — | 1 | 1 |')
    expect(report).toContain('| \\_\\_proto\\_\\_ | — | 1 | 1 |')
  })

  it('reads only SDK middleware events in the window and excludes our smoke tests', () => {
    expect(DEFAULT_EXCLUDED_AGENTS).toContain('dogfood-smoke')
    expect(DEFAULT_EXCLUDED_AGENTS.every((agent) => !agent.includes(','))).toBe(true)
    expect(AGENT_TRAFFIC_SQL).toContain("ur.source = 'middleware'")
    expect(AGENT_TRAFFIC_SQL).toContain("ur.metadata->>'host'")
    expect(AGENT_TRAFFIC_SQL).toContain('make_interval(hours => $1::int)')
    expect(AGENT_TRAFFIC_SQL).toContain("ANY(string_to_array($2::text, ','))")
    expect(AGENT_TRAFFIC_SQL).toContain('$3::uuid IS NULL OR ur.org_id = $3::uuid')
  })
})
