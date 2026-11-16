import { vi } from 'vitest';

// Tests never query a real resolver: a name that does not exist takes seconds to fail and times the test out in CI.
// Every name is unresolvable unless a test mocks the lookup itself.
vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  const notFound = async (hostname: string): Promise<never> => {
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND', hostname });
  };
  const isolated = { ...actual, lookup: notFound, resolve4: notFound };
  return { ...isolated, default: isolated };
});
