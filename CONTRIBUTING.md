# Contributing to StealthMark

First off, thank you for considering contributing to StealthMark! It's people like you who make open-source infrastructure reliable and developer-friendly.

StealthMark is an open-core project dedicated to making the modern web natively accessible and defensively robust for AI agents.

---

## Code of Conduct

We are committed to providing a welcoming and inclusive environment for everyone. Please be respectful and constructive in all discussions, issues, and pull requests.

---

## Monorepo Architecture

StealthMark uses a standard npm workspace monorepo managed with Turborepo:

```
stealthmark/
├── packages/
│   ├── core/         # @stealthmark/core — Framework-agnostic engine (0 dependencies)
│   ├── next/         # @stealthmark/next — Drop-in Next.js middleware SDK
│   ├── shared/       # Shared TypeScript types, schemas & constants
│   ├── mcp-server/   # Model Context Protocol server
│   └── telemetry/    # Telemetry client primitives
├── apps/
│   ├── web/          # Next.js 15+ App Router (Landing, Console, Documentation)
│   └── api/          # High-performance Fastify backend service
└── infrastructure/   # Cloud Run gateway, Terraform & deployment automation
```

---

## Getting Started Locally

### Prerequisites

- **Node.js**: `>= 22.0.0`
- **npm**: `>= 10.0.0`

### Installation

```bash
# Clone your fork
git clone https://github.com/stealthmark-io/stealthmark.git
cd stealthmark

# Install dependencies across all workspaces
npm install
```

### Building & Testing Packages

```bash
# Build the SDK packages
cd packages/core && npm run build
cd packages/next && npm run build

# Run unit tests
cd packages/core && npm test
cd packages/next && npm test

# Typecheck
cd packages/core && npm run typecheck
cd packages/next && npm run typecheck
```

---

## Development Guidelines

1. **Zero External Runtime Dependencies for `@stealthmark/core`**:
   The core engine must remain lightweight, fast, and portable across Node.js, Cloudflare Workers, Deno, and Bun. Avoid adding heavy runtime dependencies.

2. **Strict TypeScript**:
   All new code must pass `tsc --noEmit` under strict mode without `any` workarounds in production code.

3. **Test-Driven Changes**:
   Every new capability, agent detection pattern, or middleware feature must have matching unit tests in `src/__tests__/`. We maintain high coverage across edge cases.

4. **Security & Secrets**:
   Never commit API keys, service role credentials, or private keys. Review your diff with `git diff` before committing.

---

## Submitting a Pull Request

1. Fork the repo and create your feature branch:
   ```bash
   git checkout -b feature/my-new-feature
   ```
2. Commit your changes with conventional commit messages:
   ```bash
   git commit -m "feat(core): add Anthropic Computer Use agent pattern"
   ```
3. Push to your branch and open a Pull Request against `main`.
4. Ensure all CI checks (linting, tests, build) pass.

---

## Security Vulnerabilities

If you discover a security vulnerability in StealthMark, please DO NOT open a public issue. Review our [Security Policy](SECURITY.md) and report it to `security@stealthmark.io`.
