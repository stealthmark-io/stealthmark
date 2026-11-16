import { describe, it, expect } from 'vitest';
import {
  SAFE_OUTBOUND_ACCEPT_ENCODING,
  BROTLI_BLOCK_STATUS,
  BROTLI_BLOCK_CODE,
  BROTLI_BLOCK_BODY,
  hasUnsupportedBrotliEncoding,
} from '../encoding-guard.js';

describe('encoding-guard', () => {
  it('exports canonical constants for CVE-2026-111497 mitigation', () => {
    expect(SAFE_OUTBOUND_ACCEPT_ENCODING).toBe('gzip, deflate');
    expect(BROTLI_BLOCK_STATUS).toBe(415);
    expect(BROTLI_BLOCK_CODE).toBe('INBOUND_BROTLI_BLOCKED_CVE_2026_111497');
    expect(BROTLI_BLOCK_BODY).toEqual({
      error: 'unsupported_media_type',
      code: 'INBOUND_BROTLI_BLOCKED_CVE_2026_111497',
      message: 'Brotli-encoded request payloads are rejected to mitigate CVE-2026-111497.',
    });
  });

  describe('hasUnsupportedBrotliEncoding', () => {
    it('returns false for nullish or empty headers', () => {
      expect(hasUnsupportedBrotliEncoding(undefined)).toBe(false);
      expect(hasUnsupportedBrotliEncoding(null)).toBe(false);
      expect(hasUnsupportedBrotliEncoding('')).toBe(false);
      expect(hasUnsupportedBrotliEncoding('   ')).toBe(false);
    });

    it('returns false for safe encodings without brotli', () => {
      expect(hasUnsupportedBrotliEncoding('gzip')).toBe(false);
      expect(hasUnsupportedBrotliEncoding('deflate')).toBe(false);
      expect(hasUnsupportedBrotliEncoding('gzip, deflate')).toBe(false);
      expect(hasUnsupportedBrotliEncoding('identity')).toBe(false);
    });

    it('prevents false positives on tokens containing br substring', () => {
      expect(hasUnsupportedBrotliEncoding('brace')).toBe(false);
      expect(hasUnsupportedBrotliEncoding('bread')).toBe(false);
      expect(hasUnsupportedBrotliEncoding('abracadabra')).toBe(false);
      expect(hasUnsupportedBrotliEncoding('gzip, brace, deflate')).toBe(false);
    });

    it('detects br, x-brotli, and brotli tokens in single values', () => {
      expect(hasUnsupportedBrotliEncoding('br')).toBe(true);
      expect(hasUnsupportedBrotliEncoding('BR')).toBe(true);
      expect(hasUnsupportedBrotliEncoding('  br  ')).toBe(true);
      expect(hasUnsupportedBrotliEncoding('x-brotli')).toBe(true);
      expect(hasUnsupportedBrotliEncoding('X-Brotli')).toBe(true);
      expect(hasUnsupportedBrotliEncoding('brotli')).toBe(true);
      expect(hasUnsupportedBrotliEncoding('BROTLI')).toBe(true);
      expect(hasUnsupportedBrotliEncoding('br;q=1.0')).toBe(true);
    });

    it('detects brotli tokens in comma-separated list', () => {
      expect(hasUnsupportedBrotliEncoding('gzip, br')).toBe(true);
      expect(hasUnsupportedBrotliEncoding('gzip, x-brotli, deflate')).toBe(true);
      expect(hasUnsupportedBrotliEncoding('deflate, brotli')).toBe(true);
      expect(hasUnsupportedBrotliEncoding('gzip,   BR   , deflate')).toBe(true);
    });

    it('detects brotli tokens in array of header values', () => {
      expect(hasUnsupportedBrotliEncoding(['gzip', 'br'])).toBe(true);
      expect(hasUnsupportedBrotliEncoding(['gzip, deflate', 'x-brotli'])).toBe(true);
      expect(hasUnsupportedBrotliEncoding(['gzip', 'deflate'])).toBe(false);
      expect(hasUnsupportedBrotliEncoding(['brace', 'deflate'])).toBe(false);
    });
  });
});
