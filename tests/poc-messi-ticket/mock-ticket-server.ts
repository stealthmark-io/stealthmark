import http from 'node:http'

export interface MockTicketServerOptions {
  port?: number
  enableAntiBotDelay?: boolean
}

export function createMockTicketServer(options: MockTicketServerOptions = {}) {
  const port = options.port || 4321
  const enableAntiBotDelay = options.enableAntiBotDelay ?? true

  // Bloated HTML payload (simulates modern bloated SPAs with trackers, canvas, ads)
  const junkScripts = Array.from({ length: 400 }, (_, i) => 
    `<script type="text/javascript" id="gtm-tracker-${i}">/* analytics_payload_${i} */ window.__ANALYTICS_STATE_${i} = { event: "page_view", timestamp: ${Date.now() + i}, session: "sid_${Math.random()}" };</script>`
  ).join('\n')

  const bloatedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Inter Miami CF vs LA Galaxy - Official Ticket Hub</title>
  ${junkScripts}
  <style>
    body { font-family: sans-serif; margin: 0; background: #0b0e14; color: #fff; }
    .cookie-banner { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 9999; display: flex; align-items: center; justify-content: center; }
    .canvas-seatmap { width: 800px; height: 500px; background: #161b22; }
  </style>
</head>
<body>
  <div class="cookie-banner" id="cookie-consent-modal">
    <div style="background:#222; padding:30px; border-radius:8px; max-width:500px;">
      <h2>Accept 142 Advertising Cookies to Continue</h2>
      <button id="accept-all-btn">Accept All</button>
    </div>
  </div>

  <div class="container">
    <h1>Inter Miami vs LA Galaxy — Chase Stadium</h1>
    <p class="match-info">Featuring Lionel Messi (#10) • Saturday 8:00 PM</p>
    
    <!-- Un-parseable by text LLM without computer vision -->
    <div id="seat-selector-wrapper">
      <canvas id="webgl-stadium-canvas" class="canvas-seatmap"></canvas>
      <noscript>Please enable JavaScript, WebGL, and Cloudflare Turnstile to view available seats.</noscript>
    </div>

    <!-- Hidden checkout button disabled until interactive canvas click and Turnstile challenge completes -->
    <button id="buy-ticket-btn" disabled style="display:none;">Buy Selected Seat ($450)</button>
  </div>
</body>
</html>`

  // Agent manifest conforming to StealthMark Gateway Standard
  const agentManifest = {
    manifestVersion: '1.0.0',
    site: {
      domain: 'tickets.intermiami.local',
      displayName: 'Inter Miami CF Official Ticket Hub',
      description: 'Autonomous Agent Direct Ticket Booking Gateway protected by StealthMark',
      accessPolicy: 'open',
    },
    gateway: {
      auth: 'stealthmark_passport',
      passportTtlSeconds: 3600,
      maxRpm: 60,
      verificationEndpoint: 'http://localhost:3000/v1/gateway/tokens/verify',
    },
    actions: [
      {
        slug: 'reserve_messi_ticket',
        displayName: 'Reserve Messi Match Ticket',
        description: 'Direct programmatic reservation of seat for Inter Miami CF vs LA Galaxy without human CAPTCHAs',
        method: 'POST',
        endpointUrl: `http://127.0.0.1:${port}/_stealthmark/actions/reserve`,
        inputSchema: {
          type: 'object',
          properties: {
            matchId: { type: 'string', default: 'match_messi_2026_09' },
            section: { type: 'string', enum: ['VIP_FIELD', 'LOWER_BOWL', 'UPPER_DECK'] },
            quantity: { type: 'number', minimum: 1, maximum: 4 },
          },
          required: ['matchId', 'section', 'quantity'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            seat: { type: 'string' },
            priceUsd: { type: 'number' },
            status: { type: 'string' },
          },
        },
        requiredScopes: ['tickets:write'],
        rateLimitRpm: 30,
      },
    ],
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`)

    // 1. Human / Dumb Bot Route: Raw Bloated HTML + Cloudflare Turnstile delay
    if (url.pathname === '/tickets/messi-inter-miami') {
      const userAgent = req.headers['user-agent'] || ''
      const isBot = /curl|python|axios|headless|crawler/i.test(userAgent)

      if (enableAntiBotDelay && isBot) {
        // Simulates Cloudflare Turnstile waiting for browser challenge verification (blocks basic scraper)
        await new Promise((r) => setTimeout(r, 1200))
        res.writeHead(403, { 'Content-Type': 'text/html' })
        res.end(`<html><title>Just a moment...</title><body><h1>403 Forbidden - Cloudflare Turnstile Challenge Failed</h1><p>Agent or bot detected without interactive browser execution.</p></body></html>`)
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(bloatedHtml)
      return
    }

    // 2. Machine Discovery: /.well-known/agent.json
    if (url.pathname === '/.well-known/agent.json' || url.pathname === '/_stealthmark/manifest') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-StealthMark-Gateway': 'active',
      })
      res.end(JSON.stringify(agentManifest, null, 2))
      return
    }

    // 3. StealthMark Direct Agent Action Endpoint: POST /_stealthmark/actions/reserve
    if (url.pathname === '/_stealthmark/actions/reserve' && req.method === 'POST') {
      const authHeader = req.headers['authorization'] || ''
      if (!authHeader.startsWith('Bearer smp_')) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'unauthorized', message: 'Missing valid StealthMark Agent Passport token' }))
        return
      }

      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}')
          const confirmation = {
            success: true,
            reservationId: `RES_MESSI_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            match: 'Inter Miami CF vs LA Galaxy',
            section: payload.section || 'VIP_FIELD',
            seat: 'Section 101, Row 1, Seat 10 (Direct Field View)',
            quantity: payload.quantity || 1,
            priceUsd: 450.00 * (payload.quantity || 1),
            agentId: 'agent_autodev_001',
            status: 'confirmed',
            timestamp: new Date().toISOString(),
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(confirmation))
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'bad_request', message: 'Invalid JSON payload' }))
        }
      })
      return
    }

    // Default 404
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not_found', path: url.pathname }))
  })

  // In-process sandboxed dispatcher
  async function dispatch(
    pathname: string,
    method = 'GET',
    headers: Record<string, string> = {},
    body?: any
  ): Promise<{ status: number; ok: boolean; headers: Record<string, string>; text: () => Promise<string>; json: () => Promise<any> }> {
    const url = new URL(pathname, `http://127.0.0.1:${port}`)

    if (url.pathname === '/tickets/messi-inter-miami') {
      const userAgent = headers['user-agent'] || headers['User-Agent'] || ''
      const isBot = /curl|python|axios|headless|crawler|agent/i.test(userAgent)
      if (enableAntiBotDelay && isBot) {
        return {
          status: 403,
          ok: false,
          headers: { 'content-type': 'text/html' },
          text: async () => `<html><title>Just a moment...</title><body><h1>403 Forbidden - Cloudflare Turnstile Challenge Failed</h1><p>Agent or bot detected without interactive browser execution.</p></body></html>`,
          json: async () => ({ error: 'forbidden' }),
        }
      }
      return {
        status: 200,
        ok: true,
        headers: { 'content-type': 'text/html' },
        text: async () => bloatedHtml,
        json: async () => ({}),
      }
    }

    if (url.pathname === '/.well-known/agent.json' || url.pathname === '/_stealthmark/manifest') {
      return {
        status: 200,
        ok: true,
        headers: { 'content-type': 'application/json' },
        text: async () => JSON.stringify(agentManifest),
        json: async () => agentManifest,
      }
    }

    if (url.pathname === '/_stealthmark/actions/reserve' && method.toUpperCase() === 'POST') {
      const auth = headers['authorization'] || headers['Authorization'] || ''
      if (!auth.startsWith('Bearer smp_')) {
        return {
          status: 401,
          ok: false,
          headers: { 'content-type': 'application/json' },
          text: async () => JSON.stringify({ error: 'unauthorized' }),
          json: async () => ({ error: 'unauthorized', message: 'Missing valid StealthMark Agent Passport token' }),
        }
      }

      const payload = typeof body === 'string' ? JSON.parse(body || '{}') : (body || {})
      const confirmation = {
        success: true,
        reservationId: `RES_MESSI_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        match: 'Inter Miami CF vs LA Galaxy',
        section: payload.section || 'VIP_FIELD',
        seat: 'Section 101, Row 1, Seat 10 (Direct Field View)',
        quantity: payload.quantity || 1,
        priceUsd: 450.00 * (payload.quantity || 1),
        agentId: 'agent_autodev_001',
        status: 'confirmed',
        timestamp: new Date().toISOString(),
      }

      return {
        status: 200,
        ok: true,
        headers: { 'content-type': 'application/json' },
        text: async () => JSON.stringify(confirmation),
        json: async () => confirmation,
      }
    }

    return {
      status: 404,
      ok: false,
      headers: { 'content-type': 'application/json' },
      text: async () => JSON.stringify({ error: 'not_found' }),
      json: async () => ({ error: 'not_found' }),
    }
  }

  return {
    server,
    port,
    dispatch,
    start: () => new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve())),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
