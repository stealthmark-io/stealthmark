'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function GatewayRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard?tab=flight-plan');
  }, [router]);

  return (
    <div className="min-h-screen bg-[#060709] flex items-center justify-center">
      <div className="flex items-center gap-3 text-cyan-400 font-mono text-sm">
        <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
        <span>Redirecting to StealthMark Sovereign Gateway Dashboard...</span>
      </div>
    </div>
  );
}
