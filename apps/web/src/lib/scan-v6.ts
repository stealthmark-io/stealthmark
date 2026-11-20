import { isCloudflareIpv4, readBoundedText, resolveDomainIp } from './security/network-guard';
import { probeTls, type CertSummary, type TlsProbeResult } from './security/tls-probe';
import { NOT_ASSESSED_CONTROLS } from './scan-controls';
import { V6_CONTROLS, V6_PROBE_PATHS, type V6Control, type V6Section } from './scan-v6-controls';

export { V6_CONTROLS, V6_PROBE_PATHS, type V6Control, type V6Section };

/** A path the scan fetched: its body when it answered 200 with non-HTML content, `absent` when it did not serve one. */
export type PathResult = { kind: 'body'; text: string } | { kind: 'absent' } | { kind: 'unreachable' };

export type PortsResult =
  | { kind: 'ports'; ip: string; ports: number[] }
  | { kind: 'not_listed'; ip: string }
  | { kind: 'cloudflare'; ip: string }
  | { kind: 'unknown' };

export interface V6Observations {
  /** Front-page response headers, or null when the page could not be read. */
  headers: Record<string, string> | null;
  paths: Readonly<Record<string, PathResult>>;
  /** Null when no handshake was attempted. */
  tls: TlsProbeResult | null;
  subdomainTls: { host: string; result: TlsProbeResult } | null;
  ports: PortsResult;
}

type Status = 'pass' | 'warn' | 'fail' | 'info' | 'not_assessed';

export interface V6Row extends V6Control {
  status: Status;
  detail: string;
}

interface Verdict {
  status: Status;
  detail: string;
}

const NOT_PROBED: Verdict = {
  status: 'not_assessed',
  detail: 'The probed paths could not all be read over HTTPS from a public address, so this check was not assessed.',
};
const NO_HEADERS: Verdict = {
  status: 'not_assessed',
  detail: 'The front page could not be read over HTTPS from a public address, so this check was not assessed.',
};
const NO_TLS: Verdict = {
  status: 'not_assessed',
  detail: 'No TLS handshake with the site completed from a public address, so this check was not assessed.',
};
const DAY_MS = 86_400_000;
const EXPIRY_WARN_DAYS = 14;

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface PathFinding {
  severity: 'warn' | 'fail';
  note: string;
}

/**
 * Warn or fail when a detector matches a fetched path, pass only when every path was fetched and none matched, and
 * not_assessed otherwise.
 */
function exposureVerdict(
  obs: V6Observations,
  paths: readonly string[],
  detect: (path: string, text: string) => PathFinding | null,
  passDetail: string
): Verdict {
  const findings: PathFinding[] = [];
  let unreachable = false;
  for (const p of paths) {
    const result = obs.paths[p] ?? { kind: 'unreachable' };
    if (result.kind === 'unreachable') unreachable = true;
    if (result.kind !== 'body') continue;
    const finding = detect(p, result.text);
    if (finding) findings.push(finding);
  }
  if (findings.length > 0) {
    const status = findings.some((f) => f.severity === 'fail') ? 'fail' : 'warn';
    return { status, detail: findings.map((f) => f.note).join(' ') };
  }
  return unreachable ? NOT_PROBED : { status: 'pass', detail: passDetail };
}

function markerFinding(pattern: RegExp, note: string): (path: string, text: string) => PathFinding | null {
  return (_path, text) => (pattern.test(text) ? { severity: 'warn', note } : null);
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function evaluateOauthAudience(obs: V6Observations, host: string): Verdict {
  const result = obs.paths['/.well-known/oauth-protected-resource'] ?? { kind: 'unreachable' };
  if (result.kind === 'unreachable') return NOT_PROBED;
  const meta = result.kind === 'body' ? parseJsonObject(result.text) : null;
  if (!meta || typeof meta.resource !== 'string') {
    return { status: 'info', detail: 'No OAuth protected resource metadata (RFC 9728) is published, so there is no agent audience to check.' };
  }
  let sameOrigin = false;
  try {
    sameOrigin = new URL(meta.resource).origin === `https://${host}`;
  } catch {
    sameOrigin = false;
  }
  const servers = Array.isArray(meta.authorization_servers) ? meta.authorization_servers : [];
  if (sameOrigin && servers.length > 0 && servers.every(isHttpsUrl)) {
    return { status: 'pass', detail: 'OAuth protected resource metadata names this origin as the token audience and lists only HTTPS authorization servers.' };
  }
  return { status: 'warn', detail: 'OAuth protected resource metadata names a resource on another origin, or lists no HTTPS authorization server, so tokens are not pinned to this site.' };
}

function evaluateAgentCard(obs: V6Observations): Verdict {
  const result = obs.paths['/.well-known/agent-card.json'] ?? { kind: 'unreachable' };
  if (result.kind === 'unreachable') return NOT_PROBED;
  const card = result.kind === 'body' ? parseJsonObject(result.text) : null;
  if (!card || typeof card.name !== 'string') {
    return { status: 'info', detail: 'No A2A agent card is published at /.well-known/agent-card.json.' };
  }
  const schemes = card.securitySchemes;
  const declared =
    (schemes !== null && typeof schemes === 'object' && Object.keys(schemes).length > 0) ||
    (Array.isArray(card.security) && card.security.length > 0);
  return declared
    ? { status: 'pass', detail: 'The published A2A agent card declares the authentication agents must use.' }
    : { status: 'warn', detail: 'The published A2A agent card declares no securitySchemes, so calling agents are not told to authenticate.' };
}

function evaluateModelsListing(obs: V6Observations): Verdict {
  return exposureVerdict(
    obs,
    ['/v1/models'],
    (_path, text) => {
      const body = parseJsonObject(text);
      return body?.object === 'list' && Array.isArray(body.data)
        ? { severity: 'warn', note: '/v1/models lists models without authentication, so anyone can find and call this inference endpoint.' }
        : null;
    },
    'No unauthenticated OpenAI-compatible model listing is served at /v1/models.'
  );
}

const PHP_MIN_PATCH_BY_BRANCH: Readonly<Record<string, number>> = {
  '8.2': 36,
  '8.3': 37,
  '8.4': 28,
  '8.5': 13,
};

function evaluatePhpVersion(obs: V6Observations): Verdict {
  if (!obs.headers) return NO_HEADERS;
  const banner = `${obs.headers['x-powered-by'] ?? ''} ${obs.headers.server ?? ''}`;
  const matches = Array.from(banner.matchAll(/\bPHP\/(\d+)\.(\d+)(?:\.(\d+))?/gi));
  if (matches.length === 0) return { status: 'info', detail: 'The front page does not advertise a PHP version.' };

  let bestPass: Verdict | null = null;
  let infoFallback: Verdict | null = null;
  for (const match of matches) {
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = match[3] !== undefined ? Number(match[3]) : null;
    const branch = `${major}.${minor}`;
    const supported = major > 8 || (major === 8 && minor >= 2);
    if (!supported) {
      return {
        status: 'warn',
        detail: `The front page advertises PHP ${branch}, a branch that no longer receives security fixes.`,
      };
    }
    const minPatch = PHP_MIN_PATCH_BY_BRANCH[branch];
    if (minPatch !== undefined) {
      if (patch === null) {
        infoFallback ??= {
          status: 'info',
          detail: `The front page advertises PHP ${branch} without a patch version, so patch level (8.2.36 / 8.3.37 / 8.4.28 / 8.5.13) cannot be confirmed passively.`,
        };
        continue;
      }
      if (patch < minPatch) {
        return {
          status: 'warn',
          detail: `The front page advertises PHP ${branch}.${patch}, prior to the ${branch}.${minPatch} security release (CVE-2026-109618 / CVE-2026-109619 / CVE-2026-126714). Distro packages may backport fixes; no vulnerability was probed.`,
        };
      }
      bestPass ??= {
        status: 'pass',
        detail: `The front page advertises PHP ${branch}.${patch}, meeting the current security patch baseline (8.2.36 / 8.3.37 / 8.4.28 / 8.5.13).`,
      };
    } else {
      const label = patch !== null ? `${branch}.${patch}` : branch;
      bestPass ??= {
        status: 'pass',
        detail: `The front page advertises PHP ${label}, a branch that still receives security fixes.`,
      };
    }
  }
  return bestPass ?? infoFallback!;
}

function evaluateInternalHeaders(obs: V6Observations): Verdict {
  if (!obs.headers) return NO_HEADERS;
  const leaked = Object.keys(obs.headers).filter((name) => /^x-(middleware|invoke)-/.test(name));
  return leaked.length > 0
    ? { status: 'warn', detail: `The front page response carries internal routing headers (${leaked.join(', ')}).` }
    : { status: 'pass', detail: 'No internal middleware or invoke headers reach the client.' };
}

function isWeakKey(cert: CertSummary): boolean {
  if (cert.bits === null) return false;
  return (cert.keyType === 'rsa' && cert.bits < 2048) || (cert.keyType === 'ec' && cert.bits < 256);
}

function evaluateCaKeys(obs: V6Observations): Verdict {
  if (obs.tls?.kind !== 'ok') return NO_TLS;
  const { chain } = obs.tls.observation;
  if (chain.length === 0) {
    return { status: 'info', detail: 'The server sent only its own certificate, so no CA keys were available to check.' };
  }
  const weak = chain.filter(isWeakKey);
  return weak.length > 0
    ? { status: 'warn', detail: `The served chain includes CA certificates with weak keys: ${weak.map((c) => `${c.subject} (${c.keyType.toUpperCase()} ${c.bits})`).join(', ')}.` }
    : { status: 'pass', detail: `All ${chain.length} CA certificates in the served chain use RSA-2048+ or EC-256+ keys.` };
}

function evaluateLeafKey(obs: V6Observations): Verdict {
  if (obs.tls?.kind !== 'ok') return NO_TLS;
  const { leaf } = obs.tls.observation;
  if (leaf.keyType === 'other' || leaf.bits === null) {
    return { status: 'info', detail: 'The certificate uses a key type this scan does not grade.' };
  }
  const label = `${leaf.keyType.toUpperCase()} ${leaf.bits}-bit`;
  return isWeakKey(leaf)
    ? { status: 'warn', detail: `The certificate uses a weak ${label} key.` }
    : { status: 'pass', detail: `The certificate uses an ${label} key.` };
}

function evaluateCt(obs: V6Observations): Verdict {
  if (obs.tls?.kind !== 'ok') return NO_TLS;
  return obs.tls.observation.leaf.hasEmbeddedSct
    ? { status: 'pass', detail: 'The certificate embeds Signed Certificate Timestamps, so its issuance is logged in Certificate Transparency.' }
    : { status: 'info', detail: 'The certificate embeds no Signed Certificate Timestamps; they may be delivered in the TLS handshake, which this scan does not read.' };
}

function evaluateOcsp(obs: V6Observations): Verdict {
  if (obs.tls?.kind !== 'ok') return NO_TLS;
  const { leaf, ocspStapled } = obs.tls.observation;
  if (ocspStapled) return { status: 'pass', detail: 'The server staples an OCSP response to the handshake.' };
  return leaf.hasOcspUrl
    ? { status: 'info', detail: 'The certificate names an OCSP responder, but the server staples no OCSP response.' }
    : { status: 'info', detail: 'The certificate names no OCSP responder, so revocation relies on CRLs and there is nothing to staple.' };
}

function evaluateSubdomainExpiry(obs: V6Observations, now: number): Verdict {
  if (!obs.subdomainTls) return NO_TLS;
  const { host, result } = obs.subdomainTls;
  if (result.kind === 'no_host') return { status: 'info', detail: `${host} has no public IPv4 address, so its certificate was not checked.` };
  if (result.kind === 'error') return { ...NO_TLS, detail: `No TLS handshake with ${host} completed, so this check was not assessed.` };
  const validTo = result.observation.leaf.validTo;
  if (!Number.isFinite(validTo)) return { status: 'info', detail: `The certificate on ${host} has no readable expiry date.` };
  const days = Math.floor((validTo - now) / DAY_MS);
  const date = new Date(validTo).toISOString().slice(0, 10);
  if (days < 0) return { status: 'warn', detail: `The certificate on ${host} expired on ${date}.` };
  return days <= EXPIRY_WARN_DAYS
    ? { status: 'warn', detail: `The certificate on ${host} expires on ${date}, in ${days} days.` }
    : { status: 'pass', detail: `The certificate on ${host} is valid until ${date}.` };
}

function evaluateDependencyManifests(obs: V6Observations): Verdict {
  return exposureVerdict(
    obs,
    ['/yarn.lock', '/.yarnrc.yml'],
    (path, text) => {
      if (path === '/.yarnrc.yml' && /^\s*npmAuthToken\s*:/m.test(text)) {
        return { severity: 'fail', note: '/.yarnrc.yml is public and contains an npmAuthToken entry; revoke that registry token.' };
      }
      if (path === '/.yarnrc.yml' && /^\s*(npmRegistryServer|npmScopes|yarnPath|nodeLinker)\s*:/m.test(text)) {
        return { severity: 'warn', note: '/.yarnrc.yml is public and reveals registry configuration.' };
      }
      if (path === '/yarn.lock' && /^(# yarn lockfile v1|__metadata:)/m.test(text)) {
        return { severity: 'warn', note: '/yarn.lock is public and lists every dependency name an attacker could squat.' };
      }
      return null;
    },
    'No yarn lockfile or registry config is served from the site root.'
  );
}

const ORCHESTRATOR_PORTS: Readonly<Record<number, string>> = {
  2375: 'Docker API (no TLS)',
  2376: 'Docker API',
  2379: 'etcd',
  2380: 'etcd peer',
  6443: 'Kubernetes API',
  10250: 'kubelet',
  10255: 'kubelet read-only',
};
const AI_INFERENCE_PORTS: Readonly<Record<number, string>> = { 5555: 'LMCache ZMQ IPC', 5670: 'DB-GPT', 11434: 'Ollama API' };
const ANALYTICAL_STORE_PORTS: Readonly<Record<number, string>> = { 6379: 'Redis', 8123: 'ClickHouse HTTP', 9000: 'ClickHouse Native' };
const SIP_VOIP_PORTS: Readonly<Record<number, string>> = { 8021: 'FreeSWITCH Event Socket', 5060: 'SIP plaintext', 5061: 'SIP TLS' };
const SMB_NTLM_PORTS: Readonly<Record<number, string>> = { 445: 'SMB', 139: 'NetBIOS', 135: 'MSRPC' };

function evaluatePortIsolation(
  obs: V6Observations,
  targetPorts: Readonly<Record<number, string>>,
  evaluateOpen: (open: number[], ip: string, list: string) => Verdict,
  cleanDetail: (ip: string) => string,
  notListedLabel: string
): Verdict {
  const { ports } = obs;
  if (ports.kind === 'unknown') {
    return { status: 'not_assessed', detail: 'InternetDB could not be queried for this address, so this check was not assessed.' };
  }
  if (ports.kind === 'cloudflare') {
    return { status: 'not_assessed', detail: `${ports.ip} is a shared Cloudflare edge address, so the origin's control-plane ports were not assessed.` };
  }
  if (ports.kind === 'not_listed') {
    return { status: 'info', detail: `InternetDB has no record for ${ports.ip}, so no exposed ${notListedLabel} are known.` };
  }
  const open = ports.ports.filter((p) => targetPorts[p] !== undefined);
  if (open.length === 0) return { status: 'info', detail: cleanDetail(ports.ip) };
  const list = open.map((p) => `${p}/${targetPorts[p]}`).join(', ');
  return evaluateOpen(open, ports.ip, list);
}

function evaluateApacheHttp2Banner(obs: V6Observations): Verdict {
  if (!obs.headers) return NO_HEADERS;
  const server = obs.headers.server ?? '';
  const match = server.match(/\bApache\/(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return { status: 'info', detail: 'The front page does not advertise an Apache version.' };
  const [major, minor, patch] = [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
  const version = `${major}.${minor}.${patch}`;
  const isVulnerable = major < 2 || (major === 2 && minor < 4) || (major === 2 && minor === 4 && patch < 71);
  return isVulnerable
    ? {
        status: 'warn',
        detail: `The front page advertises Apache ${version}, prior to the CVE-2026-119618 mod_http2 heap corruption fix in 2.4.71; upgrade to 2.4.71+.`,
      }
    : {
        status: 'pass',
        detail: `The front page advertises Apache ${version}, which includes the fix for CVE-2026-119618.`,
      };
}

function evaluateNodejsBanner(obs: V6Observations): Verdict {
  if (!obs.headers) return NO_HEADERS;
  const banner = `${obs.headers['x-powered-by'] ?? ''} ${obs.headers.server ?? ''}`;
  const match = banner.match(/\bNode(?:\.js)?\/v?(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return { status: 'info', detail: 'The front page does not advertise a Node.js runtime version.' };
  const [major, minor, patch] = [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
  const version = `${major}.${minor}.${patch}`;
  const isVulnerable =
    major < 22 ||
    (major === 22 && (minor < 23 || (minor === 23 && patch < 5))) ||
    major === 23 ||
    (major === 24 && (minor < 22 || (minor === 22 && patch < 3))) ||
    major === 25 ||
    (major === 26 && (minor < 13 || (minor === 13 && patch < 1)));
  return isVulnerable
    ? {
        status: 'warn',
        detail: `The front page advertises Node.js ${version}, vulnerable to the November 2026 CVE wave and HTTP parser flaws (CVE-2026-111497); upgrade to 22.23.5+, 24.22.3+, or 26.13.1+.`,
      }
    : {
        status: 'pass',
        detail: `The front page advertises Node.js ${version}, patched against the November 2026 security wave.`,
      };
}

function evaluateApacheModPhp(obs: V6Observations): Verdict {
  if (!obs.headers) return NO_HEADERS;
  const server = obs.headers.server ?? '';
  const hasApache = /\bApache\b/i.test(server);
  const hasPhp = /\bPHP\//i.test(server) || /\bmod_php\b/i.test(server);
  if (hasApache && hasPhp) {
    return {
      status: 'warn',
      detail: 'The front page advertises Apache running an embedded mod_php SAPI (CVE-2026-109619); migrate to PHP-FPM with event MPM.',
    };
  }
  return {
    status: 'info',
    detail: 'The server does not advertise an embedded Apache mod_php SAPI configuration.',
  };
}

function evaluateBookitPlugin(obs: V6Observations): Verdict {
  return exposureVerdict(
    obs,
    ['/wp-content/plugins/bookit/readme.txt'],
    (_path, text) => {
      if (!/bookit/i.test(text)) return null;
      const match = text.match(/Stable tag:\s*(\d+(?:\.\d+)+)/i);
      if (!match) return null;
      const version = match[1];
      return compareSemver(version, '2.6.0.6') <= 0
        ? {
            severity: 'warn',
            note: `/wp-content/plugins/bookit/readme.txt reveals WordPress BookIt plugin version ${version}, vulnerable to unauthenticated SQL injection (CVE-2026-62048); upgrade to 2.6.0.7+.`,
          }
        : null;
    },
    'No vulnerable WordPress BookIt plugin readme is exposed at /wp-content/plugins/bookit/readme.txt.'
  );
}

function evaluateJenkinsExposure(obs: V6Observations): Verdict {
  if (!obs.headers) return NO_HEADERS;
  const jenkinsHeader = obs.headers['x-jenkins'];
  if (typeof jenkinsHeader === 'string' && jenkinsHeader.trim()) {
    const vMatch = jenkinsHeader.match(/(\d+(?:\.\d+)+)/);
    if (vMatch && compareSemver(vMatch[1], '2.588') < 0) {
      return {
        status: 'warn',
        detail: `The front page exposes Jenkins header version ${jenkinsHeader}, vulnerable to credential exposure (CVE-2026-117625); upgrade to 2.588+.`,
      };
    }
  }
  const apiRes = obs.paths['/api/json'] ?? { kind: 'unreachable' };
  if (apiRes.kind === 'body') {
    const json = parseJsonObject(apiRes.text);
    if (typeof json?._class === 'string' && json._class.startsWith('hudson.model.Hudson')) {
      return {
        status: 'warn',
        detail: '/api/json exposes an unauthenticated Jenkins instance (hudson.model.Hudson).',
      };
    }
  }
  if (apiRes.kind === 'unreachable') return NOT_PROBED;
  return {
    status: 'pass',
    detail: 'No vulnerable Jenkins instance headers or unauthenticated /api/json endpoint exposed.',
  };
}

function evaluateFlowiseExposure(obs: V6Observations): Verdict {
  return exposureVerdict(
    obs,
    ['/api/v1/chatflows'],
    (_path, text) => {
      let items: unknown[] | null = null;
      try {
        const parsed: unknown = JSON.parse(text);
        if (Array.isArray(parsed)) items = parsed;
        else if (parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).data)) {
          items = (parsed as Record<string, unknown>).data as unknown[];
        }
      } catch {
        return null;
      }
      return items?.some((item) => item !== null && typeof item === 'object' && 'flowData' in item && ('chatbotConfig' in item || 'isPublic' in item))
        ? { severity: 'warn', note: '/api/v1/chatflows exposes Flowise AI agent workflow definitions and chatbot configurations (CVE-2026-40933).' }
        : null;
    },
    'No unauthenticated Flowise chatflow definitions are exposed at /api/v1/chatflows.'
  );
}

function evaluatePraisonAiExposure(obs: V6Observations): Verdict {
  return exposureVerdict(
    obs,
    ['/agents'],
    (_path, text) => {
      let agents: unknown[] | null = null;
      try {
        const parsed: unknown = JSON.parse(text);
        if (Array.isArray(parsed)) agents = parsed;
        else if (parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).agents)) {
          agents = (parsed as Record<string, unknown>).agents as unknown[];
        }
      } catch {
        return null;
      }
      return agents?.some((a) => {
        if (!a || typeof a !== 'object') return false;
        const rec = a as Record<string, unknown>;
        return 'backstory' in rec || ('role' in rec && 'goal' in rec && 'tools' in rec);
      })
        ? { severity: 'warn', note: '/agents exposes unauthenticated PraisonAI multi-agent definitions and execution roles (CVE-2026-44338).' }
        : null;
    },
    'No unauthenticated PraisonAI agent definitions are exposed at /agents.'
  );
}

function evaluateVllmExposure(obs: V6Observations): Verdict {
  return exposureVerdict(
    obs,
    ['/v1/models'],
    (_path, text) => {
      const body = parseJsonObject(text);
      if (body?.object === 'list' && Array.isArray(body.data)) {
        const hasVllm = body.data.some((m) => m !== null && typeof m === 'object' && String((m as Record<string, unknown>).owned_by ?? '').toLowerCase() === 'vllm');
        if (hasVllm) {
          return { severity: 'warn', note: '/v1/models exposes an unauthenticated vLLM inference server instance (CVE-2026-115914, CVE-2026-44222).' };
        }
      }
      return null;
    },
    'No unauthenticated vLLM inference telemetry is advertised at /v1/models.'
  );
}

function evaluateEdgeApplianceExposure(obs: V6Observations): Verdict {
  if (!obs.headers) return NO_HEADERS;
  const headerKeys = Object.keys(obs.headers);
  const headerVals = Object.values(obs.headers).join(' ');
  const combined = `${headerKeys.join(' ')} ${headerVals}`;
  const appliances = [
    (/DSID=/i.test(headerVals) || /\b(?:ivanti|dana-na)\b/i.test(combined)) && 'Ivanti',
    (/webvpn=/i.test(headerVals) || /\+CSCOE\+/i.test(combined)) && 'Cisco ASA/FTD',
    /\b(?:globalprotect|pan-os)\b/i.test(combined) && 'Palo Alto GlobalProtect',
    (/SVPNCOOKIE=/i.test(headerVals) || /\bfortimail\b/i.test(combined)) && 'Fortinet',
    /\bbarracuda\b/i.test(combined) && 'Barracuda',
    (headerKeys.some((k) => /^x-screenconnect-/i.test(k)) || /ScreenConnect\//i.test(obs.headers.server ?? '')) && 'ConnectWise ScreenConnect',
  ].filter(Boolean);

  return appliances.length > 0
    ? {
        status: 'warn',
        detail: `The front page response reveals an exposed enterprise edge appliance or management interface (${appliances.join(', ')}).`,
      }
    : {
        status: 'pass',
        detail: 'No enterprise edge appliance or remote management headers are exposed on the front page.',
      };
}

function evaluateAtlassianJetbrainsExposure(obs: V6Observations): Verdict {
  if (!obs.headers) return NO_HEADERS;
  const jiraRes = obs.paths['/rest/api/2/serverInfo'] ?? { kind: 'unreachable' };
  const hubRes = obs.paths['/hub/api/rest/settings/public'] ?? { kind: 'unreachable' };

  const hasConfluenceHeaders =
    Boolean(obs.headers['x-arequestid']) &&
    Object.keys(obs.headers).some((k) => k.toLowerCase().startsWith('x-confluence-'));

  const j = jiraRes.kind === 'body' ? parseJsonObject(jiraRes.text) : null;
  const jiraExposed = Boolean(j && 'version' in j && 'buildNumber' in j && ('baseUrl' in j || 'deploymentType' in j));

  const h = hubRes.kind === 'body' ? parseJsonObject(hubRes.text) : null;
  const hubExposed = Boolean(h && ('ringId' in h || ('rootUrl' in h && 'version' in h)));

  if (hasConfluenceHeaders || jiraExposed || hubExposed) {
    return {
      status: 'warn',
      detail: 'Atlassian or JetBrains management surface is exposed without authentication (CVE-2026-21589, CVE-2026-123294).',
    };
  }
  if (jiraRes.kind === 'unreachable' || hubRes.kind === 'unreachable') return NOT_PROBED;
  return {
    status: 'pass',
    detail: 'No unauthenticated Atlassian or JetBrains administrative endpoints or headers are exposed.',
  };
}

function evaluateMcpSdkOauthGuard(obs: V6Observations): Verdict {
  const result = obs.paths['/.well-known/oauth-authorization-server'] ?? { kind: 'unreachable' };
  if (result.kind === 'unreachable') return NOT_PROBED;
  if (result.kind === 'absent') {
    return { status: 'info', detail: 'No OAuth authorization server metadata (RFC 8414) is published at /.well-known/oauth-authorization-server.' };
  }
  const meta = parseJsonObject(result.text);
  if (!meta || typeof meta.issuer !== 'string') {
    return { status: 'info', detail: 'No valid OAuth authorization server issuer metadata is published at /.well-known/oauth-authorization-server.' };
  }
  const valid = isHttpsUrl(meta.issuer) && isHttpsUrl(meta.jwks_uri) && isHttpsUrl(meta.token_endpoint);
  return valid
    ? { status: 'pass', detail: 'OAuth authorization server metadata publishes valid HTTPS issuer, jwks_uri, and token_endpoint (CVE-2026-104850).' }
    : { status: 'warn', detail: 'OAuth authorization server metadata contains insecure or missing HTTPS endpoints for issuer, jwks_uri, or token_endpoint (CVE-2026-104850).' };
}

function evaluateAiWorkspacePolicyExposure(obs: V6Observations, host: string): Verdict {
  const pattern = /(?:^|\n)#{1,3}\s+|\b(?:CLAUDE|AGENTS|cursorrules|MCP|system prompt|subagent|workspace policy)\b/i;
  const isStealthMarkHost = host === 'stealthmark.io' || host === 'www.stealthmark.io';
  return exposureVerdict(
    obs,
    ['/AGENTS.md', '/CLAUDE.md', '/.cursorrules'],
    (path, text) => {
      if (isStealthMarkHost && path === '/.cursorrules' && /^#\s*StealthMark\s+v\d+/i.test(text.trimStart())) return null;
      return pattern.test(text)
        ? {
            severity: 'warn',
            note: `${path} is public and reveals AI assistant instructions, rules, or system prompts.`,
          }
        : null;
    },
    'No AI assistant workspace policy or instruction files are served from the site root.'
  );
}

type Evaluator = (obs: V6Observations, host: string, now: number) => Verdict;

const EVALUATORS: Readonly<Record<string, Evaluator>> = {
  mcp_oauth_audience_pinning: (obs, host) => evaluateOauthAudience(obs, host),
  litellm_gateway_rce_shield: (obs) =>
    exposureVerdict(
      obs,
      ['/health/readiness'],
      markerFinding(/"litellm_version"\s*:/, '/health/readiness reveals a LiteLLM proxy and its version on the public internet.'),
      'No LiteLLM proxy health endpoint is served on the public host.'
    ),
  orchestrator_workflow_virtual_patch: (obs) =>
    exposureVerdict(
      obs,
      ['/rest/settings'],
      markerFinding(/"versionCli"\s*:/, '/rest/settings reveals an n8n workflow editor and its version on the public internet.'),
      'No n8n workflow editor settings endpoint is served on the public host.'
    ),
  anti_llmjacking_wallet_drain_shield: (obs) => evaluateModelsListing(obs),
  agent_to_agent_handshake_auth: (obs) => evaluateAgentCard(obs),
  headless_agent_shell_lockdown: (obs) =>
    exposureVerdict(
      obs,
      ['/api/v1/version'],
      markerFinding(/"package"\s*:\s*"langflow/i, '/api/v1/version reveals a Langflow agent runner on the public internet.'),
      'No Langflow agent runner version endpoint is served on the public host.'
    ),
  php2shell_oom_memory_guard: (obs) => evaluatePhpVersion(obs),
  isr_ssg_cache_header_sanitizer: (obs) => evaluateInternalHeaders(obs),
  emudhra_weak_ecc_quarantine: (obs) => evaluateCaKeys(obs),
  public_key_entropy_scalar_audit: (obs) => evaluateLeafKey(obs),
  ct_logs_realtime_issuance_watch: (obs) => evaluateCt(obs),
  ocsp_stapling_binding_validator: (obs) => evaluateOcsp(obs),
  subdomain_cert_expiry_watcher: (obs, _host, now) => evaluateSubdomainExpiry(obs, now),
  cicd_regex_overflow_rce_shield: (obs) =>
    exposureVerdict(
      obs,
      ['/.gitlab-ci.yml', '/Jenkinsfile', '/.circleci/config.yml'],
      (path, text) => {
        const pattern =
          path === '/Jenkinsfile' ? /\b(pipeline|node)\s*\{/ : path === '/.gitlab-ci.yml' ? /^\s*(stages|script|image|include|variables)\s*:/m : /^(jobs|workflows)\s*:/m;
        return pattern.test(text) ? { severity: 'warn', note: `${path} is public and reveals the CI/CD pipeline definition.` } : null;
      },
      'No GitLab CI, Jenkins or CircleCI pipeline definition is served from the site root.'
    ),
  platform_deploy_secret_leak_detector: (obs) =>
    exposureVerdict(
      obs,
      ['/.vercel/project.json', '/.netlify/state.json'],
      (path, text) => {
        const body = parseJsonObject(text);
        const linked = path === '/.vercel/project.json' ? Boolean(body?.projectId || body?.orgId) : Boolean(body?.siteId);
        return linked ? { severity: 'warn', note: `${path} is public and reveals the deployment project identifiers.` } : null;
      },
      'No Vercel or Netlify project link file is served from the site root.'
    ),
  dependency_confusion_manifest_guard: (obs) => evaluateDependencyManifests(obs),
  container_orchestrator_port_isolation: (obs) =>
    evaluatePortIsolation(
      obs,
      ORCHESTRATOR_PORTS,
      (open, ip, list) => ({ status: open.includes(2375) ? 'fail' : 'warn', detail: `InternetDB lists container control-plane ports open on ${ip}: ${list}.` }),
      (ip) => `InternetDB lists no Docker, etcd, Kubernetes API or kubelet ports open on ${ip}. When that address is a shared CDN edge, the origin's ports were not seen.`,
      'control-plane ports'
    ),
  apache_http2_rce_banner_shield: (obs) => evaluateApacheHttp2Banner(obs),
  nodejs_november_cve_banner_shield: (obs) => evaluateNodejsBanner(obs),
  apache_mod_php_sapi_isolation: (obs) => evaluateApacheModPhp(obs),
  wordpress_bookit_sqli_shield: (obs) => evaluateBookitPlugin(obs),
  jenkins_proxy_cred_exposure: (obs) => evaluateJenkinsExposure(obs),
  flowise_agent_flow_exposure: (obs) => evaluateFlowiseExposure(obs),
  praisonai_unauth_agent_surface: (obs) => evaluatePraisonAiExposure(obs),
  vllm_inference_telemetry_exposure: (obs) => evaluateVllmExposure(obs),
  ai_inference_ipc_port_isolation: (obs) =>
    evaluatePortIsolation(
      obs,
      AI_INFERENCE_PORTS,
      (open, ip, list) => ({
        status: open.includes(5555) ? 'fail' : 'warn',
        detail: open.includes(5555)
          ? `InternetDB lists critical AI inference IPC port open on ${ip}: ${list} (CVE-2026-105192).`
          : `InternetDB lists exposed AI inference framework ports on ${ip}: ${list} (CVE-2026-77932).`,
      }),
      (ip) => `InternetDB lists no LMCache, DB-GPT, or Ollama inference ports open on ${ip}.`,
      'AI inference ports'
    ),
  analytical_store_port_isolation: (obs) =>
    evaluatePortIsolation(
      obs,
      ANALYTICAL_STORE_PORTS,
      (_open, ip, list) => ({ status: 'fail', detail: `InternetDB lists analytical/in-memory store ports exposed on ${ip}: ${list} (CVE-2026-116366, CVE-2026-81934).` }),
      (ip) => `InternetDB lists no Redis or ClickHouse analytical ports open on ${ip}.`,
      'analytical store ports'
    ),
  sip_voip_control_port_isolation: (obs) =>
    evaluatePortIsolation(
      obs,
      SIP_VOIP_PORTS,
      (open, ip, list) => {
        if (open.includes(8021)) return { status: 'fail', detail: `InternetDB lists unauthenticated FreeSWITCH Event Socket open on ${ip}: ${list} (CVE-2026-116779).` };
        if (open.includes(5060)) return { status: 'warn', detail: `InternetDB lists plaintext SIP port open on ${ip}: ${list}; migrate to encrypted SIP TLS.` };
        return { status: 'info', detail: `InternetDB lists encrypted SIP TLS port on ${ip}: ${list}.` };
      },
      (ip) => `InternetDB lists no FreeSWITCH or SIP telephony control ports open on ${ip}.`,
      'SIP or VoIP control ports'
    ),
  outbound_smb_ntlm_egress_posture: (obs) =>
    evaluatePortIsolation(
      obs,
      SMB_NTLM_PORTS,
      (open, ip, list) =>
        open.includes(445)
          ? { status: 'fail', detail: `InternetDB lists SMB port 445 exposed on ${ip}, enabling NTLM reflection and relay attacks (CVE-2026-124194): ${list}.` }
          : { status: 'warn', detail: `InternetDB lists NetBIOS/MSRPC ports exposed on ${ip}: ${list}; isolate from public ingress/egress.` },
      (ip) => `InternetDB lists no SMB, NetBIOS, or MSRPC ports open on ${ip}.`,
      'SMB, NetBIOS, or MSRPC ports'
    ),
  edge_appliance_management_exposure: (obs) => evaluateEdgeApplianceExposure(obs),
  atlassian_jetbrains_mgmt_exposure: (obs) => evaluateAtlassianJetbrainsExposure(obs),
  mcp_sdk_transport_oauth_guard: (obs) => evaluateMcpSdkOauthGuard(obs),
  ai_assistant_workspace_policy_exposure: (obs, host) => evaluateAiWorkspacePolicyExposure(obs, host),
};

/** IDs the v6 block measures from outside. */
export const V6_MEASURED_IDS: readonly string[] = Object.keys(EVALUATORS);

export function buildV6Rows(obs: V6Observations, host: string, now = Date.now()): V6Row[] {
  return V6_CONTROLS.map((control) => {
    const reason = NOT_ASSESSED_CONTROLS[control.id];
    const evaluate = EVALUATORS[control.id];
    if (reason !== undefined) return { ...control, status: 'not_assessed', detail: reason };
    if (evaluate === undefined) throw new Error(`v6 control ${control.id} has neither a probe nor a not-assessed reason`);
    return { ...control, ...evaluate(obs, host, now) };
  });
}

const PATH_TIMEOUT_MS = 2500;
const PATH_MAX_BYTES = 65_536;
const INTERNETDB_TIMEOUT_MS = 1500;

/** A server error, a rate limit or a Cloudflare challenge hides whether the path exists. */
function wasBlocked(res: Response): boolean {
  return res.status >= 500 || res.status === 429 || (res.status === 403 && res.headers.has('cf-mitigated'));
}

async function fetchPath(host: string, path: string, userAgent: string): Promise<PathResult> {
  let res: Response;
  try {
    res = await fetch(`https://${host}${path}`, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(PATH_TIMEOUT_MS),
      headers: { 'User-Agent': userAgent, 'Accept-Encoding': 'identity' },
    });
  } catch {
    return { kind: 'unreachable' };
  }
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (res.status !== 200 || contentType.includes('text/html')) {
    await res.body?.cancel().catch(() => undefined);
    return wasBlocked(res) ? { kind: 'unreachable' } : { kind: 'absent' };
  }
  const { text, complete } = await readBoundedText(res, PATH_MAX_BYTES);
  return complete ? { kind: 'body', text } : { kind: 'unreachable' };
}

async function collectPorts(host: string): Promise<PortsResult> {
  let ip: string | null;
  try {
    ip = await resolveDomainIp(host);
  } catch {
    return { kind: 'unknown' };
  }
  if (!ip) return { kind: 'unknown' };
  if (isCloudflareIpv4(ip)) return { kind: 'cloudflare', ip };
  try {
    const res = await fetch(`https://internetdb.shodan.io/${ip}`, {
      headers: { 'User-Agent': 'StealthMarkAuditor/2.0', 'Accept-Encoding': 'identity' },
      signal: AbortSignal.timeout(INTERNETDB_TIMEOUT_MS),
    });
    if (res.status === 404) return { kind: 'not_listed', ip };
    if (!res.ok) return { kind: 'unknown' };
    const body = (await res.json()) as { ports?: unknown };
    const ports = Array.isArray(body.ports) ? body.ports.filter((p): p is number => typeof p === 'number') : [];
    return { kind: 'ports', ip, ports };
  } catch {
    return { kind: 'unknown' };
  }
}

/** The sibling name whose certificate the scan checks: www.<domain>, or the apex when the scan targets www. */
export function secondaryHost(domain: string): string {
  return domain.startsWith('www.') ? domain.slice(4) : `www.${domain}`;
}

export type V6NetworkObservations = Omit<V6Observations, 'headers'>;

/** Observations for a host the scan may not contact: everything stays not assessed. */
export const UNOBSERVED_V6: V6NetworkObservations = { paths: {}, tls: null, subdomainTls: null, ports: { kind: 'unknown' } };

/**
 * Passive collection for a host already confirmed to resolve only to public addresses: GETs of well-known paths, one
 * TLS handshake with the host and one with its www sibling, and an InternetDB lookup. Sends no payloads.
 */
export async function collectV6Observations(host: string, userAgent: string): Promise<V6NetworkObservations> {
  const sibling = secondaryHost(host);
  const [pathResults, tls, siblingTls, ports] = await Promise.all([
    Promise.all(V6_PROBE_PATHS.map((p) => fetchPath(host, p, userAgent))),
    probeTls(host),
    probeTls(sibling),
    collectPorts(host),
  ]);
  const paths: Record<string, PathResult> = {};
  V6_PROBE_PATHS.forEach((p, i) => {
    paths[p] = pathResults[i];
  });
  return { paths, tls, subdomainTls: { host: sibling, result: siblingTls }, ports };
}
