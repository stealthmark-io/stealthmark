import { NextResponse } from 'next/server';
import { withStealthMark } from '@stealthmark/next';

export default withStealthMark(() => NextResponse.next(), {
  siteName: 'Next.js Agent Starter',
  origin: 'https://example.com',
  capabilities: [
    {
      id: 'search',
      endpoint: '/api/search',
      method: 'GET',
      description: 'Semantic query engine for product capabilities and docs',
    },
    {
      id: 'checkout',
      endpoint: '/api/checkout',
      method: 'POST',
      description: 'Provisional cart checkout; agents should ask for human approval first',
      hitl: true,
    },
  ],
});

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
