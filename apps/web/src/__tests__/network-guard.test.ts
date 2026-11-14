import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({ default: { lookup, resolve4: vi.fn() } }));

import { extractOriginIpFromSpf, readBoundedText, resolvesToPublicAddressesOnly } from '../lib/security/network-guard';

const v4 = (address: string) => ({ address, family: 4 });
const v6 = (address: string) => ({ address, family: 6 });

describe('resolvesToPublicAddressesOnly', () => {
  beforeEach(() => {
    lookup.mockReset();
  });

  it.each([
    ['a public IPv4 address', [v4('93.184.216.34')]],
    ['a global unicast IPv6 address', [v6('2606:4700::1')]],
    ['public IPv4 and IPv6 together', [v4('93.184.216.34'), v6('2606:4700::1')]],
  ])('accepts %s', async (_label, addresses) => {
    lookup.mockResolvedValue(addresses);
    expect(await resolvesToPublicAddressesOnly('acme.io')).toBe(true);
  });

  it.each([
    ['loopback', [v4('127.0.0.1')]],
    ['RFC 1918', [v4('10.0.0.5')]],
    ['cloud metadata', [v4('169.254.169.254')]],
    ['CGNAT', [v4('100.64.0.1')]],
    ['TEST-NET-1', [v4('192.0.2.10')]],
    ['benchmarking', [v4('198.19.255.1')]],
    ['TEST-NET-2', [v4('198.51.100.7')]],
    ['TEST-NET-3', [v4('203.0.113.9')]],
    ['IPv6 loopback', [v6('::1')]],
    ['IPv4-mapped loopback', [v6('::ffff:127.0.0.1')]],
    ['NAT64 to loopback', [v6('64:ff9b::7f00:1')]],
    ['unique local IPv6', [v6('fd00::1')]],
    ['link-local IPv6', [v6('fe80::1')]],
    ['IPv6 documentation', [v6('2001:db8::1')]],
    ['6to4', [v6('2002:7f00:1::1')]],
    ['a public address next to a private one', [v4('93.184.216.34'), v4('10.0.0.5')]],
    ['no addresses', []],
  ])('rejects %s', async (_label, addresses) => {
    lookup.mockResolvedValue(addresses);
    expect(await resolvesToPublicAddressesOnly('acme.io')).toBe(false);
  });

  it('rejects a host that does not resolve', async () => {
    lookup.mockRejectedValue(new Error('ENOTFOUND'));
    expect(await resolvesToPublicAddressesOnly('missing.acme.io')).toBe(false);
  });

  it('asks for every address of the host', async () => {
    lookup.mockResolvedValue([v4('93.184.216.34')]);
    await resolvesToPublicAddressesOnly('acme.io');
    expect(lookup).toHaveBeenCalledWith('acme.io', expect.objectContaining({ all: true }));
  });
});

describe('extractOriginIpFromSpf', () => {
  it('skips documentation and benchmarking ranges and returns the first public address', () => {
    expect(extractOriginIpFromSpf('v=spf1 ip4:203.0.113.9 ip4:198.18.0.1 ip4:93.184.216.34 -all')).toBe('93.184.216.34');
  });
});

describe('readBoundedText', () => {
  const streamOf = (parts: string[], failAfter = false) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
          if (failAfter) controller.error(new Error('connection reset'));
          else controller.close();
        },
      }),
    );

  it('returns a body that fits as complete', async () => {
    await expect(readBoundedText(streamOf(['{"data":', '[]}']), 64)).resolves.toEqual({ text: '{"data":[]}', complete: true });
  });

  it('marks a body cut at the cap as incomplete', async () => {
    await expect(readBoundedText(streamOf(['abcdef', 'ghij']), 8)).resolves.toEqual({ text: 'abcdefgh', complete: false });
  });

  it('marks a body that broke off mid-read as incomplete', async () => {
    await expect(readBoundedText(streamOf(['abc'], true), 64)).resolves.toMatchObject({ complete: false });
  });
});
