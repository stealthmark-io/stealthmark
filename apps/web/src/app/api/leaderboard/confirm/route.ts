import { NextResponse } from 'next/server';
import { readTokenForm, saveHallOfFameEntry, verifyHallOfFameClaimToken } from '@/lib/hall-of-fame';
import { SITE_ORIGIN } from '@/lib/site';

const back = (query: string) => NextResponse.redirect(new URL(`/leaderboard?${query}`, SITE_ORIGIN), 303);

/** The confirm page posts here, so a mail scanner that prefetches the emailed link never publishes anything. */
export async function POST(request: Request) {
  const form = await readTokenForm(request);
  const token = form?.get('token');
  const check = verifyHallOfFameClaimToken(typeof token === 'string' ? token : null);
  if (check.status !== 'valid') return back(`claim=${check.status === 'expired' ? 'expired' : 'error'}`);
  const status = await saveHallOfFameEntry(check.claim);
  if (status === 'listed') return back(`listed=${encodeURIComponent(check.claim.domain)}`);
  return back(status === 'removed' ? 'claim=removed' : 'claim=error');
}
