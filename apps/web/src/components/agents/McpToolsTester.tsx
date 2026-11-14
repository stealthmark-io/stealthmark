'use client';

import { useId, useState } from 'react';
import { CircleCheck, Loader2, Play, ShieldCheck, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

const MCP_PATH = '/api/mcp';
const MAX_SCAN_CHARS = 4000;

type CallState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string };

interface Threat {
  type: string;
  severity: string;
}

interface ScanResult {
  safe: boolean;
  threats: Threat[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toolNamesFrom(body: unknown): string[] | null {
  if (!isRecord(body) || !isRecord(body.result) || !Array.isArray(body.result.tools)) return null;
  return body.result.tools.flatMap((tool) => (isRecord(tool) && typeof tool.name === 'string' ? [tool.name] : []));
}

function scanResultFrom(body: unknown): ScanResult | null {
  if (!isRecord(body) || typeof body.safe !== 'boolean' || !Array.isArray(body.threats)) return null;
  const threats = body.threats.flatMap((threat) =>
    isRecord(threat) && typeof threat.type === 'string' && typeof threat.severity === 'string'
      ? [{ type: threat.type, severity: threat.severity }]
      : [],
  );
  return { safe: body.safe, threats };
}

function errorMessageFrom(body: unknown, status: number): string {
  if (isRecord(body)) {
    if (typeof body.detail === 'string') return body.detail;
    if (isRecord(body.error) && typeof body.error.message === 'string') return body.error.message;
    if (typeof body.error === 'string') return body.error;
  }
  return `The request failed with HTTP ${status}.`;
}

async function postJson(url: string, payload: unknown): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: unknown = await res.json().catch((error: unknown) => {
    console.warn('Response was not JSON', error);
    return null;
  });
  return { ok: res.ok, status: res.status, body };
}

function networkMessage(error: unknown): string {
  return error instanceof Error ? `Network error: ${error.message}` : 'Network error.';
}

const panel = 'rounded-2xl border border-white/[0.08] bg-[#0d1017]/80 p-5 sm:p-6 space-y-4';
const actionButton =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 text-sm font-semibold text-cyan-200 transition-colors motion-reduce:transition-none hover:bg-cyan-500/20 hover:text-white active:bg-cyan-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#060709] disabled:cursor-not-allowed disabled:opacity-50';

function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="break-words">{message}</span>
    </p>
  );
}

function ToolsListPanel() {
  const [request, setRequest] = useState<CallState<string[]>>({ status: 'idle' });
  const loading = request.status === 'loading';

  const run = async () => {
    setRequest({ status: 'loading' });
    try {
      const { ok, status, body } = await postJson(MCP_PATH, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
      const names = ok ? toolNamesFrom(body) : null;
      setRequest(names ? { status: 'success', data: names } : { status: 'error', message: errorMessageFrom(body, status) });
    } catch (error) {
      setRequest({ status: 'error', message: networkMessage(error) });
    }
  };

  return (
    <div className={panel}>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-white">List the MCP tools</h3>
        <p className="text-sm text-slate-400">
          Sends <code className="font-mono text-xs text-cyan-300">tools/list</code> to{' '}
          <code className="font-mono text-xs text-cyan-300 break-all">{MCP_PATH}</code> without a key, as an agent would.
        </p>
      </div>
      <button type="button" onClick={run} disabled={loading} aria-busy={loading} className={actionButton}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        {loading ? 'Calling…' : 'Call tools/list'}
      </button>
      <div aria-live="polite">
        {request.status === 'success' &&
          (request.data.length === 0 ? (
            <p role="status" className="text-sm text-slate-400">The server answered with no tools.</p>
          ) : (
            <div role="status" className="space-y-2">
              <p className="flex items-center gap-2 text-sm text-emerald-300">
                <CircleCheck className="h-4 w-4" aria-hidden />
                {request.data.length} tools returned without a key
              </p>
              <ul className="space-y-1.5">
                {request.data.map((name) => (
                  <li key={name} className="rounded-md bg-black/40 px-3 py-1.5 font-mono text-xs text-slate-200 break-all">
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
      {request.status === 'error' && <ErrorNote message={request.message} />}
    </div>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  high: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
};

function ShieldScanPanel({ scanUrl }: { scanUrl: string }) {
  const [text, setText] = useState('');
  const [request, setRequest] = useState<CallState<ScanResult>>({ status: 'idle' });
  const loading = request.status === 'loading';
  const fieldId = useId();
  const hintId = useId();

  const run = async () => {
    setRequest({ status: 'loading' });
    try {
      const { ok, status, body } = await postJson(scanUrl, { text, context: 'prompt' });
      const result = ok ? scanResultFrom(body) : null;
      setRequest(result ? { status: 'success', data: result } : { status: 'error', message: errorMessageFrom(body, status) });
    } catch (error) {
      setRequest({ status: 'error', message: networkMessage(error) });
    }
  };

  return (
    <div className={panel}>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-white">Try the prompt-injection scan</h3>
        <p id={hintId} className="text-sm text-slate-400">
          The text is sent to <code className="font-mono text-xs text-cyan-300 break-all">{scanUrl}</code> and checked for
          hidden Unicode, homoglyphs and injected instructions. Up to {MAX_SCAN_CHARS.toLocaleString('en-US')} characters.
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={fieldId} className="text-xs font-mono uppercase tracking-wider text-slate-400">
          Untrusted text
        </label>
        <textarea
          id={fieldId}
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, MAX_SCAN_CHARS))}
          maxLength={MAX_SCAN_CHARS}
          rows={5}
          disabled={loading}
          aria-describedby={hintId}
          placeholder="Paste text an agent is about to act on"
          className="block w-full resize-y rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-sm text-slate-100 placeholder:text-slate-500 focus-visible:border-cyan-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 disabled:opacity-60"
        />
        <p className="text-right font-mono text-xs text-slate-500">
          {text.length}/{MAX_SCAN_CHARS}
        </p>
      </div>
      <button type="button" onClick={run} disabled={loading || text.trim() === ''} aria-busy={loading} className={actionButton}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
        {loading ? 'Scanning…' : 'Scan text'}
      </button>
      <div aria-live="polite">
        {request.status === 'success' && (
          <div role="status" className="space-y-2">
            <p className={cn('flex items-center gap-2 text-sm font-semibold', request.data.safe ? 'text-emerald-300' : 'text-rose-300')}>
              {request.data.safe ? <CircleCheck className="h-4 w-4" aria-hidden /> : <TriangleAlert className="h-4 w-4" aria-hidden />}
              <span>
                safe: <span className="font-mono">{String(request.data.safe)}</span>
              </span>
            </p>
            {request.data.threats.length === 0 ? (
              <p className="text-sm text-slate-400">No threats found.</p>
            ) : (
              <ul className="space-y-1.5">
                {request.data.threats.map((threat, index) => (
                  <li
                    key={`${threat.type}-${index}`}
                    className={cn(
                      'flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-1.5 font-mono text-xs',
                      SEVERITY_STYLE[threat.severity] ?? 'border-white/10 bg-white/5 text-slate-200',
                    )}
                  >
                    <span className="break-all">{threat.type}</span>
                    <span className="uppercase tracking-wider">{threat.severity}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {request.status === 'error' && <ErrorNote message={request.message} />}
    </div>
  );
}

export function McpToolsTester({ scanUrl }: { scanUrl?: string }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <ToolsListPanel />
      {scanUrl && <ShieldScanPanel scanUrl={scanUrl} />}
    </div>
  );
}
