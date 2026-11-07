import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  deliverLead,
  enforceRateLimit,
  honeypotResponse,
  isHoneypotTripped,
  isValidEmail,
  limitText,
  readJsonObject,
  singleLine,
  undeliveredResponse,
} from '@/lib/lead-intake';

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function newReference(): string {
  return `SM-VIP-${randomBytes(3).toString('hex').slice(0, 4).toUpperCase()}`;
}

export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit(request, 'waitlist', RATE_LIMIT, RATE_WINDOW_MS);
    if (limited) return limited;

    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    if (isHoneypotTripped(parsed.body)) return honeypotResponse();

    const email = limitText(parsed.body.email, 254);
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Please provide a valid developer email address.' }, { status: 400 });
    }

    const website = limitText(parsed.body.website, 300);
    const useCase = limitText(parsed.body.useCase, 200);
    const expectedTraffic = limitText(parsed.body.expectedTraffic, 100);
    const ticketId = newReference();

    const delivery = await deliverLead({
      subject: `Early access request ${ticketId}`,
      replyTo: email,
      text: [
        `Early access request ${ticketId}`,
        '',
        `Email: ${email}`,
        `Website: ${website || 'not provided'}`,
        `Use case: ${useCase || 'not provided'}`,
        `Expected agent traffic: ${expectedTraffic || 'not provided'}`,
        `Received: ${new Date().toISOString()}`,
      ].join('\n'),
      discord: {
        content: 'New early access request on StealthMark.io',
        title: `Early access request ${ticketId}`,
        fields: [
          { name: 'Operator email', value: email, inline: true },
          { name: 'Reference', value: ticketId, inline: true },
          { name: 'Website', value: singleLine(website) || 'not provided', inline: true },
          { name: 'Use case', value: singleLine(useCase) || 'not provided' },
          { name: 'Expected agent traffic', value: singleLine(expectedTraffic) || 'not provided', inline: true },
        ],
      },
    });

    if (!delivery.delivered) return undeliveredResponse(delivery);

    return NextResponse.json({
      success: true,
      status: 'EARLY_ACCESS_REGISTERED',
      ticket_id: ticketId,
      ticketId,
      consoleUrl: '/console',
      message: 'Your early access request was received.',
      registered_email: email,
      website: website || null,
      use_case: useCase || 'Next.js middleware',
      expected_traffic: expectedTraffic || '< 50,000 agent events/mo',
    });
  } catch (error) {
    console.error('[StealthMark Waitlist] Unexpected error:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'An unexpected error occurred while processing your request.' }, { status: 500 });
  }
}
