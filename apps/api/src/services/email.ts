const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const DEFAULT_TIMEOUT_MS = 5000

export interface SendEmailParams {
  apiKey: string
  from: string
  to: string
  subject: string
  text: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface SendEmailResult {
  sent: boolean
  reason?: string
}

/** Minimal Resend client. Never throws: callers decide what a failed delivery means. */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { apiKey, from, to, subject, text, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = params

  try {
    const response = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      return { sent: false, reason: `http_${response.status}` }
    }
    return { sent: true }
  } catch (error) {
    const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return { sent: false, reason: isTimeout ? 'timeout' : 'network_error' }
  }
}
