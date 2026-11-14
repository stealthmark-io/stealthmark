import tls, { type DetailedPeerCertificate } from 'node:tls';
import { resolveDomainIp } from './network-guard';

export interface CertSummary {
  subject: string;
  keyType: 'rsa' | 'ec' | 'other';
  bits: number | null;
  validTo: number;
  hasOcspUrl: boolean;
  hasEmbeddedSct: boolean;
}

export interface TlsObservation {
  leaf: CertSummary;
  /** Certificates the server sent after the leaf. */
  chain: CertSummary[];
  ocspStapled: boolean;
}

export type TlsProbeResult = { kind: 'ok'; observation: TlsObservation } | { kind: 'no_host' } | { kind: 'error' };

const TLS_TIMEOUT_MS = 4000;

// DER encoding of OID 1.3.6.1.4.1.11129.2.4.2, the embedded SCT list extension (RFC 6962 §3.3).
const SCT_LIST_OID = Buffer.from([0x06, 0x0a, 0x2b, 0x06, 0x01, 0x04, 0x01, 0xd6, 0x79, 0x02, 0x04, 0x02]);

function summarize(cert: DetailedPeerCertificate): CertSummary {
  const keyType = cert.modulus ? 'rsa' : cert.asn1Curve || cert.nistCurve ? 'ec' : 'other';
  const ocsp = cert.infoAccess?.['OCSP - URI'];
  return {
    subject: [cert.subject?.CN, cert.subject?.O].flat().find((name) => typeof name === 'string' && name !== '') ?? 'unnamed certificate',
    keyType,
    bits: typeof cert.bits === 'number' ? cert.bits : null,
    validTo: Date.parse(cert.valid_to),
    hasOcspUrl: Array.isArray(ocsp) && ocsp.length > 0,
    hasEmbeddedSct: Buffer.isBuffer(cert.raw) && cert.raw.includes(SCT_LIST_OID),
  };
}

/** The certificates after the leaf, stopping at a self-issued root or a loop. */
function chainAfterLeaf(leaf: DetailedPeerCertificate): CertSummary[] {
  const out: CertSummary[] = [];
  const seen = new Set<string>(leaf.fingerprint256 ? [leaf.fingerprint256] : []);
  let cert = leaf.issuerCertificate;
  while (cert && cert.fingerprint256 && !seen.has(cert.fingerprint256)) {
    seen.add(cert.fingerprint256);
    out.push(summarize(cert));
    cert = cert.issuerCertificate;
  }
  return out;
}

/**
 * One TLS handshake with the host's public IPv4 address, pinned after the address check so a rebinding name cannot
 * redirect it. Reads the presented chain and whether an OCSP response was stapled; sends no application data.
 */
export async function probeTls(host: string): Promise<TlsProbeResult> {
  let ip: string | null;
  try {
    ip = await resolveDomainIp(host);
  } catch {
    return { kind: 'error' };
  }
  if (!ip) return { kind: 'no_host' };
  const address = ip;

  return new Promise<TlsProbeResult>((resolve) => {
    let stapled = false;
    // tls.connect forwards requestOCSP to the TLSSocket it creates; @types/node only declares it on TLSSocketOptions.
    const options: tls.ConnectionOptions & tls.TLSSocketOptions = {
      host: address,
      port: 443,
      servername: host,
      requestOCSP: true,
      rejectUnauthorized: false,
      timeout: TLS_TIMEOUT_MS,
    };
    const socket = tls.connect(options);
    // `timeout` above only fires on an idle socket; this bounds a server that trickles bytes.
    const deadline = setTimeout(() => finish({ kind: 'error' }), TLS_TIMEOUT_MS);
    const finish = (result: TlsProbeResult) => {
      clearTimeout(deadline);
      socket.destroy();
      resolve(result);
    };
    socket.once('OCSPResponse', (response: Buffer | null) => {
      stapled = Buffer.isBuffer(response) && response.length > 0;
    });
    socket.once('secureConnect', () => {
      const leaf = socket.getPeerCertificate(true);
      if (!leaf || !leaf.raw) return finish({ kind: 'error' });
      finish({ kind: 'ok', observation: { leaf: summarize(leaf), chain: chainAfterLeaf(leaf), ocspStapled: stapled } });
    });
    socket.once('timeout', () => finish({ kind: 'error' }));
    socket.once('error', () => finish({ kind: 'error' }));
  });
}
