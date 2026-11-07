import publicIndexFile from '@/data/public-index.json';

// apps/web/scripts/public-index.mjs writes the file; this parser is the contract the /leaderboard page relies on.
const SECTIONS = ['transport', 'dns', 'headers', 'crawl_policy', 'ai_surface'] as const;
const COUNT_KEYS = ['pass', 'warn', 'fail', 'info', 'error', 'not_assessed', 'missing'] as const;

type CountKey = (typeof COUNT_KEYS)[number];

export type PublicIndexCheck = {
  id: string;
  section: (typeof SECTIONS)[number];
  label: string;
} & Record<CountKey, number>;

export interface PublicIndexEdition {
  edition: string;
  generated_at: string;
  auditor: string;
  source: { name: string; url: string; list_sha256: string };
  domains_requested: number;
  domains_scanned: number;
  checks: PublicIndexCheck[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;

function parseCheck(raw: unknown, scanned: number): PublicIndexCheck | null {
  if (!isRecord(raw) || !isText(raw.id) || !isText(raw.label)) return null;
  const section = SECTIONS.find((name) => name === raw.section);
  if (!section || !COUNT_KEYS.every((key) => isCount(raw[key]))) return null;
  const counts = Object.fromEntries(COUNT_KEYS.map((key) => [key, raw[key] as number])) as Record<CountKey, number>;
  const total = COUNT_KEYS.reduce((sum, key) => sum + counts[key], 0);
  if (total !== scanned) return null;
  return { id: raw.id, section, label: raw.label, ...counts };
}

function parseEdition(raw: unknown): PublicIndexEdition | null {
  if (!isRecord(raw) || !isRecord(raw.source)) return null;
  const { edition, generated_at, auditor, source, domains_requested, domains_scanned, checks } = raw;
  if (typeof edition !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(edition)) return null;
  if (typeof generated_at !== 'string' || Number.isNaN(Date.parse(generated_at))) return null;
  if (!isText(auditor) || !isText(source.name) || typeof source.url !== 'string' || !/^https:\/\/\S+$/.test(source.url)) return null;
  if (typeof source.list_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(source.list_sha256)) return null;
  if (!isCount(domains_requested) || !isCount(domains_scanned) || domains_scanned === 0 || domains_scanned > domains_requested) return null;
  if (!Array.isArray(checks) || checks.length === 0) return null;
  const parsed = checks.map((check) => parseCheck(check, domains_scanned));
  if (parsed.some((check) => check === null)) return null;
  return {
    edition,
    generated_at,
    auditor,
    source: { name: source.name, url: source.url, list_sha256: source.list_sha256 },
    domains_requested,
    domains_scanned,
    checks: parsed as PublicIndexCheck[],
  };
}

/** Returns the editions oldest first, or null when the file is not a valid schema 1 index. */
export function parsePublicIndex(raw: unknown): PublicIndexEdition[] | null {
  if (!isRecord(raw) || raw.schema !== 1 || !Array.isArray(raw.editions)) return null;
  const editions = raw.editions.map(parseEdition);
  if (editions.some((edition) => edition === null)) return null;
  return (editions as PublicIndexEdition[]).sort((a, b) => a.edition.localeCompare(b.edition));
}

/** The newest published edition, or null while the first one is pending or the file is invalid. */
export function latestPublicIndexEdition(raw: unknown = publicIndexFile): PublicIndexEdition | null {
  return parsePublicIndex(raw)?.at(-1) ?? null;
}
