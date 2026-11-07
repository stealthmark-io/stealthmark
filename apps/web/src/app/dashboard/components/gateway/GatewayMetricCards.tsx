import { Activity, Cpu, ShieldAlert } from "lucide-react";
import type { GatewayMetrics } from "@/hooks/useGatewayTelemetry";
import type { ScopedKpis } from "./domains";
import { formatLatencyP50, formatTotalRequests } from "./format";
import { MetricCard } from "./MetricCard";

interface GatewayMetricCardsProps {
  metrics: GatewayMetrics | null | undefined;
  isLoading: boolean;
  totalThreats: number;
  /** Figures of the selected domain; when absent the cards show the organization's totals. */
  scope?: ScopedKpis | null;
  /** Platform admins read the totals of every organization; the period of those is not promised. */
  platform?: boolean;
}

export function GatewayMetricCards({ metrics, isLoading, totalThreats, scope = null, platform = false }: GatewayMetricCardsProps) {
  const totalsFootnote = platform ? "All organizations" : "All domains, this month";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
      <MetricCard
        tooltip={{
          title: "Agent Events",
          badge: "Declared agents",
          badgeColor: "cyan",
          align: "start",
          content:
            "One event per request from an agent that identifies itself: Accept: application/agent+json, the x-stealthmark-agent header, or a known crawler User-Agent such as GPTBot, ClaudeBot, PerplexityBot or OAI-SearchBot. Human visitors are not counted and the page content they receive does not change.",
        }}
        label="Agent Events"
        Icon={Activity}
        iconClassName="text-cyan-400"
        borderClassName="border border-white/10"
        hoverBorderClassName="hover:border-cyan-500/30"
        valueClassName="text-white"
        value={scope ? scope.events.value : formatTotalRequests(metrics, isLoading)}
        footnote={scope ? scope.events.footnote : totalsFootnote}
      />

      <MetricCard
        tooltip={{
          title: "Blocked by Policy",
          badge: "Block policy",
          badgeColor: "rose",
          align: "center",
          content:
            "Agent requests answered with 403 because the site policy is set to block. Requests that ask for the agent manifest still receive it. With the default observe policy this stays at 0.",
        }}
        label="Blocked by Policy"
        Icon={ShieldAlert}
        iconClassName="text-rose-400"
        borderClassName="border border-rose-500/20"
        hoverBorderClassName="hover:border-rose-500/40"
        valueClassName="text-rose-400"
        value={scope ? scope.blocked.value : totalThreats.toLocaleString()}
        footnote={scope ? scope.blocked.footnote : totalsFootnote}
      />

      <MetricCard
        tooltip={{
          title: "Processing Latency",
          badge: "Measured",
          badgeColor: "emerald",
          align: "end",
          content:
            "Median time the gateway took to answer, as measured and reported by the gateway. It shows a dash until a measurement exists. It is an observed value, not a guarantee.",
        }}
        label="Median Latency (p50)"
        Icon={Cpu}
        iconClassName="text-emerald-400"
        borderClassName="border border-white/10"
        hoverBorderClassName="hover:border-emerald-500/30"
        valueClassName="text-emerald-400"
        value={scope ? scope.latency.value : formatLatencyP50(metrics, isLoading)}
        footnote={scope ? scope.latency.footnote : "Observed, not a guarantee"}
      />
    </div>
  );
}
