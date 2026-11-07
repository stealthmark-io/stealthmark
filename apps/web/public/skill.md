---
name: stealthmark-a2a-security
version: 2.1.0
description: Idempotent x402, On-Chain USDC/USDT & Polar A2A Security Gateway for autonomous agents. Provides 60-point OWASP Top 10:2025 Readiness Auditing, Pre-Pay Trust & Claim-Verification Receipts (/api/v2/trust-receipt), Wallet Prompt-Injection Firewall, 1-Click /llms.txt & agent.json Synthesis, and Cloudflare Edge Worker v2 Generation, with a 30% referral commission that is recorded, not paid out automatically.
homepage: https://stealthmark.io/scan
mcp_endpoint: https://stealthmark.io/api/mcp
trust_receipt_endpoint: https://stealthmark.io/api/v2/trust-receipt
payment_protocols:
  - x402
  - onchain-usdc-usdt
  - mpp-credits
  - polar-card-checkout
x402_config:
  network: base-mainnet
  chain_id: 8453
  token_symbol: USDC
  token_address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  recipient_wallet: "0xc8dc4ecb93c4c665Fad07E1261F5f7D60e3C6E0F"
  tron_usdt_wallet: "TYgGahN7wK9NtUVFZaXCwZqktaYmkuNxD8"
  claim_endpoint: "https://stealthmark.io/api/billing/crypto/claim"
  unlock_scan_endpoint: "https://stealthmark.io/api/billing/crypto/unlock-scan"
---

# StealthMark Agentic Security & A2A Edge Gateway (v2.1.0)

StealthMark provides deterministic **60-point OWASP Top 10:2025 domain readiness auditing**, **Pre-Pay Trust & Claim-Verification Receipts (`/api/v2/trust-receipt`)**, wallet prompt-injection protection, and 1-click remediation artifacts for autonomous agents and founders.

## Core Guarantees
1. **Single-Node Idempotency (`Idempotency-Key`):** Include `Idempotency-Key: <uuid-v4>` on any paid request (`/api/scan/manifests`, `/api/scan/edge-shield`, `/api/v2/trust-receipt`). Retries within 24 hours replay the cached result at **0 credits**.
2. **Dual-Rail Settlement (On-Chain USDC/USDT + Polar Card Checkout):**
   - **Pre-Pay Trust Receipt (`$9.00 USDC` via `x402Version: 1` or on-chain `txHash`):** `POST https://stealthmark.io/api/v2/trust-receipt`
   - **Website audit offer:** the 60-point audit is free for any domain, no signup. The full report with every fix recommendation is free for the first 20 scans per domain. The **Fix Pack** is a `$0.99` one-time unlock per domain (Cloudflare WAF rule, Cloudflare Worker, client-side RASP shield script, live badge snippet, white-label PDF report, plus unlimited re-scans for 30 days). Unlock via Polar card checkout at `https://stealthmark.io/scan?domain=<domain>` or with `0.99 USDC/USDT` on-chain (`Base`, `Polygon`, `BNB Chain` -> `0xc8dc4ecb93c4c665Fad07E1261F5f7D60e3C6E0F` | `Tron TRC-20` -> `TYgGahN7wK9NtUVFZaXCwZqktaYmkuNxD8`) via `POST https://stealthmark.io/api/billing/crypto/unlock-scan`.
3. **30% Referral Commission (recorded, not paid out automatically):** Every referred unlock (`?ref=<agent_handle_or_0x_wallet>`) records a 30% commission for the referrer. Nothing pays it out automatically; check what is recorded at `GET https://stealthmark.io/api/affiliates/stats?ref=<agent_handle>`.

## Endpoints & MCP Tools

1. **60-Point Web, DNS/DMARC, Client-Bundle & AI-Surface Readiness Audit**
   - `GET https://stealthmark.io/api/scan/audit?domain=<domain>`
   - MCP Tool: `stealthmark_audit_domain`

2. **Pre-Pay Trust & Claim-Verification Receipt Microservice (NEW)**
   - Quote Preview: `GET https://stealthmark.io/api/v2/trust-receipt?domain=<seller_domain>&claim=<stated_claim>`
   - Issue Signed Receipt (HMAC-SHA256 + 128-bit Anti-Replay Nonce + 24h TTL): `POST https://stealthmark.io/api/v2/trust-receipt` (`{"domain": "seller.com", "buyerAgent": "@your_agent", "claim": "...", "txHash": "0x...", "chain": "base"}`)
   - Verify Receipt (Constant-Time `timingSafeEqual`): `POST https://stealthmark.io/api/v2/trust-receipt` (`{"action": "verify_receipt", "receipt": {...}, "signature": "..."}`)
   - MCP Tool: `stealthmark_issue_trust_receipt`

3. **Wallet Prompt-Injection & Unicode Firewall Scan**
   - `POST https://api.stealthmark.io/api/v2/shield/scan` (`{"text": "...", "context": "untrusted_web_or_thread"}`)
   - MCP Tool: `stealthmark_shield_scan`

4. **1-Click Agentic SEO Manifest Generator (`/llms.txt` & `/.well-known/agent.json`)**
   - `POST https://stealthmark.io/api/scan/manifests`
   - MCP Tool: `stealthmark_generate_manifests`

5. **Cloudflare Edge Worker v2 & WAF Rule Generator**
   - `POST https://stealthmark.io/api/scan/edge-shield`
   - MCP Tool: `stealthmark_generate_edge_shield`
