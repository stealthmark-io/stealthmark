import { describe, it, expect } from 'vitest';
import {
  evaluateNode2ShellRisk,
  evaluateBunBrotliRisk,
  evaluatePythonBrotliRisk,
} from '../commands/doctor-v5.js';

describe('doctor-v5 evaluators (CVE-2026-111497)', () => {
  describe('evaluateNode2ShellRisk', () => {
    it('flags vulnerable Node.js versions (< 22, 22 < 22.23.4, 23, 24 < 24.22.1, 25, 26 < 26.12.1)', () => {
      const vulnerableVersions = [
        '18.20.0',
        '20.18.0',
        '21.7.0',
        '22.20.0',
        '22.23.3',
        '23.0.0',
        '23.6.0',
        '24.20.0',
        '24.22.0',
        '25.0.0',
        '26.10.0',
        '26.12.0',
      ];

      for (const ver of vulnerableVersions) {
        const result = evaluateNode2ShellRisk(ver);
        expect(result.vulnerable, `Node v${ver} should be vulnerable`).toBe(true);
        expect(result.detail).toContain('CVE-2026-111497');
      }
    });

    it('clears patched Node.js versions (>= 22.23.4, >= 24.22.1, >= 26.12.1)', () => {
      const patchedVersions = [
        '22.23.4',
        '22.23.5',
        'v22.23.5',
        '24.22.1',
        '24.23.0',
        '26.12.1',
        '26.13.0',
      ];

      for (const ver of patchedVersions) {
        const result = evaluateNode2ShellRisk(ver);
        expect(result.vulnerable, `Node v${ver} should be patched`).toBe(false);
        expect(result.detail).toContain('patched against Node2Shell');
      }
    });
  });

  describe('evaluateBunBrotliRisk', () => {
    it('flags vulnerable Bun versions (< 1.4.4)', () => {
      const vulnerableVersions = ['1.0.0', '1.4.0', '1.4.3', 'v1.4.3'];

      for (const ver of vulnerableVersions) {
        const result = evaluateBunBrotliRisk(ver);
        expect(result.vulnerable, `Bun v${ver} should be vulnerable`).toBe(true);
        expect(result.detail).toContain('CVE-2026-111497');
      }
    });

    it('clears patched Bun versions (>= 1.4.4)', () => {
      const patchedVersions = ['1.4.4', '1.4.5', '1.5.0', 'v1.4.4'];

      for (const ver of patchedVersions) {
        const result = evaluateBunBrotliRisk(ver);
        expect(result.vulnerable, `Bun v${ver} should be patched`).toBe(false);
        expect(result.detail).toContain('patched against CVE-2026-111497');
      }
    });
  });

  describe('evaluatePythonBrotliRisk', () => {
    it('detects vulnerable brotli and brotlicffi (< 1.2.1) in JSON array string', () => {
      const pipJson = JSON.stringify([
        { name: 'brotli', version: '1.1.0' },
        { name: 'requests', version: '2.31.0' },
      ]);

      const result = evaluatePythonBrotliRisk(pipJson);
      expect(result.vulnerable).toBe(true);
      expect(result.packages).toEqual([
        { name: 'brotli', version: '1.1.0', vulnerable: true },
      ]);
    });

    it('detects vulnerable brotlicffi (< 1.2.1) in JSON array string', () => {
      const pipJson = JSON.stringify([
        { name: 'brotlicffi', version: '1.0.9.2' },
      ]);

      const result = evaluatePythonBrotliRisk(pipJson);
      expect(result.vulnerable).toBe(true);
      expect(result.packages).toEqual([
        { name: 'brotlicffi', version: '1.0.9.2', vulnerable: true },
      ]);
    });

    it('clears patched brotli and brotlicffi (>= 1.2.1) in JSON array', () => {
      const pipJson = JSON.stringify([
        { name: 'brotli', version: '1.2.1' },
        { name: 'brotlicffi', version: '1.3.0' },
      ]);

      const result = evaluatePythonBrotliRisk(pipJson);
      expect(result.vulnerable).toBe(false);
      expect(result.packages.every((p) => !p.vulnerable)).toBe(true);
    });

    it('parses raw pip list plain-text output', () => {
      const textOutput = `
Package    Version
---------- -------
brotli     1.1.0
requests   2.31.0
      `;

      const result = evaluatePythonBrotliRisk(textOutput);
      expect(result.vulnerable).toBe(true);
      expect(result.packages[0]).toEqual({
        name: 'brotli',
        version: '1.1.0',
        vulnerable: true,
      });
    });

    it('accepts array of objects or key-value map', () => {
      const fromArray = evaluatePythonBrotliRisk([{ name: 'brotli', version: '1.0.0' }]);
      expect(fromArray.vulnerable).toBe(true);

      const fromMap = evaluatePythonBrotliRisk({ brotli: '1.2.1', brotlicffi: '1.2.1' });
      expect(fromMap.vulnerable).toBe(false);
    });

    it('returns not vulnerable when no brotli packages are installed', () => {
      const emptyResult = evaluatePythonBrotliRisk('[]');
      expect(emptyResult.vulnerable).toBe(false);
      expect(emptyResult.packages).toHaveLength(0);
    });
  });
});
