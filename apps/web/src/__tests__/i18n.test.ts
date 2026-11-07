import { describe, it, expect } from 'vitest';
import { DICTIONARIES, Language } from '../context/LanguageContext';

describe('Internationalization (i18n) & Conversion Dictionaries', () => {
  const languages: Language[] = ['en', 'es', 'pt'];

  it('supports en, es, and pt configurations', () => {
    languages.forEach((lang) => {
      expect(DICTIONARIES[lang]).toBeDefined();
    });
  });

  it('has matching navigation keys across all languages', () => {
    const enKeys = Object.keys(DICTIONARIES.en.nav);
    languages.forEach((lang) => {
      expect(Object.keys(DICTIONARIES[lang].nav)).toEqual(enKeys);
      expect(DICTIONARIES[lang].nav.scanner.length).toBeGreaterThan(0);
      expect(DICTIONARIES[lang].nav.platform.length).toBeGreaterThan(0);
      expect(DICTIONARIES[lang].nav.pricing.length).toBeGreaterThan(0);
      expect(DICTIONARIES[lang].nav.launchConsole.length).toBeGreaterThan(0);
    });
  });

  it('has matching hero copy and bento titles across all languages', () => {
    languages.forEach((lang) => {
      const hero = DICTIONARIES[lang].hero;
      expect(hero.pill).toBeDefined();
      expect(hero.h1Part1.length).toBeGreaterThan(0);
      expect(hero.h1Part2.length).toBeGreaterThan(0);
      expect(hero.desc.length).toBeGreaterThan(0);
      expect(hero.bento1Title.length).toBeGreaterThan(0);
      expect(hero.bento2Title.length).toBeGreaterThan(0);
      expect(hero.bento3Title.length).toBeGreaterThan(0);
      expect(hero.bento4Title.length).toBeGreaterThan(0);
    });
  });

  it('has matching scanner metrics and legal disclaimers', () => {
    languages.forEach((lang) => {
      const scanner = DICTIONARIES[lang].scanner;
      expect(scanner.badge.length).toBeGreaterThan(0);
      expect(scanner.title.length).toBeGreaterThan(0);
      expect(scanner.safeHarbor).toContain('Safe Harbor');
      expect(scanner.metrics.payload.length).toBeGreaterThan(0);
      expect(scanner.metrics.tokens.length).toBeGreaterThan(0);
      expect(scanner.metrics.waste.length).toBeGreaterThan(0);
      expect(scanner.metrics.waf.length).toBeGreaterThan(0);
    });
  });
});
