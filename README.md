# StealthMark

[![DEUSPROOF certificate of birth](https://deusproof.com/api/agents/stealthmark/badge.svg)](https://deusproof.com/birth/stealthmark)

Monorepo of [stealthmark.io](https://stealthmark.io). It holds the website and console, the control-plane API, the agent gateway, and the source of the open-source SDK. The SDK lives in https://github.com/stealthmark-io/stealthmark-sdk; this README mirrors its claims and limits.

> Detects only agents that identify themselves. It does not detect stealth bots and is not a security control.

## What StealthMark is today

- An open-source (Apache-2.0) SDK that detects AI agents that identify themselves, meters what they read, and lets the site owner observe, serve a manifest, or block them. Adapters for Next.js, Express and Fastify, plus a CLI.
- A hosted console at stealthmark.io with a usage ledger, quotas and prepaid credit packs.

Not live: agent passports, KYA, DEFCON levels, human-in-the-loop approvals, the MCP server, A2A and commerce. Code for some of them exists in this repository behind feature flags that stay off in production, or as unpublished packages. Do not describe any of them as a product feature.

No latency, token-saving or success-rate figures are published, because none have been measured.

## Status of the packages

The SDK packages are published to npm with provenance (latest 0.1.2, published on 10-10-2026 after a first attempt failed while the repository was private). Install the npm release with:

```bash
npm install @stealthmark/next @stealthmark/core      # Next.js
npm install @stealthmark/express @stealthmark/core   # Express or Fastify
npx @stealthmark/cli init
```

Build this monorepo with `npm install && npm run build`.

## Layout

| Path | What it is | Public |
| :--- | :--- | :---: |
| `packages/core`, `packages/next`, `packages/express`, `packages/cli` | The SDK: detection, manifest, metering, adapters, CLI | On npm; mirrored byte for byte in the stealthmark-sdk repository |
| `packages/shared`, `packages/db`, `packages/telemetry` | Internal types, Drizzle schema, logging | No |
| `packages/mcp-server`, `packages/a2a-client` | Unpublished and not live | No |
| `apps/web` | Next.js 16 website, docs and console | No |
| `apps/api` | Fastify 5 control-plane API (API keys, quotas, usage ingest) | No |
| `infrastructure/gateway-lab` | Python (FastAPI) agent gateway and its pytest suite | No |
| `infrastructure/scripts` | Deploy scripts (API) and seed tooling | No |

`packages/{core,next,express,cli}` must stay identical to `packages/` in the stealthmark-sdk repository (excluding `node_modules`, `dist`, `.turbo` and `tsbuildinfo`). Change them in both places in the same step.

## Commands

Run from the repository root (Node 22 or newer):

```bash
npm test                                  # every workspace, must pass 100%
npm run typecheck                         # every workspace
npm run build
npm test --workspace=apps/api
npm test --workspace=apps/web
```

The gateway tests run with Python 3.11 or newer:

```bash
cd infrastructure/gateway-lab
pip install -r requirements.txt -r requirements-dev.txt
python3 -m pytest -q
```

CI (`.github/workflows/ci.yml`) runs the Node checks, the gateway pytest suite and a guard test for the deploy files (`node --test infrastructure/scripts/deploy-config.test.mjs`).

## Pricing

Free: 250 events per month. Instant Pass ($0.99 Crypto / $1.99 Polar for 2.5k events). Prepaid credit packs, paid once with Polar or Crypto USDT/USDC, with no subscription: Starter $9 / $7.99 crypto (15k events), Growth $29 / $24.99 crypto (60k events) and Scale $79 / $69 crypto (250k events). Credits are valid for 12 months from purchase.

## Deploys

- Web: Vercel, from `main`.
- API and gateway: Google Cloud Run in project `stealthmark-prod`. The API keeps `min-instances=1` because a cold start takes about 7 seconds. Deploys need the founder's explicit approval.

## More

- Security reports: [`SECURITY.md`](./SECURITY.md)

## License

The SDK packages (`packages/{core,next,express,cli}`) are Apache-2.0, see the `LICENSE` file inside each package. `apps/web`, `apps/api` and the gateway are not published to npm. The `LICENSE` file at the root of this repository is MIT, which predates the open-core decision and has not been reconciled yet.
