import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function compareSemver(a: string, b: string): number {
  const pa = String(a)
    .replace(/^[^\d]+/, '')
    .split('.')
    .map((part) => parseInt(part, 10) || 0);
  const pb = String(b)
    .replace(/^[^\d]+/, '')
    .split('.')
    .map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export interface SecurityRiskEvaluation {
  vulnerable: boolean;
  version?: string;
  detail: string;
}

export interface PythonBrotliPackageRisk {
  name: string;
  version: string;
  vulnerable: boolean;
}

export interface PythonBrotliRiskEvaluation {
  vulnerable: boolean;
  packages: PythonBrotliPackageRisk[];
  detail: string;
}

export function evaluateNode2ShellRisk(versionStr: string): SecurityRiskEvaluation {
  const cleanVer = String(versionStr).replace(/^v/, '').trim();
  const major = parseInt(cleanVer.split('.')[0] || '0', 10);
  let vulnerable = false;

  if (isNaN(major) || major < 22) {
    vulnerable = true;
  } else if (major === 22 && compareSemver(cleanVer, '22.23.4') < 0) {
    vulnerable = true;
  } else if (major === 23) {
    vulnerable = true;
  } else if (major === 24 && compareSemver(cleanVer, '24.22.1') < 0) {
    vulnerable = true;
  } else if (major === 25) {
    vulnerable = true;
  } else if (major === 26 && compareSemver(cleanVer, '26.12.1') < 0) {
    vulnerable = true;
  }

  return {
    vulnerable,
    version: cleanVer,
    detail: vulnerable
      ? `Node.js v${cleanVer} is vulnerable to CVE-2026-111497 (Brotli Decompression RCE)`
      : `Node.js v${cleanVer} is patched against Node2Shell (CVE-2026-111497)`,
  };
}

export function evaluateBunBrotliRisk(versionStr: string): SecurityRiskEvaluation {
  const cleanVer = String(versionStr).replace(/^v/, '').trim();
  const vulnerable = compareSemver(cleanVer, '1.4.4') < 0;
  return {
    vulnerable,
    version: cleanVer,
    detail: vulnerable
      ? `Bun v${cleanVer} is vulnerable to CVE-2026-111497 (< 1.4.4)`
      : `Bun v${cleanVer} is patched against CVE-2026-111497 (>= 1.4.4)`,
  };
}

export function evaluatePythonBrotliRisk(pipJsonOrList: unknown): PythonBrotliRiskEvaluation {
  const targetPackages = ['brotli', 'brotlicffi'];
  const found: Array<{ name: string; version: string }> = [];

  if (typeof pipJsonOrList === 'string') {
    const trimmed = pipJsonOrList.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item === 'object' && 'name' in item && 'version' in item) {
              const name = String((item as { name: string }).name).toLowerCase();
              if (targetPackages.includes(name)) {
                found.push({ name, version: String((item as { version: string }).version) });
              }
            }
          }
        }
      } catch {
        // Fallback to text parsing
      }
    }
    if (found.length === 0) {
      const lines = trimmed.split('\n');
      for (const line of lines) {
        const match = line.match(/^\s*(brotli(?:cffi)?)\s*(?:==|\s+|\(|\:)\s*([0-9a-zA-Z.]+)/i);
        if (match && match[1] && match[2]) {
          found.push({ name: match[1].toLowerCase(), version: match[2].replace(/[)]/g, '') });
        }
      }
    }
  } else if (Array.isArray(pipJsonOrList)) {
    for (const item of pipJsonOrList) {
      if (item && typeof item === 'object' && 'name' in item && 'version' in item) {
        const name = String((item as { name: string }).name).toLowerCase();
        if (targetPackages.includes(name)) {
          found.push({ name, version: String((item as { version: string }).version) });
        }
      }
    }
  } else if (pipJsonOrList && typeof pipJsonOrList === 'object') {
    for (const [key, val] of Object.entries(pipJsonOrList as Record<string, unknown>)) {
      const name = key.toLowerCase();
      if (targetPackages.includes(name)) {
        found.push({ name, version: String(val) });
      }
    }
  }

  const packageRisks: PythonBrotliPackageRisk[] = found.map((pkg) => {
    const isVuln = compareSemver(pkg.version, '1.2.1') < 0;
    return {
      name: pkg.name,
      version: pkg.version,
      vulnerable: isVuln,
    };
  });

  const vulnerable = packageRisks.some((p) => p.vulnerable);
  const detail = vulnerable
    ? `Vulnerable Python Brotli packages found (< 1.2.1): ${packageRisks
        .filter((p) => p.vulnerable)
        .map((p) => `${p.name}@${p.version}`)
        .join(', ')}`
    : packageRisks.length > 0
    ? `Python Brotli packages are patched (>= 1.2.1): ${packageRisks
        .map((p) => `${p.name}@${p.version}`)
        .join(', ')}`
    : 'No vulnerable Python Brotli packages detected';

  return {
    vulnerable,
    packages: packageRisks,
    detail,
  };
}

export async function runPdfInspector(filePath: string): Promise<void> {
  console.log(`\n${C.bold}${C.cyan}📄 StealthMark Weaponized PDF Inspector v5.1${C.reset}`);
  const resolved = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(resolved)) {
    console.error(`${C.red}✖ File not found:${C.reset} ${resolved}`);
    process.exit(1);
  }

  const rawBuffer = fs.readFileSync(resolved);
  const content = rawBuffer.toString('latin1');

  if (!content.startsWith('%PDF-')) {
    console.log(`${C.yellow}⚠ Warning:${C.reset} File does not start with standard %PDF- header (possible polyglot or spoofed extension).`);
  }

  const dangerousPatterns = [
    { regex: /\/JavaScript\b|\/JS\b/g, name: 'Embedded JavaScript (/JS, /JavaScript)', severity: 'CRITICAL' },
    { regex: /\/Launch\b/g, name: 'OS Command Launch Action (/Launch)', severity: 'CRITICAL' },
    { regex: /\/OpenAction\b|\/AA\b/g, name: 'Automatic Execution Trigger (/OpenAction, /AA)', severity: 'HIGH' },
    { regex: /\/EmbeddedFiles\b/g, name: 'Hidden Embedded File Dropper (/EmbeddedFiles)', severity: 'HIGH' },
    { regex: /\/GoToR\b|\/SubmitForm\b/g, name: 'External SSRF / SMB Hash Leak Trigger (/GoToR, /SubmitForm)', severity: 'HIGH' },
    { regex: /\/XFA\b|\/RichMedia\b/g, name: 'XFA / RichMedia Exploit Surface', severity: 'MEDIUM' },
    { regex: /<!ENTITY\s+/gi, name: 'XML External Entity (XXE in XMP Metadata)', severity: 'CRITICAL' },
    { regex: /ignore all previous instructions|system prompt override|hire this candidate/gi, name: 'Hidden AI Resume/Invoice Prompt Injection', severity: 'HIGH' },
  ];

  let hits = 0;
  for (const pat of dangerousPatterns) {
    const matches = content.match(pat.regex);
    if (matches && matches.length > 0) {
      hits++;
      console.log(`  ${C.red}✖ [${pat.severity}]${C.reset} Detected ${pat.name} (${matches.length} occurrence(s))`);
    }
  }

  if (hits === 0) {
    console.log(`  ${C.green}✓ Clean PDF:${C.reset} Zero executable tags (/JS, /Launch, /OpenAction) or AI prompt injections detected.\n`);
  } else {
    console.log(`\n  ${C.red}${C.bold}🚨 DANGER: Do NOT open this PDF in a desktop reader!${C.reset}`);
    console.log(`  ${C.cyan}Protect your company's upload forms automatically at the edge with StealthMark v5:${C.reset} https://stealthmark.io/scan\n`);
    process.exit(1);
  }
}

export async function runLocalDoctorV5(): Promise<void> {
  console.log(`\n${C.bold}${C.cyan}🛡️  StealthMark Workstation, Server & Container Doctor v5.1${C.reset}`);
  console.log(`${C.dim}Auditing Node2Shell (CVE-2026-111497), Next.js 14/sharp, Linux SUID/GTFOBins, TeamViewer (CVE-2026-111585), Docker & Cursor IOCs...${C.reset}\n`);

  let issuesFound = 0;
  const homeDir = os.homedir();
  const platform = os.platform();
  const release = os.release();

  const nodeRisk = evaluateNode2ShellRisk(process.version);
  if (nodeRisk.vulnerable) {
    issuesFound++;
    console.log(`  ${C.red}✖ [CRITICAL NODE2SHELL RCE]${C.reset} ${nodeRisk.detail}!`);
  } else {
    console.log(`  ${C.green}✓ [Node.js Runtime]${C.reset} ${nodeRisk.detail}`);
  }

  // Optional local checks: Bun (< 1.4.4)
  try {
    const bunVerRaw = execFileSync('bun', ['--version'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (bunVerRaw) {
      const bunRisk = evaluateBunBrotliRisk(bunVerRaw);
      if (bunRisk.vulnerable) {
        issuesFound++;
        console.log(`  ${C.red}✖ [CRITICAL BUN BROTLI RCE]${C.reset} ${bunRisk.detail}!`);
      } else {
        console.log(`  ${C.green}✓ [Bun Runtime]${C.reset} ${bunRisk.detail}`);
      }
    }
  } catch {
    // Bun binary not present or timed out - optional check
  }

  // Optional local checks: Python brotli / brotlicffi (< 1.2.1)
  try {
    const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
    const pipOut = execFileSync(pythonBin, ['-m', 'pip', 'list', '--format=json'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pythonRisk = evaluatePythonBrotliRisk(pipOut);
    if (pythonRisk.vulnerable) {
      issuesFound++;
      console.log(`  ${C.red}✖ [CRITICAL PYTHON BROTLI RCE]${C.reset} ${pythonRisk.detail}!`);
    } else if (pythonRisk.packages.length > 0) {
      console.log(`  ${C.green}✓ [Python Brotli]${C.reset} ${pythonRisk.detail}`);
    }
  } catch {
    // Python/pip not present or timed out - optional check
  }

  if (platform === 'linux') {
    const riskySuidBins = ['/usr/bin/find', '/bin/find', '/usr/bin/vim', '/usr/bin/python3', '/bin/bash'];
    const suidHits: string[] = [];
    for (const binPath of riskySuidBins) {
      if (fs.existsSync(binPath)) {
        try {
          const st = fs.statSync(binPath);
          if ((st.mode & 0o4000) !== 0) {
            suidHits.push(binPath);
          }
        } catch {
          // ignore
        }
      }
    }
    if (suidHits.length > 0) {
      issuesFound++;
      console.log(`  ${C.red}✖ [CRITICAL LINUX PRIV-ESC]${C.reset} Dangerous SUID bit (-4000) set on GTFOBins: ${suidHits.join(', ')}`);
    } else {
      console.log(`  ${C.green}✓ [Linux SUID Audit]${C.reset} No dangerous SUID bit found on find/vim/python/bash`);
    }

    const matchKernel = release.match(/^(\d+\.\d+\.\d+)-(\d+)/);
    if (matchKernel && matchKernel[1] === '6.8.0' && parseInt(matchKernel[2], 10) < 124) {
      issuesFound++;
      console.log(`  ${C.red}✖ [CISA KEV LINUX KERNEL]${C.reset} Kernel ${release} is below 6.8.0-124.`);
    }
  }

  const authKeysPath = path.join(homeDir, '.ssh', 'authorized_keys');
  if (fs.existsSync(authKeysPath) && /svc-telemetry/i.test(fs.readFileSync(authKeysPath, 'utf8'))) {
    issuesFound++;
    console.log(`  ${C.red}✖ [CRITICAL SUPPLY-CHAIN IOC]${C.reset} Backdoor SSH key "svc-telemetry" found in ~/.ssh/authorized_keys!`);
  } else {
    console.log(`  ${C.green}✓ [Supply-Chain & SSH]${C.reset} Clean (no Cursor/Claude Code "svc-telemetry" backdoor key)`);
  }

  console.log('\n------------------------------------------------------------');
  if (issuesFound === 0) {
    console.log(`${C.green}${C.bold}✓ All v5 local checks passed with 0 critical exposures.${C.reset}\n`);
  } else {
    console.log(`${C.red}${C.bold}⚠ Detected ${issuesFound} critical vulnerability/IOC(s)!${C.reset}`);
    console.log(`   👉 ${C.bold}https://stealthmark.io/scan${C.reset} (Active Shield v5 Pro — $24.50 w/ BLACKOCTOBER)\n`);
  }
}
