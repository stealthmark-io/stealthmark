"use client";

import { useState } from "react";
import { useGatewayTelemetry, type GatewayMetrics, type TelemetryScope } from "@/hooks/useGatewayTelemetry";
import { flags } from "@/lib/flags";
import { DefconModal } from "./DefconModal";
import { ThreatHistoryRoiCard } from "./ThreatHistoryRoiCard";
import { AccessEventStream } from "./gateway/AccessEventStream";
import { AgentsSummary } from "./gateway/AgentsSummary";
import { ACTIVE_SHIELDS } from "./gateway/constants";
import { DefconControls } from "./gateway/DefconControls";
import { DomainSelector } from "./gateway/DomainSelector";
import {
  buildAgentSummary,
  buildEventsView,
  buildScopedKpis,
  collectDomains,
  describeNoEvents,
  eventsStatusOf,
  selectorOptions,
  type ScopeInput,
} from "./gateway/domains";
import { sumThreats } from "./gateway/format";
import { GatewayHeader } from "./gateway/GatewayHeader";
import { GatewayMetricCards } from "./gateway/GatewayMetricCards";
import { ShieldsGrid } from "./gateway/ShieldsGrid";
import { useAuditExport } from "./gateway/useAuditExport";
import { useDomainBreakdown } from "./gateway/useDomainBreakdown";
import { useDomainEvents } from "./gateway/useDomainEvents";
import { useDomainSelection } from "./gateway/useDomainSelection";
import { useTrafficEvents } from "./gateway/useTrafficEvents";

interface GatewayPanelProps {
  selectedDefcon?: number;
  onDefconChange?: (level: number) => void;
  metrics?: GatewayMetrics;
  status?: string;
  isLive?: boolean;
  isLoading?: boolean;
  /** Whose events the metrics cover; platform admins read every organization, which the month ledger routes do not. */
  telemetryScope?: TelemetryScope | null;
  /** Signed-in users can load the month breakdown per domain; guests only see what the page already has. */
  isAuthenticated?: boolean;
  /** Domains registered through Add Domain, offered in the selector even before an agent visits them. */
  registeredDomains?: readonly string[];
}

export function GatewayPanel({
  selectedDefcon = 5,
  onDefconChange,
  metrics: propMetrics,
  status: propStatus,
  isLive: propIsLive,
  isLoading: propIsLoading,
  telemetryScope: propTelemetryScope,
  isAuthenticated = true,
  registeredDomains = [],
}: GatewayPanelProps) {
  const internalTelemetry = useGatewayTelemetry({ pollIntervalMs: 3000 });
  const metrics = propMetrics || internalTelemetry.metrics;
  const status = propStatus || internalTelemetry.status;
  const isLive = propIsLive !== undefined ? propIsLive : internalTelemetry.isLive;
  const isLoading = propIsLoading !== undefined ? propIsLoading : internalTelemetry.isLoading;
  const [localDefcon, setLocalDefcon] = useState(selectedDefcon);
  const [pendingDefcon, setPendingDefcon] = useState<number | null>(null);
  const [isDefconModalOpen, setIsDefconModalOpen] = useState(false);

  const telemetryScope = propTelemetryScope !== undefined ? propTelemetryScope : internalTelemetry.scope;
  const platformView = telemetryScope === "platform";
  // The month ledger routes read the session organization only, so a platform admin counts from the events instead.
  const ledgerAvailable = isAuthenticated && !platformView;

  const { trafficEvents, loadFailed, loaded } = useTrafficEvents();
  const [domain, selectDomain] = useDomainSelection();
  const { breakdown, sites, status: breakdownStatus } = useDomainBreakdown(ledgerAvailable, domain);
  const hostFeed = useDomainEvents(ledgerAvailable ? domain : null);

  const domains = selectorOptions(
    collectDomains({ registered: registeredDomains, events: trafficEvents, siteHosts: sites.map((site) => site.host) }),
    domain,
  );
  const eventsView = buildEventsView({
    domain,
    signedIn: isAuthenticated,
    latest: { events: trafficEvents, loaded, failed: loadFailed },
    hostFeed: ledgerAvailable && domain !== null ? hostFeed : null,
  });
  const scope: ScopeInput = {
    domain,
    breakdown,
    status: breakdownStatus,
    events: trafficEvents,
    eventsStatus: eventsStatusOf(loaded, loadFailed, trafficEvents.length),
    signedIn: isAuthenticated,
  };

  const activeDefcon = selectedDefcon !== undefined ? selectedDefcon : localDefcon;
  const totalThreats = sumThreats(metrics);
  const { isExporting, exportAuditLog } = useAuditExport({
    trafficEvents: eventsView.events,
    blockedByPolicy: metrics.threats_blocked.policy_blocked ?? 0,
    domain,
    emptyMessage: describeNoEvents(eventsView, domain),
  });

  const handleTierClick = (level: number) => {
    if (level === activeDefcon) return;
    setPendingDefcon(level);
    setIsDefconModalOpen(true);
  };

  const handleConfirmDefcon = (level: number) => {
    setLocalDefcon(level);
    if (onDefconChange) {
      onDefconChange(level);
    }
  };

  return (
    <div className="space-y-6 text-left">
      {flags.defcon && (
        <DefconModal
          isOpen={isDefconModalOpen}
          onClose={() => setIsDefconModalOpen(false)}
          targetDefcon={pendingDefcon}
          currentDefcon={activeDefcon}
          onConfirm={handleConfirmDefcon}
        />
      )}

      <GatewayHeader status={status} isLive={isLive} />

      <DomainSelector domains={domains} selected={domain} onSelect={selectDomain} platform={platformView} />

      <GatewayMetricCards
        metrics={metrics}
        isLoading={isLoading}
        totalThreats={totalThreats}
        scope={buildScopedKpis(scope)}
        platform={platformView}
      />

      {flags.defcon && <DefconControls activeDefcon={activeDefcon} onSelectTier={handleTierClick} />}
      {flags.defcon && <ThreatHistoryRoiCard metrics={metrics} />}

      <ShieldsGrid shields={ACTIVE_SHIELDS} />

      <AgentsSummary summary={buildAgentSummary(scope)} domain={domain} />

      <AccessEventStream
        events={eventsView.events}
        loadFailed={eventsView.loadFailed}
        loading={eventsView.loading}
        signedIn={eventsView.signedIn}
        isExporting={isExporting}
        onExport={exportAuditLog}
        domain={domain}
        source={eventsView.source}
        loadedCount={eventsView.loadedCount}
        onClearDomain={() => selectDomain(null)}
      />
    </div>
  );
}
