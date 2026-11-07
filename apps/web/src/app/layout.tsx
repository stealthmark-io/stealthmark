import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import Script from 'next/script';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/components/ui/toast';
import { FloatingDonateButton } from '@/components/scan/FloatingDonateButton';
import { LanguageProvider } from '@/context/LanguageContext';
import { ORGANIZATION_JSON_LD } from '@/lib/site';
import { FIX_PACK } from '@/lib/offer';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const viewport: Viewport = {
  themeColor: '#09090b',
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL('https://stealthmark.io'),
  title: 'StealthMark v2.0 — 60-Point Passive Cybersecurity, Anti-AiTM & Client RASP Engine',
  description:
    'Audit any public domain across 60 passive cybersecurity, TLS/DNS, Anti-AiTM, Client-Side RASP, exposed JS bundle secret, runtime CVE (CVE-2026-111497), and OWASP Top 10:2025 checks in seconds.',
  keywords: [
    'external attack surface management',
    'passive domain security scanner',
    'OWASP Top 10 2025 audit',
    'CSP nonce Next.js middleware',
    'Cloudflare WAF rules generator',
    'Google Cloud Armor JA4 rules',
    'JS bundle secret scanner',
    'CVE-2026-111497 Brotli protection',
  ],
  authors: [{ name: 'StealthMark Security Team', url: 'https://stealthmark.io' }],
  creator: 'StealthMark',
  publisher: 'StealthMark',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://stealthmark.io',
    title: 'StealthMark v2.0 — Stop AI Phishing, Session Hijacking & Edge Exploits in 60s',
    description:
      `Run a free 60-point passive cybersecurity & OWASP Top 10:2025 audit on any domain in seconds. The ${FIX_PACK.label} (Cloudflare Worker v2 with JA4 Binding, Client RASP & CSP nonce remediation) is ${FIX_PACK.starterPriceLabel} one-time per domain.`,
    siteName: 'StealthMark',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'StealthMark v2.0 — 60-Point Passive Cybersecurity & Active RASP Shield',
    description:
      'Audit any domain across 60 passive TLS/DNS, Anti-AiTM, Shodan InternetDB CVE, exposed JS secret, and OWASP Top 10:2025 controls in seconds.',
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon.png', sizes: '192x192', type: 'image/png' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    shortcut: '/icon.png',
    apple: '/apple-icon.png',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  // Reading the request headers renders every page per request, so each one carries its own CSP nonce.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} dark`}>
      <body className="bg-[#060709] text-slate-100 font-sans min-h-screen antialiased selection:bg-cyan-500/30 selection:text-white">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD).replace(/</g, '\\u003c') }}
        />
        <AuthProvider>
          <LanguageProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </LanguageProvider>
        </AuthProvider>
        <FloatingDonateButton />
        <Analytics />
        <SpeedInsights />
        {gaId && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
              strategy="afterInteractive"
              nonce={nonce}
            />
            {/* Hall of Fame confirm and remove links carry a token in the query, and a Fix Pack checkout returns to /scan
                with a checkout_id that unlocks the pack: GA gets those URLs, as the page or as the referrer, without them.
                Other pages keep GA's defaults. */}
            <Script id="google-analytics" strategy="afterInteractive" nonce={nonce}>
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                function scrubUrl(href) {
                  var url = new URL(href);
                  if (url.origin !== location.origin) return href;
                  if (url.pathname.indexOf('/leaderboard/') === 0) url.search = '';
                  ['checkout_id', 'session_id'].forEach(function (name) {
                    if (url.searchParams.has(name)) url.searchParams.delete(name);
                  });
                  return url.href;
                }
                var gaParams = {};
                var pageLocation = scrubUrl(location.href);
                if (pageLocation !== location.href) gaParams.page_location = pageLocation;
                var pageReferrer = document.referrer && scrubUrl(document.referrer);
                if (pageReferrer !== document.referrer) gaParams.page_referrer = pageReferrer;
                gtag('config', '${gaId}', gaParams);
              `}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
