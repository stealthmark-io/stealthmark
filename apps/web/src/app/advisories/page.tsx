import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { AdvisoriesLedgerClient } from '@/components/landing/AdvisoriesLedgerClient';

export default function AdvisoriesPage() {
  return (
    <div className="min-h-screen bg-[#02040a] text-slate-100 flex flex-col">
      <Navbar />
      <main className="flex-1 pt-28 pb-20 max-w-7xl w-full mx-auto px-4 sm:px-6">
        <AdvisoriesLedgerClient />
      </main>
      <Footer />
    </div>
  );
}
