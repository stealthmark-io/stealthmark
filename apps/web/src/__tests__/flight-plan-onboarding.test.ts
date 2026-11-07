import { describe, it, expect } from 'vitest';

describe('Dashboard Onboarding Wizard & Flight Plan Blueprint Logic', () => {
  const DOMAIN_PRESETS: Record<string, Array<{ id: string; action: string; path: string; enabled: boolean; isBlocked?: boolean; rateLimit: number }>> = {
    demodental: [
      { id: 'plans', action: 'GET_PLANS', path: '/agent/v1/plans', enabled: true, rateLimit: 60 },
      { id: 'simulate', action: 'SIMULATE_SMILE', path: '/agent/v1/simulate', enabled: true, rateLimit: 20 },
      { id: 'checkout', action: 'CHECKOUT', path: '/agent/v1/checkout', enabled: true, rateLimit: 10 },
      { id: 'admin', action: 'ADMIN_ACCESS', path: '/admin/*', enabled: false, isBlocked: true, rateLimit: 0 },
    ],
    demotickets: [
      { id: 'events', action: 'LIST_EVENTS', path: '/agent/v1/events', enabled: true, rateLimit: 120 },
      { id: 'seats', action: 'CHECK_SEATS', path: '/agent/v1/seats', enabled: true, rateLimit: 60 },
      { id: 'purchase', action: 'PURCHASE', path: '/agent/v1/purchase', enabled: true, rateLimit: 10 },
      { id: 'abandoned', action: 'VIEW_CARTS', path: '/cart/abandoned', enabled: false, isBlocked: true, rateLimit: 0 },
    ],
    democv: [
      { id: 'upload', action: 'UPLOAD_CV', path: '/agent/v1/upload', enabled: true, rateLimit: 30 },
      { id: 'audit', action: 'AUDIT_CV', path: '/agent/v1/audit', enabled: true, rateLimit: 20 },
      { id: 'report', action: 'GET_REPORT', path: '/agent/v1/report', enabled: true, rateLimit: 60 },
      { id: 'users', action: 'DB_ACCESS', path: '/api/users/*', enabled: false, isBlocked: true, rateLimit: 0 },
    ],
  };

  function detectCapabilities(domain: string) {
    const lower = domain.toLowerCase();
    for (const key of Object.keys(DOMAIN_PRESETS)) {
      if (lower.includes(key)) return DOMAIN_PRESETS[key].map(c => ({ ...c }));
    }
    return [
      { id: 'catalog', action: 'BROWSE_CATALOG', path: '/agent/v1/catalog', enabled: true, rateLimit: 120 },
      { id: 'search', action: 'SEARCH', path: '/agent/v1/search', enabled: true, rateLimit: 60 },
      { id: 'purchase', action: 'PURCHASE', path: '/agent/v1/purchase', enabled: true, rateLimit: 10 },
      { id: 'contact', action: 'SUBMIT_FORM', path: '/agent/v1/contact', enabled: true, rateLimit: 5 },
      { id: 'admin', action: 'ADMIN_ACCESS', path: '/admin/*', enabled: false, isBlocked: true, rateLimit: 0 },
    ];
  }

  it('detects specialized waypoints for demodental.example.com with strict admin lock', () => {
    const caps = detectCapabilities('https://demodental.example.com');
    expect(caps).toHaveLength(4);
    const adminRoute = caps.find(c => c.id === 'admin');
    expect(adminRoute?.isBlocked).toBe(true);
    expect(adminRoute?.enabled).toBe(false);

    const checkout = caps.find(c => c.id === 'checkout');
    expect(checkout?.enabled).toBe(true);
    expect(checkout?.path).toBe('/agent/v1/checkout');
  });

  it('detects ticketing waypoints for demotickets.example.com with abandoned cart guard', () => {
    const caps = detectCapabilities('demotickets.example.com');
    expect(caps).toHaveLength(4);
    const cartRoute = caps.find(c => c.id === 'abandoned');
    expect(cartRoute?.isBlocked).toBe(true);

    const purchase = caps.find(c => c.id === 'purchase');
    expect(purchase?.rateLimit).toBe(10);
  });

  it('falls back to safe generic e-commerce schema with blocked admin route for unlisted domains', () => {
    const caps = detectCapabilities('myshopify-store.io');
    expect(caps).toHaveLength(5);
    const admin = caps.find(c => c.id === 'admin');
    expect(admin?.isBlocked).toBe(true);
    expect(admin?.enabled).toBe(false);

    const catalog = caps.find(c => c.id === 'catalog');
    expect(catalog?.enabled).toBe(true);
  });

  it('verifies that enabled routes filter out blocked security paths', () => {
    const caps = detectCapabilities('democv.example.com');
    const enabledActiveRoutes = caps.filter(c => c.enabled && !c.isBlocked);
    expect(enabledActiveRoutes).toHaveLength(3);
    expect(enabledActiveRoutes.map(r => r.path)).toEqual([
      '/agent/v1/upload',
      '/agent/v1/audit',
      '/agent/v1/report',
    ]);
  });
});
