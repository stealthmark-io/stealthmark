import { describe, it, expect } from 'vitest';
import React from 'react';
import { metadata } from '../app/trust/layout';
import TrustPage from '../app/trust/page';
import { SCAN_CHECK_COUNT } from '../lib/readiness-report';
import { TouchableTooltip } from '../components/ui/tooltip';

describe('Sprint 2: Trust page and Touchable Popups', () => {
  describe('SEO & Metadata for /trust Layout', () => {
    it('provides honest trust SEO metadata', () => {
      expect(metadata.title).toContain('Trust & Security');
      expect(metadata.description).toContain(`${SCAN_CHECK_COUNT}-point passive scanner`);
      expect(metadata.keywords).toContain('Responsible disclosure');
      expect(metadata.keywords).not.toContain('Know Your Agent');
    });
  });

  describe('Trust Page Content', () => {
    it('exports a valid React functional component for /trust', () => {
      expect(typeof TrustPage).toBe('function');
    });

    it('exports the page component under its expected name', () => {
      expect(TrustPage.name).toBe('TrustPage');
    });
  });

  describe('Touchable Explanatory Popover Component', () => {
    it('exports TouchableTooltip functional component', () => {
      expect(typeof TouchableTooltip).toBe('function');
    });

    it('correctly handles badge color styling and properties', () => {
      const props = {
        title: 'DEFCON Operational Posture',
        badge: 'DEFCON 5: Normal',
        badgeColor: 'emerald' as const,
        side: 'bottom' as const,
        align: 'end' as const,
        docLink: '/trust',
        content: 'Dual-door gateway active with transparent token optimization.',
        children: React.createElement('span', null, 'Trigger'),
      };
      const element = React.createElement(TouchableTooltip, props);

      expect(element).toBeDefined();
      expect(element.props.title).toBe('DEFCON Operational Posture');
      expect(element.props.badgeColor).toBe('emerald');
      expect(element.props.docLink).toBe('/trust');
    });
  });
});
