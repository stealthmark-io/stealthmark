/**
 * Contact desks shown on the site. Addresses are copied to the clipboard (project rule: addresses are copied, never linked)
 * and the suggested subject and body give the reader something to paste into their own mail client.
 */

export interface ContactDesk {
  address: string;
  subject: string;
  body: string;
}

export const EMAIL_TEMPLATES: Record<'access' | 'support' | 'security', ContactDesk> = {
  access: {
    address: 'access@stealthmark.io',
    subject: 'StealthMark early access request',
    body: `Hi StealthMark team,

I would like early access for my site.

--- EARLY ACCESS REQUEST ---
Organization: 
Site or domain: 
Runtime: [ Next.js | Express | Fastify | Other ]
Estimated monthly agent events: [ e.g. 10k, 100k, 500k, 2M+ ]
What I want to do: [ See which agents read my site | Set a policy for agents | Other ]
`,
  },
  support: {
    address: 'support@stealthmark.io',
    subject: 'StealthMark support request',
    body: `Hi StealthMark team,

I need help with my StealthMark setup.

--- SUPPORT REQUEST ---
Account email: 
Site or domain: 
Runtime and SDK version: 
What happened: 
What you expected: 
Error output, if any: 
`,
  },
  security: {
    address: 'security@stealthmark.io',
    subject: 'StealthMark security report',
    body: `Hi StealthMark team,

I am reporting a possible security issue.

--- SECURITY REPORT ---
Reporter name or organization: 
Affected component: [ stealthmark.io | Console | API | SDK ]
Description: 
Steps to reproduce: 
Impact: 
`,
  },
};
