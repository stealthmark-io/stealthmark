import { Globe } from "lucide-react";
import { ALL_DOMAINS_LABEL } from "./domains";

export const DOMAIN_SELECT_ID = "telemetry-domain";
const ALL_DOMAINS_VALUE = "";

interface DomainSelectorProps {
  /** Domains to offer, already including the selected one. */
  domains: readonly string[];
  selected: string | null;
  onSelect: (domain: string | null) => void;
  /** Platform admins see the events of every organization, not only their own. */
  platform?: boolean;
}

export function DomainSelector({ domains, selected, onSelect, platform = false }: DomainSelectorProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-white/[0.08] bg-[#0d1017]/60 px-4 py-2.5"
      data-testid="telemetry-domain-selector"
    >
      <label htmlFor={DOMAIN_SELECT_ID} className="inline-flex items-center gap-2 text-xs font-semibold text-slate-300 uppercase font-mono">
        <Globe className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
        <span>Domain</span>
      </label>
      <select
        id={DOMAIN_SELECT_ID}
        value={selected ?? ALL_DOMAINS_VALUE}
        onChange={(e) => onSelect(e.target.value === ALL_DOMAINS_VALUE ? null : e.target.value)}
        className="bg-black/60 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/30 font-mono cursor-pointer max-w-full sm:max-w-[20rem]"
      >
        <option value={ALL_DOMAINS_VALUE}>{ALL_DOMAINS_LABEL}</option>
        {domains.map((domain) => (
          <option key={domain} value={domain}>
            {domain}
          </option>
        ))}
      </select>
      <p className="text-xs text-slate-400">
        {domains.length === 0
          ? "No domains yet. They appear once an agent visits a site that reports to StealthMark, or after you add one in the Add Domain tab."
          : "Pick a domain to filter the numbers, the agents and the events below. Each section says which period its numbers cover."}
        {platform && " Platform view: domains and events of every organization, so a domain is counted from the latest events."}
      </p>
    </div>
  );
}
