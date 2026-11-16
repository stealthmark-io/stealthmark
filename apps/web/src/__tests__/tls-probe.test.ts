import { EventEmitter } from 'node:events';
import type { ConnectionOptions, DetailedPeerCertificate } from 'node:tls';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dns = vi.hoisted(() => ({ ip: '203.0.113.7' as string | null }));
vi.mock('../lib/security/network-guard', () => ({ resolveDomainIp: async () => dns.ip }));

type Script = (socket: FakeSocket) => void;
const tlsState = vi.hoisted(() => ({ script: null as Script | null, options: null as ConnectionOptions | null }));

class FakeSocket extends EventEmitter {
  peer: DetailedPeerCertificate | null = null;
  destroyed = false;
  getPeerCertificate() {
    return this.peer;
  }
  destroy() {
    this.destroyed = true;
  }
}

vi.mock('node:tls', () => {
  const connect = (options: ConnectionOptions) => {
    tlsState.options = options;
    const socket = new FakeSocket();
    queueMicrotask(() => tlsState.script?.(socket));
    return socket;
  };
  return { default: { connect }, connect };
});

import { probeTls } from '../lib/security/tls-probe';

const SCT_OID = Buffer.from([0x06, 0x0a, 0x2b, 0x06, 0x01, 0x04, 0x01, 0xd6, 0x79, 0x02, 0x04, 0x02]);

function fakeCert(overrides: Partial<DetailedPeerCertificate>): DetailedPeerCertificate {
  const base = {
    subject: { CN: 'acme.io' },
    valid_to: 'Jan  1 00:00:00 2099 GMT',
    raw: Buffer.from([0x30, 0x00]),
    fingerprint256: 'leaf',
    infoAccess: undefined,
    bits: 256,
    asn1Curve: 'prime256v1',
    nistCurve: 'P-256',
  };
  return { ...base, ...overrides } as unknown as DetailedPeerCertificate;
}

describe('probeTls', () => {
  beforeEach(() => {
    dns.ip = '203.0.113.7';
    tlsState.script = null;
    tlsState.options = null;
  });

  it('connects to the checked address with the original name as SNI and reads the chain, SCT and stapled OCSP', async () => {
    const root = fakeCert({ subject: { CN: 'Root CA' } as DetailedPeerCertificate['subject'], fingerprint256: 'root', modulus: 'AB', bits: 4096, asn1Curve: undefined, nistCurve: undefined });
    root.issuerCertificate = root;
    const leaf = fakeCert({
      raw: Buffer.concat([Buffer.from([0x30, 0x82]), SCT_OID]),
      infoAccess: { 'OCSP - URI': ['http://ocsp.example'] } as DetailedPeerCertificate['infoAccess'],
      issuerCertificate: root,
    });
    tlsState.script = (socket) => {
      socket.peer = leaf;
      socket.emit('OCSPResponse', Buffer.from([1]));
      socket.emit('secureConnect');
    };
    const result = await probeTls('acme.io');
    expect(tlsState.options).toMatchObject({ host: '203.0.113.7', port: 443, servername: 'acme.io', requestOCSP: true });
    expect(result).toEqual({
      kind: 'ok',
      observation: {
        leaf: { subject: 'acme.io', keyType: 'ec', bits: 256, validTo: Date.parse('Jan  1 00:00:00 2099 GMT'), hasOcspUrl: true, hasEmbeddedSct: true },
        chain: [{ subject: 'Root CA', keyType: 'rsa', bits: 4096, validTo: Date.parse('Jan  1 00:00:00 2099 GMT'), hasOcspUrl: false, hasEmbeddedSct: false }],
        ocspStapled: true,
      },
    });
  });

  it('reports no stapled response and no SCT when the server sends neither', async () => {
    tlsState.script = (socket) => {
      socket.peer = fakeCert({});
      socket.emit('secureConnect');
    };
    const result = await probeTls('acme.io');
    expect(result.kind === 'ok' && result.observation).toMatchObject({ ocspStapled: false, chain: [], leaf: { hasEmbeddedSct: false, hasOcspUrl: false } });
  });

  it('reports no_host without connecting when the name does not resolve', async () => {
    dns.ip = null;
    expect(await probeTls('gone.acme.io')).toEqual({ kind: 'no_host' });
    expect(tlsState.options).toBeNull();
  });

  it('handles a null OCSPResponse event emitted by Node when the server does not staple', async () => {
    tlsState.script = (socket) => {
      socket.peer = fakeCert({});
      socket.emit('OCSPResponse', null);
      socket.emit('secureConnect');
    };
    const result = await probeTls('acme.io');
    expect(result.kind === 'ok' && result.observation).toMatchObject({ ocspStapled: false });
  });

  it.each(['error', 'timeout'])('reports an error and closes the socket on %s', async (event) => {
    let opened: FakeSocket | null = null;
    tlsState.script = (socket) => {
      opened = socket;
      socket.emit(event, new Error('boom'));
    };
    expect(await probeTls('acme.io')).toEqual({ kind: 'error' });
    expect(opened).not.toBeNull();
    expect(opened!.destroyed).toBe(true);
  });
});
