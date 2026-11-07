import { NextResponse } from 'next/server';
import { readTokenForm, removeHallOfFameEntry, verifyHallOfFameRemoveToken } from '@/lib/hall-of-fame';
import { SITE_ORIGIN } from '@/lib/site';

const back = (query: string) => NextResponse.redirect(new URL(`/leaderboard?${query}`, SITE_ORIGIN), 303);

export async function POST(request: Request) {
  const form = await readTokenForm(request);
  const token = form?.get('token');
  const link = verifyHallOfFameRemoveToken(typeof token === 'string' ? token : null);
  if (!link) return back('removed=error');
  const status = await removeHallOfFameEntry(link);
  if (status === 'removed') return back('removed=1');
  return back(status === 'superseded' ? 'removed=superseded' : 'removed=error');
}
