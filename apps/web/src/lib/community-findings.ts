export type AdvisoryBadgeColor = 'emerald' | 'cyan' | 'amber' | 'rose' | 'indigo';

export interface PublicAdvisory {
  id: string;
  tag: string;
  target: string;
  title: string;
  referenceLabel: string;
  referenceUrl: string;
  referenceUrlLabel: string;
  impact: string;
  ruleCoverage: string;
  status: string;
  badgeColor: AdvisoryBadgeColor;
}

export type DisclosurePlatform = 'Maya Protocol' | 'HackerOne' | 'Bugcrowd';

export type DisclosureStage =
  | 'Partial Settlement'
  | 'Reported · Under Triage'
  | 'Queued · Pending Triage'
  | 'Open · Under Assessment'
  | 'Triaged · Awaiting Patch'
  | 'Triaged · Fix Verification'
  | 'Closed · Prior Duplicate';

export interface CoordinatedDisclosure {
  id: string;
  platform: DisclosurePlatform;
  sector: string;
  title: string;
  severity: string;
  cweClass: string;
  stage: DisclosureStage;
  embargoNote: string;
  defensiveCapability: string;
  proverPath: string;
  proverLabel: string;
}

export interface PreDisclosureQueueBucket {
  channel: string;
  draftCount: number;
  focusAreas: string;
  gateStatus: string;
}

/**
 * Verified public community advisories, upstream patches, and third-party attestations.
 * Single source of truth shared between the home landing strip and /advisories.
 */
export const PUBLIC_ADVISORIES: readonly PublicAdvisory[] = [
  {
    id: 'SM-ADV-2026-01',
    tag: 'AI Agent Supply-Chain Defense',
    target: 'PrimeIntellect-ai/prime-agent',
    title: 'TOCTOU Command Bypass & Unsafe Symlink / Archive Extraction in Agent Runtimes',
    referenceLabel: 'Upstream PR #3886 · Discussion #3887',
    referenceUrl: 'https://github.com/PrimeIntellect-ai/prime-agent/pull/3886',
    referenceUrlLabel: 'View Upstream PR #3886',
    impact:
      'Hardened agent execution boundaries against time-of-check/time-of-use command tampering and symlink traversal during sandbox extraction.',
    ruleCoverage:
      'Mapped to StealthMark Rule Group: MCP & Agent Runtime Supply-Chain Hardening',
    status: 'Coordinated Fix & Advisory Published',
    badgeColor: 'emerald',
  },
  {
    id: 'SM-ADV-2026-02',
    tag: 'MCP Server Boundary Hardening',
    target: 'affaan-m/everything-claude-code',
    title: 'Cross-Origin Request Boundary, Secret Leakage & Path-Traversal Prevention in Agent Configs',
    referenceLabel: 'Upstream Patch PR #3747',
    referenceUrl: 'https://github.com/affaan-m/everything-claude-code/pull/3747',
    referenceUrlLabel: 'View Upstream PR #3747',
    impact:
      'Eliminated cross-origin leakage paths and workspace filesystem escape vectors in multi-agent developer configurations.',
    ruleCoverage:
      'Mapped to StealthMark Rule Group: Zero-Trust MCP Header & Filesystem Hygiene',
    status: 'Upstream Patch Submitted',
    badgeColor: 'cyan',
  },
  {
    id: 'SM-ADV-2026-03',
    tag: 'Live Cryptographic & Passive Posture Attestation',
    target: 'Dominion Observatory × StealthMark MCP',
    title: 'Independent Production Verification Against stealthmark.io',
    referenceLabel: 'Public Baseline Issue #3 · Verified Score 94/100',
    referenceUrl: 'https://github.com/Dominion-Observatory/dominion-observatory/issues/3',
    referenceUrlLabel: 'View Attestation Issue #3',
    impact:
      'External security baseline audit confirmed DNSSEC, CAA, DMARC, TLS, CSP, and MCP unauthenticated probe defenses on stealthmark.io.',
    ruleCoverage:
      'Self-Enforced via StealthMark Edge Shield & Public Trust Policy (/trust)',
    status: 'Verified Third-Party Baseline',
    badgeColor: 'emerald',
  },
  {
    id: 'SM-ADV-2026-04',
    tag: 'Static Analysis & Cryptographic Hygiene',
    target: 'unclebob/ub-mode & crapper',
    title: 'Hardening Parser & Code-Quality Telemetry Pipelines in Open-Source Tooling',
    referenceLabel: 'PR #27 & Issue #10',
    referenceUrl: 'https://github.com/unclebob/crapper/pull/27',
    referenceUrlLabel: 'View Upstream PR #27',
    impact:
      'Resolved edge-case parsing assumptions and hardened telemetry reporting paths against malformed project inputs.',
    ruleCoverage:
      'Mapped to StealthMark Rule Group: AST Parser Determinism & Fail-Closed Diagnostics',
    status: 'Upstream PR Submitted',
    badgeColor: 'indigo',
  },
  {
    id: 'SM-ADV-2026-05',
    tag: 'Edge Proxy & Runtime Patch Coverage',
    target: 'Apache HTTP Server 2.4.71 & Node.js Nov 2026',
    title: 'Automated Detection for Proxy Header Smuggling, TLS Session Reuse & HTTP/2 DoS CVEs',
    referenceLabel: 'CVE-2026-34197 / CVE-2026-44301 Coverage',
    referenceUrl: '/scan',
    referenceUrlLabel: 'Test Your Domain Live',
    impact:
      'Zero-mutation passive heuristics flag vulnerable Apache 2.4.x reverse-proxy headers and unpatched Node.js runtime signatures.',
    ruleCoverage:
      'Mapped to StealthMark Passive Edge Signature Engine (Zero Exploitation)',
    status: 'Live in Production Engine',
    badgeColor: 'amber',
  },
  {
    id: 'SM-ADV-2026-06',
    tag: 'Agent Execution & CMS Plugin CVEs',
    target: 'AI Agent Runtimes & WordPress BookIt CVEs',
    title: 'Detecting Exposed Unauthenticated Agent Runtimes & Privilege Escalation Attack Surfaces',
    referenceLabel: 'CVE-2026-34194 / CVE-2026-44302 Coverage',
    referenceUrl: '/docs',
    referenceUrlLabel: 'Read Scanner Specifications',
    impact:
      'Identifies internet-facing agent control surfaces and high-risk CMS plugin exposure from passive headers and TLS fingerprints.',
    ruleCoverage:
      'Mapped to StealthMark Rule Group: Internet-Exposed Agent & CMS Fingerprint Detection',
    status: 'Live in Production Engine',
    badgeColor: 'rose',
  },
];

/**
 * Coordinated vulnerability disclosure ledger.
 * Zero-Leak OPSEC: unpatched or private vendor details, filenames, symbol names,
 * internal report IDs, and exploit steps are intentionally redacted while the
 * defensive invariant classes and StealthMark verification rules are exposed.
 */
export const COORDINATED_DISCLOSURES: readonly CoordinatedDisclosure[] = [
  // --- Maya Protocol (2 Reported + 2 Pending Queue) ---
  {
    id: 'MAYA-CD-01',
    platform: 'Maya Protocol',
    sector: 'Maya Protocol · Cross-Chain Liquidity & Synth Layer',
    title: 'Synthetic Asset Liquidity-Unit Dilution & Arithmetic Overflow Bounds',
    severity: 'Approved · Partial Bounty Settled',
    cweClass: 'CWE-190 / CWE-682 · Fixed-Point Conservation',
    stage: 'Partial Settlement',
    embargoNote:
      '90-day post-fix embargo active · Report #1 confirmed ($675 agreed; initial tranche settled, remainder queued)',
    defensiveCapability:
      'Generalized as a Z3 SMT Vault & AMM Rounding Conservation Invariant',
    proverPath: '/agents',
    proverLabel: 'Verify Vault & Rounding Invariants',
  },
  {
    id: 'MAYA-CD-02',
    platform: 'Maya Protocol',
    sector: 'Maya Protocol · Vault Solvency & Cross-Chain Migration',
    title: 'Multi-Asset Vault Accounting Conservation & Migration Liveness Boundary',
    severity: 'Reported · Under Maintainer Triage',
    cweClass: 'CWE-284 / CWE-662 · Cross-Chain Solvency',
    stage: 'Reported · Under Triage',
    embargoNote:
      '90-day post-fix embargo active · Report #2 delivered to security desk; awaiting maintainer triage verdict',
    defensiveCapability:
      'Generalized as Cross-Chain Bridge Memo & Solvency Conservation Checks',
    proverPath: '/agents',
    proverLabel: 'Inspect Cross-Chain Z3 Prover',
  },
  {
    id: 'MAYA-CD-03',
    platform: 'Maya Protocol',
    sector: 'Maya Protocol · Validator Economics & Consensus Layer',
    title: 'Validator Penalty Accounting Parity Across Staged Transaction Flows',
    severity: 'Verified · Pending Triage Window',
    cweClass: 'CWE-682 · Economic Slashing Invariance',
    stage: 'Queued · Pending Triage',
    embargoNote:
      'Queued behind Report #2 per coordinated cadence · Zero technical internals disclosed',
    defensiveCapability:
      'Enforced via StealthMark Arithmetic Bounds & State-Transition Consistency Checks',
    proverPath: '/agents',
    proverLabel: 'Explore Z3 Economic Provers',
  },
  {
    id: 'MAYA-CD-04',
    platform: 'Maya Protocol',
    sector: 'Maya Protocol · Swap Execution Bounds',
    title: 'Sub-Unit Price Slippage & Accounting Bounds Hardening',
    severity: 'Verified · Pending Triage Window',
    cweClass: 'CWE-682 · AMM Bounds Invariance',
    stage: 'Queued · Pending Triage',
    embargoNote:
      'Queued behind Report #2 per coordinated cadence · Hardening verification sealed until vendor review',
    defensiveCapability:
      'Mapped to AMM Liquidity Slippage & Zero-Value Floor Proofs',
    proverPath: '/agents',
    proverLabel: 'Explore AMM & Vault Provers',
  },

  // --- HackerOne Program Portfolio (8 Private / Triaged Submissions) ---
  {
    id: 'H1-CD-01',
    platform: 'HackerOne',
    sector: 'Cloud AI Agent CLI (Managed VDP)',
    title: 'Shell Permission Policy Enforcement & Command Normalization Invariance',
    severity: 'High (8.1)',
    cweClass: 'CWE-285 · Agent Sandbox Authorization',
    stage: 'Open · Under Assessment',
    embargoNote:
      'HackerOne Private Disclosure Policy active · Program & AST mechanics redacted pending patch',
    defensiveCapability:
      'Drives StealthMark Agent CLI Policy Normalization & Shell-Guard Rules',
    proverPath: '/scan',
    proverLabel: 'Run Perimeter & Agent Scan',
  },
  {
    id: 'H1-CD-02',
    platform: 'HackerOne',
    sector: 'Enterprise Cloud Go SDK',
    title: 'Bearer Credential Redaction Invariant Across Structured Runtime Logs',
    severity: 'Medium',
    cweClass: 'CWE-532 · Sensitive Token Redaction',
    stage: 'Open · Under Assessment',
    embargoNote:
      'HackerOne Private Disclosure Policy active · File paths and logger sinks withheld until remediation',
    defensiveCapability:
      'Enforced in StealthMark API Logger Redaction & Secret Hygiene Checks',
    proverPath: '/trust',
    proverLabel: 'View Logging Redaction Controls',
  },
  {
    id: 'H1-CD-03',
    platform: 'HackerOne',
    sector: 'Server-Side Web Request Framework',
    title: 'Cross-Origin CSRF Token Isolation & CSP Nonce Execution Boundary',
    severity: 'Medium',
    cweClass: 'CWE-352 · Origin & Nonce Isolation',
    stage: 'Open · Under Assessment',
    embargoNote:
      'HackerOne Private Disclosure Policy active · Redacted pending upstream maintainer review',
    defensiveCapability:
      'Mapped to StealthMark CSP Nonce, Same-Origin & Edge Header Validation',
    proverPath: '/scan',
    proverLabel: 'Audit Origin & CSP Headers',
  },
  {
    id: 'H1-CD-04',
    platform: 'HackerOne',
    sector: 'DeFi Oracle & Staking Reward Protocol',
    title: 'Historical Fee Accounting Snapshot & Multi-Pool Reward Conservation',
    severity: 'High',
    cweClass: 'CWE-682 / CWE-840 · Reward State Conservation',
    stage: 'Open · Under Assessment',
    embargoNote:
      'Private DeFi bounty submission · Contract names and state indices strictly embargoed',
    defensiveCapability:
      'Generalized as Z3 Reward Accumulator & Double-Claim Conservation Proof',
    proverPath: '/agents',
    proverLabel: 'View Formal DeFi Provers',
  },
  {
    id: 'H1-CD-05',
    platform: 'HackerOne',
    sector: 'Enterprise Network Access Control Appliance',
    title: 'Privileged Control-Plane Session & Authentication Boundary Enforcement',
    severity: 'Critical (9.3)',
    cweClass: 'CWE-287 · Control-Plane Auth Bypass',
    stage: 'Triaged · Awaiting Patch',
    embargoNote:
      'Confirmed Triaged · Fix rollout and coordinated advisory embargoed until GA release',
    defensiveCapability:
      'Generalized into StealthMark Fail-Closed JWT & Session Boundary Rules',
    proverPath: '/trust',
    proverLabel: 'Review Auth Hardening Standards',
  },
  {
    id: 'H1-CD-06',
    platform: 'HackerOne',
    sector: 'macOS Desktop Network Utility (Regression Audit)',
    title: 'Privileged Installer Helper Signature Verification & Regression Guard',
    severity: 'High',
    cweClass: 'CWE-345 · Patch Incomplete / Verification Bypass',
    stage: 'Open · Under Assessment',
    embargoNote:
      'Regression check against prior CVE fix · Binary mechanics withheld pending vendor verification',
    defensiveCapability:
      'Feeds StealthMark Post-Patch Regression & Cryptographic Integrity Rubric',
    proverPath: '/agents',
    proverLabel: 'Inspect Verification Agents',
  },
  {
    id: 'H1-CD-07',
    platform: 'HackerOne',
    sector: 'Multi-Chain Go Cryptography & Wallet SDK',
    title: 'Elliptic Curve Modular Arithmetic & Transaction Scheme Validation Guards',
    severity: 'Triaged Assessment',
    cweClass: 'CWE-476 / CWE-347 · Curve & Flag Validation',
    stage: 'Open · Under Assessment',
    embargoNote:
      'Submitted on HackerOne · Redacted algebraic edge cases pending SDK maintainer resolution',
    defensiveCapability:
      'Generalized via StealthMark Signature & Elliptic Curve Invariant Verification',
    proverPath: '/agents',
    proverLabel: 'Explore Crypto Signature Provers',
  },
  {
    id: 'H1-CD-08',
    platform: 'HackerOne',
    sector: 'Multi-Chain TypeScript Wallet SDK',
    title: 'ECDSA Signature Truthy-Error Handling & Off-Curve P-256 Point Rejection',
    severity: 'Triaged Assessment',
    cweClass: 'CWE-347 · Cryptographic Signature Verification',
    stage: 'Open · Under Assessment',
    embargoNote:
      'Submitted on HackerOne · Technical vectors redacted until upstream SDK hardening',
    defensiveCapability:
      'Generalized into Strict Non-Zero / On-Curve Cryptographic Pre-Flight Checks',
    proverPath: '/agents',
    proverLabel: 'Explore Crypto Signature Provers',
  },

  // --- Bugcrowd Program Portfolio (8 Coordinated Submissions) ---
  {
    id: 'BC-CD-01',
    platform: 'Bugcrowd',
    sector: 'Enterprise Collaboration & Issue-Tracking Plugin',
    title: 'Webhook Action Signature Verification & Channel Read Authorization Check',
    severity: 'Active Remediation Audit',
    cweClass: 'CWE-285 / CWE-347 · Signed Action ACL',
    stage: 'Triaged · Fix Verification',
    embargoNote:
      'Bugcrowd Confidential Disclosure · Incomplete-fix verification submitted for vendor review',
    defensiveCapability:
      'Generalized into StealthMark Webhook Signature & Tenant ACL Enforcement Checks',
    proverPath: '/docs',
    proverLabel: 'View API Security Controls',
  },
  {
    id: 'BC-CD-02',
    platform: 'Bugcrowd',
    sector: 'EVM-Compatible L1 Consensus Engine',
    title: 'Consensus Proposer Digest Integrity & Cross-Sequence State Isolation',
    severity: 'Active Assessment',
    cweClass: 'CWE-345 · Consensus Message Binding',
    stage: 'Open · Under Assessment',
    embargoNote:
      'Bugcrowd Private Submission · Consensus state transitions withheld pending client review',
    defensiveCapability:
      'Mapped to StealthMark Validator Consensus Digest & Replay Isolation Proofs',
    proverPath: '/agents',
    proverLabel: 'Explore Formal Protocol Provers',
  },
  {
    id: 'BC-CD-03',
    platform: 'Bugcrowd',
    sector: 'EVM Smart-Contract Permit Standard Suite',
    title: 'On-Chain Permit Nonce Monotonicity After Approval Revocation',
    severity: 'Active Assessment',
    cweClass: 'CWE-294 · Replay Resistance / Nonce Invariance',
    stage: 'Open · Under Assessment',
    embargoNote:
      'Bugcrowd Private Submission · Contract details embargoed until vendor triage completes',
    defensiveCapability:
      'Generalized as ERC-2612 / ERC-4494 Nonce Monotonicity Z3 Check',
    proverPath: '/agents',
    proverLabel: 'Verify Token Permit Invariants',
  },
  {
    id: 'BC-CD-04',
    platform: 'Bugcrowd',
    sector: 'Legacy UTXO Blockchain Node & RPC Layer',
    title: 'RPC Input Key Validation Guard & Spent-Output Pool Index Consistency',
    severity: 'P3 · Active Assessment',
    cweClass: 'CWE-20 / CWE-617 · RPC Availability Invariant',
    stage: 'Open · Under Assessment',
    embargoNote:
      'Bugcrowd Active Submission · Endpoint mechanics withheld under coordinated disclosure',
    defensiveCapability:
      'Mapped to Node RPC Defensive Input Fuzzing & Fail-Closed Error Handling',
    proverPath: '/docs',
    proverLabel: 'Read Protocol Guardrails',
  },
  {
    id: 'BC-CD-05',
    platform: 'Bugcrowd',
    sector: 'Enterprise Collaboration Subscription Plugin',
    title: 'Cross-Channel Subscription Target Validation & Tenant Isolation',
    severity: 'P2 · Triaged',
    cweClass: 'CWE-639 · Broken Access Control',
    stage: 'Closed · Prior Duplicate',
    embargoNote:
      'Confirmed valid P2 by triage team (matched existing remediation ticket) · Internals kept private',
    defensiveCapability:
      'Drives Tenant-ID Binding & IDOR Checks in StealthMark API Audits',
    proverPath: '/docs',
    proverLabel: 'Review Access-Control Rules',
  },
  {
    id: 'BC-CD-06',
    platform: 'Bugcrowd',
    sector: 'Multi-Chain Core Signing Library (Cardano UTXO)',
    title: 'Unsigned 64-Bit Integer Balance Conservation & Safe Transaction Bounds',
    severity: 'P2 · Triaged',
    cweClass: 'CWE-191 · Integer Underflow / UTXO Conservation',
    stage: 'Closed · Prior Duplicate',
    embargoNote:
      'Confirmed valid P2 by triage team (duplicate) · Generalized invariant already live as an x402 prover',
    defensiveCapability:
      'Live Z3 Solver: Cardano eUTXO Value Conservation Endpoint ($0.03 USDC)',
    proverPath: '/agents',
    proverLabel: 'Test Cardano Z3 Prover Live',
  },
  {
    id: 'BC-CD-07',
    platform: 'Bugcrowd',
    sector: 'EVM-Compatible L1 Consensus Implementation',
    title: 'Consensus Block-Proposer Authentication Digest Coverage Check',
    severity: 'Duplicate Review',
    cweClass: 'CWE-345 · Missing Cryptographic Verification Step',
    stage: 'Closed · Prior Duplicate',
    embargoNote:
      'Assessed under prior Bugcrowd consensus ticket · Details kept confidential per program rules',
    defensiveCapability:
      'Reinforces Zero-Exemption Consensus Digest Verification Matrix',
    proverPath: '/agents',
    proverLabel: 'Explore Z3 Verification Suite',
  },
  {
    id: 'BC-CD-08',
    platform: 'Bugcrowd',
    sector: 'Multi-Chain Core Wallet Parser (JSON Keystore)',
    title: 'Parser Bounds Enforcement & Exception-Safe Deserialization Guards',
    severity: 'P3 · Assessed Duplicate',
    cweClass: 'CWE-125 / CWE-476 · Memory & Bounds Safety',
    stage: 'Closed · Prior Duplicate',
    embargoNote:
      'Assessed under prior parser safety ticket · Generalized into strict offset bounds assertions',
    defensiveCapability:
      'Mapped to Bounds-Checked Keystore & Structured Parser Assertions',
    proverPath: '/agents',
    proverLabel: 'Inspect Parser Safety Provers',
  },
];

/**
 * Internal pre-disclosure research queue passing StealthMark's 7/7 deterministic
 * exploitability gate before vendor contact. Shown only as aggregate categories.
 */
export const PRE_DISCLOSURE_QUEUE: readonly PreDisclosureQueueBucket[] = [
  {
    channel: 'Enterprise Infrastructure & Cloud TLS VDP Queue',
    draftCount: 2,
    focusAreas: 'TLS Verification Defaults & Job Filter Enforcement Invariants',
    gateStatus: 'Queued for Responsible Vendor Submission',
  },
  {
    channel: 'L1 Smart-Contract Runtime Parity Queue',
    draftCount: 1,
    focusAreas: 'Cross-Client Bytecode Execution & Accounting Parity',
    gateStatus: 'Differential Verification Staged',
  },
  {
    channel: 'Digital Asset Exchange & Consumer Auth Queue',
    draftCount: 2,
    focusAreas: 'Two-Factor CSRF Origin Binding & Cross-Origin Header Hygiene',
    gateStatus: 'Awaiting Gate 7/7 Final Confirmation',
  },
  {
    channel: 'Web3 Brokerage API CORS Hardening Queue',
    draftCount: 1,
    focusAreas: 'Credentialed Cross-Origin Reflection Audit',
    gateStatus: 'Conservative Verification Hold',
  },
  {
    channel: 'AI Agent Skill Supply-Chain Packaging Audit',
    draftCount: 1,
    focusAreas: 'DSSE Envelope Verification, Static Bounds & Executable Hook Hygiene',
    gateStatus: 'Ready for Upstream Maintainer Notification',
  },
];

export const DISCLOSURE_METRICS = {
  publicAdvisoryCount: PUBLIC_ADVISORIES.length,
  mayaReportedCount: COORDINATED_DISCLOSURES.filter(
    (item) =>
      item.platform === 'Maya Protocol' &&
      (item.stage === 'Partial Settlement' || item.stage === 'Reported · Under Triage'),
  ).length,
  mayaQueuedCount: COORDINATED_DISCLOSURES.filter(
    (item) => item.platform === 'Maya Protocol' && item.stage === 'Queued · Pending Triage',
  ).length,
  hackerOneCount: COORDINATED_DISCLOSURES.filter((item) => item.platform === 'HackerOne').length,
  bugcrowdCount: COORDINATED_DISCLOSURES.filter((item) => item.platform === 'Bugcrowd').length,
  preDisclosureDraftCount: PRE_DISCLOSURE_QUEUE.reduce((acc, item) => acc + item.draftCount, 0),
} as const;
