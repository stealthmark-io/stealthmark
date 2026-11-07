import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') || '';

  return NextResponse.json({
    status: 'ok',
    query: q,
    results: [
      { id: '1', title: 'Getting Started with StealthMark', url: '/docs/quickstart' },
      { id: '2', title: 'Agent Manifest Schema (RFC-8288)', url: '/docs/spec' },
      { id: '3', title: 'DEFCON Security Perimeters', url: '/docs/defcon' },
    ],
  });
}
