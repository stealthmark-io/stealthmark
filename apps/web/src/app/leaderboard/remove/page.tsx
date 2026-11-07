import type { Metadata } from 'next';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { verifyHallOfFameRemoveToken } from '@/lib/hall-of-fame';

export const metadata: Metadata = {
  title: 'Remove a Hall of Fame listing | StealthMark',
  robots: { index: false, follow: false },
  // The token rides in the query; no request from this page carries it on as a Referer.
  referrer: 'no-referrer',
};

export default async function RemoveHallOfFamePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const value = typeof token === 'string' ? token : null;
  const link = verifyHallOfFameRemoveToken(value);

  return (
    <div className="min-h-screen bg-[#060709] text-slate-100 flex flex-col">
      <Navbar />
      <main className="flex-1 pt-32 pb-24 px-4 sm:px-6 max-w-xl mx-auto w-full">
        <Card variant="default" hoverEffect="none" className="p-6 space-y-4">
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <Trophy className="w-5 h-5 text-cyan-400" aria-hidden /> Remove a listing
          </h1>
          {link ? (
            <>
              <p className="text-sm text-slate-300 leading-relaxed">
                Take <span className="font-mono text-white">{link.domain}</span> off the StealthMark Hall of Fame. You can claim it again later
                with a new audit.
              </p>
              <form method="post" action="/api/leaderboard/remove">
                <input type="hidden" name="token" value={value ?? ''} />
                <Button type="submit" variant="danger" size="md">
                  Remove the listing
                </Button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-300 leading-relaxed">
                This removal link is not valid. Copy the whole link from the email, or write to security@stealthmark.io from an address at
                the domain.
              </p>
              <Link href="/leaderboard">
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
