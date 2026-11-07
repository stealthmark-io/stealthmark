import { NextResponse } from 'next/server';
import {
  deliverLead,
  enforceRateLimit,
  honeypotResponse,
  isHoneypotTripped,
  isValidEmail,
  limitText,
  readJsonObject,
  undeliveredResponse,
} from '@/lib/lead-intake';

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit(request, 'subscribe', RATE_LIMIT, RATE_WINDOW_MS);
    if (limited) return limited;

    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    if (isHoneypotTripped(parsed.body)) return honeypotResponse();

    const email = limitText(parsed.body.email, 254);
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Please provide a valid email address.' }, { status: 400 });
    }

    const delivery = await deliverLead({
      subject: 'StealthMark update request',
      replyTo: email,
      text: `Update request from ${email}\nReceived: ${new Date().toISOString()}`,
      discord: {
        content: 'New update request on StealthMark.io',
        title: 'Update request',
        color: 38479,
        fields: [{ name: 'Email', value: email }],
      },
    });

    if (!delivery.delivered) return undeliveredResponse(delivery);

    return NextResponse.json({ success: true, message: 'Your request was received.' });
  } catch (error) {
    console.error('[StealthMark Subscribe] Unexpected error:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'An unexpected error occurred while processing your request.' }, { status: 500 });
  }
}
