import Link from 'next/link';
import { BarChart3, CheckCircle2, ShieldCheck, Trophy, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { HallOfFameClaimForm } from '@/components/leaderboard/HallOfFameClaimForm';
import { HALL_OF_FAME_FRESH_DAYS, HALL_OF_FAME_MAX_ROWS, listHallOfFame, type HallOfFameEntry } from '@/lib/hall-of-fame';
import { latestPublicIndexEdition, type PublicIndexEdition } from '@/lib/public-index';
import { sanitizeAndValidateDomain } from '@/lib/security/network-guard';

const AUDITOR_USER_AGENT = 'StealthMarkAuditor/2.0 (+https://stealthmark.io/docs)';

const RULES: readonly string[] = [
  'Opt-in only. A domain appears after a fresh audit grades it A or A+ and someone with a mailbox at that domain confirms the listing.',
  'No domain below A is ever named, here or anywhere else on StealthMark.',
  'Nobody pays to be listed, to rank higher or to be removed.',
  `Each entry drops off ${HALL_OF_FAME_FRESH_DAYS} days after its audit. Claim again with a new audit to stay listed.`,
  'The removal link in the latest confirmation email takes the domain off the list at any time. You can also write to security@stealthmark.io from an address at the domain.',
];

const INDEX_RULES: readonly string[] = [
  'Published as dated editions over a named list of domains. Each edition names the list and publishes the sha256 of the domains that returned a report, never the domains.',
  'Only passive hygiene checks are counted: HTTPS, HSTS, TLS trust, CAA, SPF, DMARC, security headers, robots.txt and AI-surface files.',
  'Open ports, CVEs, exposed files, leaked secrets and source maps are never aggregated: even a count is a map of where to look.',
  'Editions are never rewritten. A correction ships as a new edition.',
];

type Search = { domain?: string | string[]; listed?: string | string[]; claim?: string | string[]; removed?: string | string[] };

const one = (value: string | string[] | undefined): string | undefined => (typeof value === 'string' ? value : undefined);

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5 text-sm text-slate-300 leading-relaxed">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function SectionHeading({ icon, title, lead }: { icon: React.ReactNode; title: string; lead?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5 text-white">
        <span className="text-cyan-400">{icon}</span>
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">{title}</h2>
      </div>
      {lead && <p className="text-sm text-slate-400 leading-relaxed max-w-3xl">{lead}</p>}
    </div>
  );
}

function StatusBanner({ search, entries }: { search: Search; entries: HallOfFameEntry[] | null }) {
  const listed = one(search.listed);
  const claim = one(search.claim);
  const removed = one(search.removed);
  // Only a domain that is actually on the list is echoed back, so a crafted link cannot announce a fake listing.
  if (listed && entries?.some((entry) => entry.domain === listed)) {
    return <Notice tone="ok">{listed} is now in the Hall of Fame.</Notice>;
  }
  if (listed) {
    return (
      <Notice tone="ok">
        Confirmation received. The list shows the top {HALL_OF_FAME_MAX_ROWS} audits of the last {HALL_OF_FAME_FRESH_DAYS} days by score.
      </Notice>
    );
  }
  if (claim === 'expired') return <Notice tone="error">That confirmation link expired. Claim the spot again to get a new one.</Notice>;
  if (claim === 'removed') {
    return (
      <Notice tone="error">
        Nothing was listed: the domain was taken off the Hall of Fame after this confirmation link was sent. Claim the spot again to list
        it with a new audit.
      </Notice>
    );
  }
  if (claim === 'error') return <Notice tone="error">The listing could not be saved. Try the link again, or claim the spot again.</Notice>;
  if (removed === '1') return <Notice tone="ok">The listing was removed.</Notice>;
  if (removed === 'superseded') {
    return (
      <Notice tone="error">
        Nothing was removed: a newer claim for this domain was confirmed after this removal link was sent. Use the removal link in that
        claim&apos;s email. If you do not have that email, write to security@stealthmark.io from an address at the domain.
      </Notice>
    );
  }
  if (removed === 'error') return <Notice tone="error">The listing could not be removed. Write to security@stealthmark.io.</Notice>;
  return null;
}

function Notice({ tone, children }: { tone: 'ok' | 'error'; children: React.ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${
        tone === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
      }`}
    >
      {tone === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />}
      <span>{children}</span>
    </div>
  );
}

function HallOfFameTable({ entries }: { entries: HallOfFameEntry[] | null }) {
  if (entries === null) {
    return <p className="text-sm text-slate-400">The Hall of Fame opens soon. Run a scan now: an A or A+ today is what qualifies.</p>;
  }
  if (entries.length === 0) {
    return <p className="text-sm text-slate-400">No domain is listed yet. A fresh A or A+ audit and one confirmation email put yours first.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] font-mono uppercase tracking-wider text-slate-500 border-b border-white/10">
            <th scope="col" className="py-2 pr-3">#</th>
            <th scope="col" className="py-2 pr-3">Domain</th>
            <th scope="col" className="py-2 pr-3">Grade</th>
            <th scope="col" className="py-2 pr-3">AI-Phishing &amp; Session Hijack Resistance</th>
            <th scope="col" className="py-2 pr-3">Score</th>
            <th scope="col" className="py-2">Certificate</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr key={entry.domain} className="border-b border-white/5">
              <td className="py-2.5 pr-3 font-mono text-slate-500">{index + 1}</td>
              <td className="py-2.5 pr-3 font-mono text-white break-all">{entry.domain}</td>
              <td className="py-2.5 pr-3">
                <Badge variant="success">{entry.grade}</Badge>
              </td>
              <td className="py-2.5 pr-3">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-mono text-emerald-300">
                  <span>🛡️ Active Shield Protected</span>
                </span>
              </td>
              <td className="py-2.5 pr-3 font-mono text-slate-300">{entry.score}</td>
              <td className="py-2.5 font-mono text-xs">
                <Link
                  href={`/verify/${encodeURIComponent(entry.domain)}`}
                  className="text-cyan-400 hover:text-cyan-300 underline"
                >
                  Verify Live →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const percent = (count: number, total: number) => `${Math.round((count * 100) / total)}%`;

function PublicIndexTable({ edition }: { edition: PublicIndexEdition }) {
  const total = edition.domains_scanned;
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2 text-sm">
        <div>
          <dt className="text-[11px] font-mono uppercase tracking-wider text-slate-500">Edition</dt>
          <dd className="text-white font-mono">
            {edition.edition} · generated {edition.generated_at.slice(0, 10)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-mono uppercase tracking-wider text-slate-500">Domains</dt>
          <dd className="text-white font-mono">
            {edition.domains_scanned} audited of {edition.domains_requested} listed
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-mono uppercase tracking-wider text-slate-500">Source list</dt>
          <dd className="text-slate-300">
            <a href={edition.source.url} rel="nofollow noopener noreferrer" target="_blank" className="text-cyan-300 hover:text-cyan-200 underline">
              {edition.source.name}
            </a>
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-mono uppercase tracking-wider text-slate-500">sha256 of the audited domains</dt>
          <dd className="text-slate-300 font-mono text-xs break-all">{edition.source.list_sha256}</dd>
          <dd className="text-slate-500 text-xs pt-1">Lowercase, sorted, one per line, no trailing newline.</dd>
        </div>
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-mono uppercase tracking-wider text-slate-500 border-b border-white/10">
              <th scope="col" className="py-2 pr-3">Check</th>
              <th scope="col" className="py-2 pr-3">Pass</th>
              <th scope="col" className="py-2 pr-3">Warn</th>
              <th scope="col" className="py-2 pr-3">Fail</th>
              <th scope="col" className="py-2">Other</th>
            </tr>
          </thead>
          <tbody>
            {edition.checks.map((check) => (
              <tr key={check.id} className="border-b border-white/5">
                <td className="py-2.5 pr-3 text-slate-200">{check.label}</td>
                <td className="py-2.5 pr-3 font-mono text-emerald-300">{percent(check.pass, total)}</td>
                <td className="py-2.5 pr-3 font-mono text-amber-300">{percent(check.warn, total)}</td>
                <td className="py-2.5 pr-3 font-mono text-rose-300">{percent(check.fail, total)}</td>
                <td className="py-2.5 font-mono text-slate-400">
                  {percent(check.info + check.error + check.not_assessed + check.missing, total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 font-mono">Auditor: {edition.auditor}</p>
    </div>
  );
}

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const entries = await listHallOfFame();
  const edition = latestPublicIndexEdition();
  const requested = one(search.domain);
  const initialDomain = requested ? (sanitizeAndValidateDomain(requested) ?? '') : '';

  return (
    <div className="min-h-screen bg-[#060709] text-slate-100 flex flex-col selection:bg-cyan-500/30 selection:text-cyan-200">
      <Navbar />

      <main className="flex-1 pt-32 pb-24 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto w-full space-y-16">
        <section className="space-y-5 max-w-3xl">
          <Badge variant="info" size="md">
            <Trophy className="w-3.5 h-3.5" aria-hidden />
            Hall of Fame
          </Badge>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white">
            Sites that earned an A, and chose to say so.
          </h1>
          <p className="text-base text-slate-400 leading-relaxed">
            Every domain below passed a fresh, passive StealthMark audit with grade A or A+ and was confirmed from a mailbox at that domain.
            The Public Index further down counts how common each check is across a named list, without naming anyone.
          </p>
          <StatusBanner search={search} entries={entries} />
          <div className="flex flex-wrap gap-3 pt-1">
            <Link href="/scan">
              <Button variant="primary" size="md">Scan your domain</Button>
            </Link>
            <Link href="#claim">
              <Button variant="outline" size="md">Claim your spot</Button>
            </Link>
          </div>
        </section>

        <section className="space-y-6">
          <SectionHeading
            icon={<Trophy className="w-5 h-5" aria-hidden />}
            title="Hall of Fame"
            lead={`Best score first, then the earliest confirmation. Audits older than ${HALL_OF_FAME_FRESH_DAYS} days drop off.`}
          />
          <Card variant="default" hoverEffect="none" className="p-6">
            <HallOfFameTable entries={entries} />
          </Card>
        </section>

        <section id="claim" className="space-y-6 scroll-mt-28">
          <SectionHeading
            icon={<ShieldCheck className="w-5 h-5" aria-hidden />}
            title="Claim your spot"
            lead="We run a fresh audit now. At A or A+, we email a confirmation link to the address you enter, which must be security@, webmaster@, hostmaster@, postmaster@ or admin@ at the domain itself. Nothing is published until you confirm."
          />
          <Card variant="default" hoverEffect="none" className="p-6">
            <HallOfFameClaimForm initialDomain={initialDomain} />
          </Card>
        </section>

        <section className="space-y-6">
          <SectionHeading
            icon={<BarChart3 className="w-5 h-5" aria-hidden />}
            title="Public Index"
            lead="How common each passive check is across a named list of domains, as a share of the domains audited."
          />
          <Card variant="default" hoverEffect="none" className="p-6">
            {edition ? (
              <PublicIndexTable edition={edition} />
            ) : (
              <p className="text-sm text-slate-400">
                The first edition is pending. It will name its source list, its date and the sha256 of the domains that returned a report.
              </p>
            )}
          </Card>
        </section>

        <section className="space-y-6">
          <SectionHeading icon={<ShieldCheck className="w-5 h-5" aria-hidden />} title="Rules" />
          <div className="grid gap-5 md:grid-cols-2">
            <Card variant="default" hoverEffect="none" className="p-6 space-y-4">
              <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-emerald-300">Hall of Fame</h3>
              <Bullets items={RULES} />
            </Card>
            <Card variant="default" hoverEffect="none" className="p-6 space-y-4">
              <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-cyan-300">Public Index</h3>
              <Bullets items={INDEX_RULES} />
            </Card>
          </div>
          <p id="how-audits-run" className="text-xs text-slate-500 font-mono leading-relaxed scroll-mt-28">
            Audits identify themselves as {AUDITOR_USER_AGENT} and send GET requests only: the home page, robots.txt, sitemap.xml and the
            AI-surface files; a fixed list of paths that should never be public (/.env, /.git/HEAD, /.git/config, /.npmrc, package and
            lock files, /openapi.json, /swagger.json); the site&apos;s JavaScript bundles and their source maps; the home page once with a
            foreign Origin header; and one random path with forged X-Forwarded-Host and X-Forwarded-Scheme headers. They read DNS records
            and the TLS certificate, and take open ports from Shodan InternetDB instead of scanning them.
          </p>
        </section>
      </main>

      <Footer />
    </div>
  );
}
