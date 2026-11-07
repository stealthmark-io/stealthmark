import type { MetadataRoute } from 'next';
import { SITE_ORIGIN } from '@/lib/site';

const PUBLIC_PATHS = ['/', '/scan', '/pricing', '/docs', '/trust', '/leaderboard', '/enterprise', '/enterprise/contact', '/privacy', '/terms', '/refund'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({
    url: path === '/' ? SITE_ORIGIN : `${SITE_ORIGIN}${path}`,
  }));
}
