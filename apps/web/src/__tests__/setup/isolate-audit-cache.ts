import { vi } from 'vitest';
import type { MakeDirectoryOptions, Mode, PathLike, PathOrFileDescriptor, WriteFileOptions } from 'node:fs';

// scan/audit caches gateway reports in this directory; tests must neither read nor overwrite the real cache.
const AUDIT_CACHE_DIR = '/tmp/stealthmark_audit_cache_v2';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const inAuditCache = (target: PathLike | PathOrFileDescriptor) => String(target).startsWith(AUDIT_CACHE_DIR);
  const existsSync: typeof actual.existsSync = (target: PathLike) => !inAuditCache(target) && actual.existsSync(target);
  const mkdirSync: typeof actual.mkdirSync = (target: PathLike, options?: Mode | MakeDirectoryOptions | null) =>
    inAuditCache(target) ? undefined : actual.mkdirSync(target, options);
  const writeFileSync: typeof actual.writeFileSync = (
    target: PathOrFileDescriptor,
    data: string | NodeJS.ArrayBufferView,
    options?: WriteFileOptions,
  ) => {
    if (!inAuditCache(target)) actual.writeFileSync(target, data, options);
  };
  const isolated = { ...actual, existsSync, mkdirSync, writeFileSync };
  return { ...isolated, default: isolated };
});
