# StealthMark Next.js Starter Example

A minimal Next.js application using `@stealthmark/next`. It detects AI agents that identify themselves, serves an agent manifest and, with an API key, meters agent traffic.

---

## How It Works

1. **A human visits** (Chrome, Safari, Firefox):
   - Next.js serves the normal React page (`app/page.tsx`)
   - `withStealthMark` adds an informational `x-stealthmark-shield: ACTIVE` marker header (it does not protect anything)

2. **An AI agent visits** (GPTBot, ClaudeBot, or a client that sends `x-stealthmark-agent`):
   - By default (`agentPolicy: 'observe'`) the page is served as usual and the response is tagged with `x-stealthmark-agent-detected: true` and `x-stealthmark-agent-id`
   - Requests to `/.well-known/agent.json`, or any path with `Accept: application/agent+json`, receive the agent manifest instead of the page

---

## Running Locally

From the root of the StealthMark monorepo:

```bash
# Build the SDK packages first
npm run build --workspace=@stealthmark/core
npm run build --workspace=@stealthmark/next

# Start the dev server in this example
cd examples/next-starter
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Testing with curl

### 1. Request as a Human (Browser):
```bash
curl -i http://localhost:3000
```
*Output: Standard HTML page with `x-stealthmark-shield: ACTIVE` header.*

### 2. Request the manifest as an AI agent:
```bash
curl -i -H "Accept: application/agent+json" http://localhost:3000
```
*Output: Structured JSON capability manifest with `content-type: application/agent+json`.*

### 3. Request the Well-Known Manifest directly:
```bash
curl -i http://localhost:3000/.well-known/agent.json
```
*Output: The manifest containing all declared capabilities and the agent policy.*
