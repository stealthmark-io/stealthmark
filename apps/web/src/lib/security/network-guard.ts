import net from 'node:net';
import dns from 'node:dns/promises';

// Exact Cloudflare IPv4 ranges
const CLOUDFLARE_CIDRS = [
  { base: '103.21.244.0', mask: 22 },
  { base: '103.22.200.0', mask: 22 },
  { base: '103.31.4.0', mask: 22 },
  { base: '104.16.0.0', mask: 13 }, // 104.16.0.0 - 104.23.255.255
  { base: '104.24.0.0', mask: 14 }, // 104.24.0.0 - 104.27.255.255
  { base: '108.162.192.0', mask: 18 },
  { base: '131.0.72.0', mask: 22 },
  { base: '141.101.64.0', mask: 18 },
  { base: '162.158.0.0', mask: 15 },
  { base: '172.64.0.0', mask: 13 },
  { base: '173.245.48.0', mask: 20 },
  { base: '188.114.96.0', mask: 20 },
  { base: '190.93.240.0', mask: 20 },
  { base: '197.234.240.0', mask: 22 },
  { base: '198.41.128.0', mask: 17 },
];

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

export function isCloudflareIpv4(ip: string): boolean {
  if (net.isIPv4(ip) === false) return false;
  const ipInt = ipv4ToInt(ip);
  return CLOUDFLARE_CIDRS.some(({ base, mask }) => {
    const maskBits = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
    return (ipInt & maskBits) === (ipv4ToInt(base) & maskBits);
  });
}

// Blocks private, loopback, link-local (GCP/AWS Metadata 169.254.169.254) and multicast
export function isPrivateOrReservedIpv4(ip: string): boolean {
  if (!net.isIPv4(ip)) return true;
  const parts = ip.split('.').map(Number);
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // Cloud Metadata SSRF protection
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // Multicast & Reserved
  return false;
}

export function sanitizeAndValidateDomain(rawInput: string): string | null {
  const cleaned = rawInput
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');

  // Only permit valid FQDNs (1 or more dots, ending in 2-24 alpha TLD; rejects IPs, localhost, and single-label names)
  const fqdnRegex = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,24}$/;
  if (!fqdnRegex.test(cleaned) || cleaned.endsWith('.local') || cleaned.endsWith('.internal')) {
    return null;
  }
  return cleaned;
}

export async function resolveDomainIp(domain: string): Promise<string | null> {
  try {
    const records = await dns.resolve4(domain);
    if (records && records.length > 0) {
      if (isPrivateOrReservedIpv4(records[0])) {
        throw new Error('SSRF_BLOCKED_PRIVATE_IP');
      }
      return records[0];
    }
  } catch (err: any) {
    if (err?.message === 'SSRF_BLOCKED_PRIVATE_IP') throw err;
  }

  // Fallback to dns.lookup for CNAMEs (e.g. Shopify, Webflow)
  try {
    const lookup = await dns.lookup(domain, { family: 4 });
    if (lookup && lookup.address) {
      if (isPrivateOrReservedIpv4(lookup.address)) {
        throw new Error('SSRF_BLOCKED_PRIVATE_IP');
      }
      return lookup.address;
    }
  } catch (err: any) {
    if (err?.message === 'SSRF_BLOCKED_PRIVATE_IP') throw err;
  }

  return null;
}

// Memory-capped stream reader: prevents 1GB file downloads from causing OOM on Vercel
export async function readSafeTextSnippet(res: Response, maxBytes = 16384): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = maxBytes - received;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        received += remaining;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      received += value.byteLength;
    }
  } catch {
    // Return whatever was read up to the error
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }

  const combined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(combined);
}

// If domain is behind Cloudflare, extract candidate origin server IP from SPF ip4: directives
export function extractOriginIpFromSpf(spfRecord: string): string | null {
  const matches = spfRecord.match(/\bip4:(\d{1,3}(?:\.\d{1,3}){3})\b/gi) || [];
  for (const match of matches) {
    const candidateIp = match.replace(/^ip4:/i, '');
    if (
      net.isIPv4(candidateIp) &&
      !isPrivateOrReservedIpv4(candidateIp) &&
      !isCloudflareIpv4(candidateIp)
    ) {
      return candidateIp;
    }
  }
  return null;
}
