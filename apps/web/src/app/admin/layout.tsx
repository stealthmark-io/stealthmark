import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { canViewAdminPages } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Founder Control Plane | StealthMark Admin',
  description: 'Founder dashboard for StealthMark organizations and plan overrides.',
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await canViewAdminPages())) notFound();

  return (
    <div className="min-h-screen bg-[#050608] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-white">
      {children}
    </div>
  );
}
