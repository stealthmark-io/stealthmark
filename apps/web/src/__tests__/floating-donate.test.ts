import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DONATION_NETWORKS,
  DonationPanel,
  FloatingDonateButton,
  type CopyState,
} from '../components/scan/FloatingDonateButton';
import { CRYPTO_WALLETS, DONATION_OPTIONS } from '../lib/offer';

const noop = () => {};
const panel = (copyState: CopyState) =>
  renderToStaticMarkup(createElement(DonationPanel, { copyState, onCopy: noop, onClose: noop }));

describe('floating donation button', () => {
  it('pins the wallets and the Polar checkout link the owner provided', () => {
    expect(CRYPTO_WALLETS.tron).toBe('TYgGahN7wK9NtUVFZaXCwZqktaYmkuNxD8');
    expect(CRYPTO_WALLETS.eth).toBe('0xc8dc4ecb93c4c665Fad07E1261F5f7D60e3C6E0F');
    expect(CRYPTO_WALLETS.polygon).toBe('0xc8dc4ecb93c4c665Fad07E1261F5f7D60e3C6E0F');
    expect(CRYPTO_WALLETS.arbitrum).toBe('0xc8dc4ecb93c4c665Fad07E1261F5f7D60e3C6E0F');
    expect(CRYPTO_WALLETS.btc).toBe('bc1qvaz9ly5x5re3lmm70gtn6du86djant8mkj64x5');
    expect(DONATION_OPTIONS.polarCheckoutUrl).toBe(
      'https://buy.polar.sh/polar_cl_toVEHysd64E3OWPwKz8oJbqWEPsSDHVJjX9cD0JW0O5',
    );
    expect(DONATION_NETWORKS.map((row) => row.id)).toEqual(['tron', 'eth', 'polygon', 'arbitrum', 'btc']);
  });

  it('starts collapsed: only the pill renders, without addresses', () => {
    const html = renderToStaticMarkup(createElement(FloatingDonateButton));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(`Donate ${DONATION_OPTIONS.polarUsdAmount}`);
    expect(html).not.toContain('role="dialog"');
    for (const row of DONATION_NETWORKS) expect(html).not.toContain(row.address);
  });

  it('lists every network with its full address and opens Polar in a new tab', () => {
    const html = panel(null);
    for (const row of DONATION_NETWORKS) {
      expect(html).toContain(`>${row.network}<`);
      expect(html).toContain(`>${row.address}<`);
    }
    const links = html.match(/<a [^>]*>/g) ?? [];
    expect(links).toHaveLength(1);
    expect(links[0]).toContain(`href="${DONATION_OPTIONS.polarCheckoutUrl}"`);
    expect(links[0]).toContain('target="_blank"');
    expect(links[0]).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('mailto:');
  });

  it('shows copy feedback only on the row that was copied', () => {
    const copied = panel({ id: 'polygon', ok: true });
    expect(copied.match(/>Copied</g)).toHaveLength(1);
    const at = copied.indexOf('>Copied<');
    expect(at).toBeGreaterThan(copied.indexOf('>Polygon<'));
    expect(at).toBeLessThan(copied.indexOf('>Arbitrum One<'));
    expect(copied).toContain('Address copied.');

    const failed = panel({ id: 'tron', ok: false });
    expect(failed.match(/>Select it</g)).toHaveLength(1);
    expect(failed).not.toContain('>Copied<');
  });
});
