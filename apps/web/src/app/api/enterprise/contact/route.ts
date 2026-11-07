import { randomInt } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  deliverLead,
  enforceRateLimit,
  honeypotResponse,
  isHoneypotTripped,
  isValidEmail,
  limitList,
  limitText,
  readJsonObject,
  singleLine,
  undeliveredResponse,
} from '@/lib/lead-intake';

export interface EnterpriseLeadPayload {
  name: string;
  email: string;
  company: string;
  website?: string;
  companySize?: string;
  trafficVolume?: string;
  objectives?: string[];
  cdnProvider?: string;
  message?: string;
}

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const limited = enforceRateLimit(request, 'enterprise-contact', RATE_LIMIT, RATE_WINDOW_MS);
    if (limited) return limited;

    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const { body } = parsed;
    if (isHoneypotTripped(body)) return honeypotResponse();

    const name = limitText(body.name, 120);
    if (name.length < 2) {
      return NextResponse.json({ error: 'Please provide your full name.' }, { status: 400 });
    }

    const email = limitText(body.email, 254);
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Please provide a valid work email address.' }, { status: 400 });
    }

    const company = limitText(body.company, 160);
    if (company.length < 2) {
      return NextResponse.json({ error: 'Please provide your company or organization name.' }, { status: 400 });
    }

    const website = limitText(body.website, 300);
    const companySize = limitText(body.companySize, 60) || 'Unspecified';
    const trafficVolume = limitText(body.trafficVolume, 80) || 'Unspecified';
    const cdnProvider = limitText(body.cdnProvider, 80) || 'Unspecified';
    const objectives = limitList(body.objectives, 10, 120);
    const message = limitText(body.message, 2000);

    const referenceId = `SM-ENT-${randomInt(100000, 1000000)}`;
    const received = new Date().toISOString();
    const objectivesText = objectives.length > 0 ? objectives.join(', ') : 'General discovery';

    const delivery = await deliverLead({
      subject: `Enterprise inquiry: ${singleLine(company)} (${singleLine(trafficVolume)}) - ${referenceId}`,
      replyTo: email,
      text: [
        `Enterprise inquiry ${referenceId}`,
        `Received: ${received}`,
        '',
        `Name: ${name}`,
        `Email: ${email}`,
        `Company: ${company}`,
        `Website: ${website || 'not provided'}`,
        `Company size: ${companySize}`,
        `Monthly traffic: ${trafficVolume}`,
        `CDN or edge: ${cdnProvider}`,
        `Objectives: ${objectivesText}`,
        '',
        'Message:',
        message || 'none provided',
      ].join('\n'),
      discord: {
        content: `New enterprise inquiry ${referenceId}`,
        title: `${singleLine(company)} - ${singleLine(trafficVolume)}`,
        color: 3447003,
        fields: [
          { name: 'Contact', value: `${singleLine(name)} (${email})` },
          { name: 'Company and website', value: `${singleLine(company)} (${singleLine(website) || 'n/a'})`, inline: true },
          { name: 'Size', value: companySize, inline: true },
          { name: 'Monthly traffic', value: trafficVolume, inline: true },
          { name: 'CDN or edge', value: cdnProvider, inline: true },
          { name: 'Objectives', value: objectivesText },
          { name: 'Message', value: message ? message.slice(0, 300) : 'none provided' },
        ],
      },
    });

    if (!delivery.delivered) return undeliveredResponse(delivery);

    return NextResponse.json({
      success: true,
      referenceId,
      message: 'Your inquiry was received. Keep this reference if you contact us again.',
    });
  } catch (error) {
    console.error('[StealthMark Enterprise API] Unexpected intake error:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json(
      { error: 'An unexpected error occurred while processing your enterprise request.' },
      { status: 500 },
    );
  }
}
