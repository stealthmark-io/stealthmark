import Link from 'next/link';
import { Bot, FileJson } from 'lucide-react';
import { CopyButton } from '@/components/agents/CopyButton';
import { AGENT_ENDPOINTS, MCP_SERVER } from '@/lib/agent-catalog';

const FREE_COUNT = AGENT_ENDPOINTS.filter((entry) => entry.access === 'free').length;
const TOOL_COUNT = MCP_SERVER.publicTools.length + MCP_SERVER.keyTools.length;

export function AgentHubStrip() {
  return (
    <section id="agents" aria-labelledby="agents-strip-heading" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-cyan-500/20 bg-[#0d1017]/85 backdrop-blur-md p-5 sm:p-8 grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-center min-w-0">
        <div className="space-y-3 min-w-0">
          <div className="flex items-center gap-2 text-xs font-mono font-semibold tracking-widest text-cyan-400 uppercase">
            <Bot className="h-4 w-4" aria-hidden="true" />
            For AI agents
          </div>
          <h2 id="agents-strip-heading" className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Agents can call the same checks you run here
          </h2>
          <p className="text-sm text-slate-400">
            One MCP server with {TOOL_COUNT} tools and {AGENT_ENDPOINTS.length} REST endpoints, {FREE_COUNT} of them free:
            website audit, prompt-injection scan, pre-pay trust receipts and fix generators.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link
              href="/agents"
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-500/15 border border-cyan-400/30 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/25 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#060709]"
            >
              Open the agent hub
            </Link>
            <a
              href="/agents.json"
              type="application/json"
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:text-white hover:border-white/25 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#060709]"
            >
              <FileJson className="h-4 w-4" aria-hidden="true" />
              agents.json
            </a>
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-black/40 p-4 space-y-2 min-w-0">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">MCP endpoint · {MCP_SERVER.transport}</div>
          <div className="flex items-center justify-between gap-2 min-w-0">
            <code className="font-mono text-sm text-cyan-300 min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{MCP_SERVER.url}</code>
            <CopyButton value={MCP_SERVER.url} label="Copy the MCP endpoint" />
          </div>
          <p className="text-xs text-slate-500">The three public tools run without a key; the generators need one.</p>
        </div>
      </div>
    </section>
  );
}
