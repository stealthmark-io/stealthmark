export interface ScenarioResult {
  name: string
  tokensConsumed: number
  latencyMs: number
  estimatedCostUsd: number
  success: boolean
  failureReason?: string
  resultPayload?: any
}

export async function runScenarioABlind(target: string | { dispatch: Function }): Promise<ScenarioResult> {
  const startTime = Date.now()

  try {
    // 1. Agent attempts to scrape or fetch the messy human ticketing page
    let res: any
    if (typeof target !== 'string' && target.dispatch) {
      res = await target.dispatch('/tickets/messi-inter-miami', 'GET', {
        'User-Agent': 'Mozilla/5.0 (compatible; AutonomousAgent/1.0; +http://agent.ai)',
        'Accept': 'text/html,application/xhtml+xml',
      })
    } else {
      res = await fetch(`${target}/tickets/messi-inter-miami`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AutonomousAgent/1.0; +http://agent.ai)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      })
    }

    const bodyText = await res.text()
    const latencyMs = Date.now() - startTime

    // 2. Anti-bot or Canvas block detection
    if (res.status === 403 || bodyText.includes('Turnstile Challenge Failed')) {
      // Tokens consumed trying to read the challenge page and re-trying
      const tokensConsumed = Math.floor(bodyText.length / 4) + 2000
      return {
        name: 'Scenario A: Blind Agent (Human Web Scraping)',
        tokensConsumed,
        latencyMs,
        estimatedCostUsd: Number((tokensConsumed * 0.00001).toFixed(4)),
        success: false,
        failureReason: 'Blocked by Anti-Bot Turnstile Challenge (403 Forbidden)',
      }
    }

    // Even if HTML is returned, it contains canvas, trackers and cookie banners
    const rawTokens = Math.floor(bodyText.length / 4)
    // Simulating LLM analysis cost over bloated HTML trying to find seat selector
    const analysisTokens = rawTokens + 15000 

    return {
      name: 'Scenario A: Blind Agent (Human Web Scraping)',
      tokensConsumed: analysisTokens,
      latencyMs,
      estimatedCostUsd: Number((analysisTokens * 0.00001).toFixed(4)),
      success: false,
      failureReason: 'Cannot interact with seat map: rendered in Canvas WebGL + obscured by Cookie Consent modal',
    }
  } catch (err: any) {
    return {
      name: 'Scenario A: Blind Agent (Human Web Scraping)',
      tokensConsumed: 45000,
      latencyMs: Date.now() - startTime,
      estimatedCostUsd: 0.45,
      success: false,
      failureReason: `Network or runtime failure: ${err.message}`,
    }
  }
}
