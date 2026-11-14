import { FIX_PACK, FREE_SCANS_PER_DOMAIN, UNLOCK_DAYS } from '@/lib/offer';
import { PRIVILEGED_MCP_TOOLS, PUBLIC_MCP_TOOLS } from '@/lib/mcp-tools';
import { SCAN_CHECK_COUNT } from '@/lib/readiness-report';
import { SITE_ORIGIN } from '@/lib/site';

/**
 * Everything StealthMark offers to AI agents, in one list. /agents renders it for people and
 * /agents.json serves it to agents. Every entry must answer in production today
 * (agent-catalog.test.ts checks the shape; the endpoints were verified live before they were added).
 */

export const MCP_ENDPOINT = `${SITE_ORIGIN}/api/mcp`;
export const GATEWAY_ORIGIN = 'https://gateway.stealthmark.io';
export const API_ORIGIN = 'https://api.stealthmark.io';

export type CatalogAccess = 'free' | 'api-key' | 'x402' | 'paid';

export interface CatalogEndpoint {
  id: string;
  name: string;
  summary: string;
  method: 'GET' | 'POST';
  url: string;
  access: CatalogAccess;
  pricing: string;
  /** Request body or query parameters, as an agent would send them. */
  input: Record<string, string>;
  mcpTool?: string;
}

export interface CatalogDocument {
  id: string;
  name: string;
  summary: string;
  url: string;
  format: string;
}

export interface CatalogPackage {
  name: string;
  summary: string;
  url: string;
}

export interface X402ProverEndpoint extends CatalogEndpoint {
  path: string;
  priceUsd: string;
  rails: string;
}

const CREDIT_COST = '25 credits per call from an API key (Authorization: Bearer sk_live_...)';

export const AGENT_ENDPOINTS: readonly CatalogEndpoint[] = [
  {
    id: 'audit_domain',
    name: 'Website readiness audit',
    summary: `Runs the ${SCAN_CHECK_COUNT}-point passive audit (transport, DNS and DMARC, crawl policy, AI surface, headers) and returns a graded JSON report.`,
    method: 'GET',
    url: `${SITE_ORIGIN}/api/scan/audit`,
    access: 'free',
    pricing: `Free. The full report with fixes is free for the first ${FREE_SCANS_PER_DOMAIN} scans per domain; the ${FIX_PACK.starterPriceLabel} Fix Pack adds the fix files and unlimited re-scans for ${UNLOCK_DAYS} days.`,
    input: { domain: 'example.com' },
    mcpTool: 'stealthmark_audit_domain',
  },
  {
    id: 'shield_scan',
    name: 'Prompt-injection and Unicode scan',
    summary: 'Scans untrusted text for invisible Unicode tags, NFKC homoglyphs and wallet-draining prompt injections before an agent acts on it.',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/api/v2/shield/scan`,
    access: 'free',
    pricing: 'Free',
    input: { text: 'Untrusted text or HTML', context: 'Optional label, up to 64 characters (default untrusted_input)' },
    mcpTool: 'stealthmark_shield_scan',
  },
  {
    id: 'trust_receipt_quote',
    name: 'Pre-pay trust quote',
    summary: 'Before an agent pays a seller, returns the seller domain’s perimeter grade and a preliminary decision.',
    method: 'GET',
    url: `${SITE_ORIGIN}/api/v2/trust-receipt`,
    access: 'free',
    pricing: 'Free',
    input: { domain: 'seller.com', claim: 'What the seller states' },
    mcpTool: 'stealthmark_issue_trust_receipt',
  },
  {
    id: 'trust_receipt_issue',
    name: 'Signed trust receipt',
    summary: 'Issues a receipt signed with HMAC-SHA256, a 128-bit nonce and a 24-hour TTL, or verifies one in constant time.',
    method: 'POST',
    url: `${SITE_ORIGIN}/api/v2/trust-receipt`,
    access: 'x402',
    pricing: '9.00 USDC on Base via x402, or an on-chain txHash. Verifying a receipt is free.',
    input: { domain: 'seller.com', buyerAgent: '@your_agent', claim: '...', txHash: '0x...', chain: 'base' },
    mcpTool: 'stealthmark_issue_trust_receipt',
  },
  {
    id: 'generate_manifests',
    name: 'llms.txt and agent.json generator',
    summary: 'Writes a production /llms.txt and /.well-known/agent.json for a domain.',
    method: 'POST',
    url: `${SITE_ORIGIN}/api/scan/manifests`,
    access: 'api-key',
    pricing: CREDIT_COST,
    input: { domain: 'example.com' },
    mcpTool: 'stealthmark_generate_manifests',
  },
  {
    id: 'generate_edge_shield',
    name: 'Cloudflare Worker and WAF rules',
    summary: 'Generates a Cloudflare Worker, WAF rule expressions and an enforced DMARC record for a domain.',
    method: 'POST',
    url: `${SITE_ORIGIN}/api/scan/edge-shield`,
    access: 'api-key',
    pricing: CREDIT_COST,
    input: { domain: 'example.com' },
    mcpTool: 'stealthmark_generate_edge_shield',
  },
  {
    id: 'unlock_fix_pack',
    name: 'Fix Pack unlock with stablecoins',
    summary: 'Unlocks the Fix Pack for a domain after an on-chain USDC or USDT payment.',
    method: 'POST',
    url: `${SITE_ORIGIN}/api/billing/crypto/unlock-scan`,
    access: 'paid',
    pricing: `${FIX_PACK.starterPriceLabel} in USDC or USDT on Base, Polygon, BNB Chain or Tron`,
    input: { domain: 'example.com', network: 'base | polygon | bsc | tron', txHash: '0x...' },
  },
  {
    id: 'grade_badge',
    name: 'Grade badge',
    summary: 'An SVG badge with a domain’s current grade, for READMEs and footers.',
    method: 'GET',
    url: `${SITE_ORIGIN}/api/badge/{domain}`,
    access: 'free',
    pricing: 'Free',
    input: { domain: 'example.com (in the path)' },
  },
  {
    id: 'affiliate_stats',
    name: 'Referral commissions',
    summary: 'Shows the 30% commission recorded for an agent that shares /scan?domain=<domain>&ref=<id>. It is recorded, not paid out automatically.',
    method: 'GET',
    url: `${SITE_ORIGIN}/api/affiliates/stats`,
    access: 'free',
    pricing: 'Free',
    input: { ref: 'Agent handle or 0x wallet' },
  },
];

export const AGENT_DOCUMENTS: readonly CatalogDocument[] = [
  { id: 'catalog', name: 'This catalog', summary: 'Every endpoint, tool and manifest on this page, as JSON.', url: `${SITE_ORIGIN}/agents.json`, format: 'application/json' },
  { id: 'agent_manifest', name: 'Agent manifest', summary: 'The policy and capabilities this site publishes for agents.', url: `${SITE_ORIGIN}/.well-known/agent.json`, format: 'application/agent+json' },
  { id: 'mcp_manifest', name: 'MCP manifest', summary: 'Transport, tools and payment rails of the MCP server.', url: `${SITE_ORIGIN}/.well-known/mcp.json`, format: 'application/json' },
  { id: 'skill', name: 'Agent skill', summary: 'Endpoints, payment rails and call examples in one Markdown file.', url: `${SITE_ORIGIN}/skill.md`, format: 'text/markdown' },
  { id: 'llms', name: 'llms.txt', summary: 'A short map of this site for language models.', url: `${SITE_ORIGIN}/llms.txt`, format: 'text/plain' },
  { id: 'ai_catalog', name: 'AI catalog', summary: 'Documentation and API resources for discovery crawlers.', url: `${SITE_ORIGIN}/.well-known/ai-catalog.json`, format: 'application/json' },
  { id: 'openapi', name: 'Governance API (OpenAPI)', summary: 'The REST API behind the SDK console.', url: `${API_ORIGIN}/v1/openapi.json`, format: 'application/json' },
];

export const SDK_PACKAGES: readonly CatalogPackage[] = [
  { name: '@stealthmark/next', summary: 'Next.js middleware: detect, observe or block AI agents and serve them a manifest.', url: 'https://www.npmjs.com/package/@stealthmark/next' },
  { name: '@stealthmark/express', summary: 'The same engine for Express and Fastify.', url: 'https://www.npmjs.com/package/@stealthmark/express' },
  { name: '@stealthmark/core', summary: 'The framework-agnostic content-negotiation engine.', url: 'https://www.npmjs.com/package/@stealthmark/core' },
  { name: '@stealthmark/cli', summary: 'npx @stealthmark/cli init wires the middleware into a project.', url: 'https://www.npmjs.com/package/@stealthmark/cli' },
];

export const MCP_SERVER = {
  url: MCP_ENDPOINT,
  transport: 'streamable-http',
  protocolVersion: '2025-03-26',
  publicTools: PUBLIC_MCP_TOOLS.map((tool) => tool.name),
  keyTools: PRIVILEGED_MCP_TOOLS.map((tool) => tool.name),
  access:
    'initialize, tools/list and tools/call for the three public tools answer without a key, under the same rate limits as their REST endpoints. The two generator tools need Authorization: Bearer sk_live_....',
} as const;

export const X402_PROVER_ENDPOINTS: readonly X402ProverEndpoint[] = [
  {
    id: 'x402_verify_vault_and_rounding',
    name: 'Vault & Rounding Direction Verification',
    summary: 'Z3 formal proof verifying vault deposit/withdraw rounding directions, share math, and inflation protection invariants.',
    path: '/x402/verify-vault-and-rounding',
    priceUsd: '$0.02',
    pricing: '$0.02 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-vault-and-rounding`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { spec: 'Vault math specification & rounding constraints', timeout_ms: '5000' },
  },
  {
    id: 'x402_verify_polymarket_basket',
    name: 'Polymarket Basket & Probability Arb Prover',
    summary: 'Z3 SMT prover for prediction market multi-outcome conditional token baskets, ensuring probability sum <= 1.0 and arbitrage bounds.',
    path: '/x402/verify-polymarket-basket',
    priceUsd: '$0.02',
    pricing: '$0.02 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-polymarket-basket`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { basket: 'Outcome token IDs, prices, and condition IDs', timeout_ms: '5000' },
  },
  {
    id: 'x402_verify_zk_and_bitvec',
    name: 'ZK & Bitvector Constraint Verification',
    summary: 'Formal bit-precise verification of zero-knowledge circuit inputs, bitvector manipulations, and range proof constraints.',
    path: '/x402/verify-zk-and-bitvec',
    priceUsd: '$0.03',
    pricing: '$0.03 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-zk-and-bitvec`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { bitwidth: '256', constraints: 'SMT-LIB2 bitvector constraints', timeout_ms: '5000' },
  },
  {
    id: 'x402_verify_differential_spec',
    name: 'Differential Specification Equivalence',
    summary: 'Z3 inductive proof establishing behavioral equivalence between optimized bytecode/assembly and formal mathematical specifications.',
    path: '/x402/verify-differential-spec',
    priceUsd: '$0.05',
    pricing: '$0.05 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-differential-spec`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { impl: 'Target bytecode/IR', spec: 'Reference specification', timeout_ms: '8000' },
  },
  {
    id: 'x402_verify_forensic_graph',
    name: 'Forensic Transaction Graph Verification',
    summary: 'Formal graph acyclicity, taint tracking, and fund flow conservation verification across complex exploit traces.',
    path: '/x402/verify-forensic-graph',
    priceUsd: '$0.05',
    pricing: '$0.05 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-forensic-graph`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { nodes: 'Graph nodes and transaction hashes', edges: 'Fund transfer edges', timeout_ms: '8000' },
  },
  {
    id: 'x402_verify_ast_blast_radius',
    name: 'AST Blast Radius & Mutation Prover',
    summary: 'Symbolic blast radius analysis and control-flow reachability verification across smart contract AST diffs.',
    path: '/x402/verify-ast-blast-radius',
    priceUsd: '$0.03',
    pricing: '$0.03 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-ast-blast-radius`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { diff: 'Solidity/Vyper AST JSON diff', rootEntry: 'Entrypoint function', timeout_ms: '5000' },
  },
  {
    id: 'x402_verify_erc4626_inflation_guard',
    name: 'ERC-4626 First-Deposit Inflation Guard',
    summary: 'Z3 verification proving immunity against first-deposit / empty-vault donation share dilution attacks.',
    path: '/x402/verify-erc4626-inflation-guard',
    priceUsd: '$0.03',
    pricing: '$0.03 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-erc4626-inflation-guard`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { contract: '0x... or Solidity source', decimalsOffset: 'Virtual offset', timeout_ms: '5000' },
  },
  {
    id: 'x402_verify_amm_constant_product',
    name: 'Constant-Product AMM Invariant Verification',
    summary: 'Formal invariant verification of k=x*y curves under fee-on-transfer, asymmetric swaps, and rebase tokens.',
    path: '/x402/verify-amm-constant-product',
    priceUsd: '$0.03',
    pricing: '$0.03 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-amm-constant-product`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { reserves: 'Reserve tuple (x, y)', feeBps: 'Fee in basis points', timeout_ms: '5000' },
  },
  {
    id: 'x402_verify_crosschain_bridge_memo',
    name: 'Cross-Chain Bridge Payload & Memo Prover',
    summary: 'SMT verification of cross-chain message encoding, replay defense nonces, and payload serialization.',
    path: '/x402/verify-crosschain-bridge-memo',
    priceUsd: '$0.02',
    pricing: '$0.02 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-crosschain-bridge-memo`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { sourceChain: 'Chain ID', memoPayload: 'ABI or Borsh encoded payload', timeout_ms: '5000' },
  },
  {
    id: 'x402_verify_cardano_eutxo_conservation',
    name: 'Cardano eUTXO Value Conservation Prover',
    summary: 'Z3 value conservation and multi-asset minting/burning policy verification for Plutus eUTXO scripts.',
    path: '/x402/verify-cardano-eutxo-conservation',
    priceUsd: '$0.03',
    pricing: '$0.03 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-cardano-eutxo-conservation`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { inputs: 'Input UTXO values', outputs: 'Output UTXO values', fee: 'Lovelace fee', timeout_ms: '5000' },
  },
  {
    id: 'x402_verify_mev_sandwich_bound',
    name: 'MEV Sandwich Extraction Bound Prover',
    summary: 'SMT bounding of maximal extractable value, slippage tolerances, and front-running sandwich profit margins.',
    path: '/x402/verify-mev-sandwich-bound',
    priceUsd: '$0.02',
    pricing: '$0.02 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-mev-sandwich-bound`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { targetTx: 'Transaction calldata & slippage', mempoolState: 'Pool liquidity state', timeout_ms: '5000' },
  },
  {
    id: 'x402_verify_permit2_signature_scope',
    name: 'Permit2 Signature Scope & Expiry Verification',
    summary: 'Formal proof of Uniswap Permit2 allowance bounds, witness data integrity, and replay resistance.',
    path: '/x402/verify-permit2-signature-scope',
    priceUsd: '$0.02',
    pricing: '$0.02 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-permit2-signature-scope`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { permit: 'PermitSingle or PermitBatch struct', signature: '0x...', timeout_ms: '5000' },
  },
  {
    id: 'x402_verify_liquidation_waterfall',
    name: 'Liquidation Waterfall & Bad Debt Prover',
    summary: 'Multi-collateral liquidation priority, close factor bounds, and bad debt insolvency prevention verification.',
    path: '/x402/verify-liquidation-waterfall',
    priceUsd: '$0.04',
    pricing: '$0.04 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-liquidation-waterfall`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { position: 'Collateral/borrow balances', liquidationIncentive: 'Bonus bps', timeout_ms: '6000' },
  },
  {
    id: 'x402_verify_merkle_airdrop_claim',
    name: 'Merkle Tree Multi-Claim & Leaf Prover',
    summary: 'Formal verification of Merkle tree depth, second-preimage collision resistance, and cumulative claim bounds.',
    path: '/x402/verify-merkle-airdrop-claim',
    priceUsd: '$0.02',
    pricing: '$0.02 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-merkle-airdrop-claim`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { root: '0x... 32-byte root', proof: 'Branch proof array', leaf: 'Claim leaf bytes', timeout_ms: '5000' },
  },
  {
    id: 'x402_verify_fiat_crypto_otc_settlement',
    name: 'Fiat-Crypto OTC Atomic Settlement Prover',
    summary: 'Bilateral atomic escrow settlement verification with escrow timeout, fiat ledger proof, and payment proofs.',
    path: '/x402/verify-fiat-crypto-otc-settlement',
    priceUsd: '$0.05',
    pricing: '$0.05 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-fiat-crypto-otc-settlement`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { escrowId: 'OTC Escrow ID', bankLedgerRef: 'Hashed settlement reference', timeout_ms: '8000' },
  },
  {
    id: 'x402_verify_sar_ed25519_dossier',
    name: 'SAR Compliance Dossier Cryptographic Prover',
    summary: 'Cryptographic non-repudiation and timestamp proof verification for compliance dossiers and law enforcement handoffs.',
    path: '/x402/verify-sar-ed25519-dossier',
    priceUsd: '$0.05',
    pricing: '$0.05 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-sar-ed25519-dossier`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { dossierHash: 'SHA-256 fingerprint', signature: 'Ed25519 public signature', timeout_ms: '8000' },
  },
  {
    id: 'x402_screen_ofac_sanctions',
    name: 'OFAC & Global Sanctions Screening Prover',
    summary: 'Real-time deterministic screening against SDN sanctions, secondary lists, and sanctioned crypto clusters.',
    path: '/x402/screen-ofac-sanctions',
    priceUsd: '$0.02',
    pricing: '$0.02 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/screen-ofac-sanctions`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { address: 'Wallet address or domain', chain: 'evm | solana | btc', timeout_ms: '5000' },
  },
  {
    id: 'x402_verify_cctp_route',
    name: 'Circle CCTP Cross-Chain Route Verification',
    summary: 'Formal verification of Circle Cross-Chain Transfer Protocol domain IDs, burn events, and attestation validity.',
    path: '/x402/verify-cctp-route',
    priceUsd: '$0.02',
    pricing: '$0.02 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-cctp-route`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { sourceDomain: 'CCTP domain uint32', messageBytes: 'Raw CCTP message', timeout_ms: '5000' },
  },
  {
    id: 'x402_detect_collateral_cycles',
    name: 'DeFi Recursive Collateral Loop Detector',
    summary: 'Z3 cycle detection across re-hypothecated lending markets, looping leverage, and circular depeg exposures.',
    path: '/x402/detect-collateral-cycles',
    priceUsd: '$0.02',
    pricing: '$0.02 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/detect-collateral-cycles`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { protocols: 'Comma-delimited protocol identifiers', maxDepth: 'Loop search depth', timeout_ms: '5000' },
  },
  {
    id: 'x402_verify_prediction_arbitrage',
    name: 'Prediction Market Arbitrage & Discrepancy Prover',
    summary: 'Cross-venue prediction market probability discrepancy and riskless negative-risk Dutch-book verifier.',
    path: '/x402/verify-prediction-arbitrage',
    priceUsd: '$0.02',
    pricing: '$0.02 via x402 (USDC on Base eip155:8453 or Solana SPL)',
    method: 'POST',
    url: `${GATEWAY_ORIGIN}/x402/verify-prediction-arbitrage`,
    access: 'x402',
    rails: 'Base eip155:8453 | Solana SPL (Deliver-Then-Settle)',
    input: { markets: 'Array of market pair bids/asks', feeModel: 'Taker fee rate', timeout_ms: '5000' },
  },
];

export function buildAgentCatalog() {
  return {
    schema: 'stealthmark-agent-catalog/1',
    name: 'StealthMark for AI agents',
    url: `${SITE_ORIGIN}/agents`,
    description:
      'Security tools agents can call (website audit, prompt-injection scan, pre-pay trust receipts, manifest and edge-rule generators, 20 Z3 formal verification x402 provers) and the open-source SDK that lets a site govern the agents that visit it.',
    mcp: MCP_SERVER,
    endpoints: AGENT_ENDPOINTS,
    x402Provers: X402_PROVER_ENDPOINTS,
    documents: AGENT_DOCUMENTS,
    sdk: SDK_PACKAGES,
    contact: `${SITE_ORIGIN}/enterprise/contact`,
  };
}
