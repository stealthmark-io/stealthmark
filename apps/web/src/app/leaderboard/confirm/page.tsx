import type { Metadata } from 'next';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { verifyHallOfFameClaimToken } from '@/lib/hall-of-fame';

export const metadata: Metadata = {
  title: 'Confirm your Hall of Fame listing | StealthMark',
  robots: { index: false, follow: false },
  // The token rides in the query; no request from this page carries it on as a Referer.
  referrer: 'no-referrer',
};

// Publishing happens on the POST below, never on this GET: mail scanners open links in emails.
export default async function ConfirmHallOfFamePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const value = typeof token === 'string' ? token : null;
  const check = verifyHallOfFameClaimToken(value);

  return (
    <div className="min-h-screen bg-[#060709] text-slate-100 flex flex-col">
      <Navbar />
      <main className="flex-1 pt-32 pb-24 px-4 sm:px-6 max-w-xl mx-auto w-full">
        <Card variant="default" hoverEffect="none" className="p-6 space-y-4">
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <Trophy className="w-5 h-5 text-cyan-400" aria-hidden /> Hall of Fame listing
          </h1>
          {check.status === 'valid' ? (
            <>
              <p className="text-sm text-slate-300 leading-relaxed">
                List <span className="font-mono text-white">{check.claim.domain}</span> with grade{' '}
                <span className="font-bold text-emerald-300">{check.claim.grade}</span> ({check.claim.score}/100), from the audit of{' '}
                {check.claim.audited_at.slice(0, 10)}. The entry drops off 90 days after that audit. The removal link in the same email
                takes it off at any time, until a newer claim for the domain is confirmed.
              </p>
              <form method="post" action="/api/leaderboard/confirm">
                <input type="hidden" name="token" value={value ?? ''} />
                <Button type="submit" variant="primary" size="md">
                  Confirm the listing
                </Button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-300 leading-relaxed">
                {check.status === 'expired'
                  ? 'This confirmation link expired: links are valid for 24 hours. Claim the spot again to get a new one.'
                  : 'This confirmation link is not valid. Copy the whole link from the email, or claim the spot again.'}
              </p>
              <Link href="/leaderboard#claim">
                <Button variant="outline" size="md">Back to the Hall of Fame</Button>
              </Link>
            </>
          )}
        </Card>
      </main>
      <Footer />
    </div>
  );
}
