"use client";

import type { AuthUser } from "@/lib/auth";
import type { CreateKeyResult } from "./useDashboardActions";
import type { useGatewayTelemetry } from "@/hooks/useGatewayTelemetry";
import { flags } from "@/lib/flags";
import {
  ApiKeysPanel,
  FlightPlanPanel,
  GatewayPanel,
  HitlApprovalPanel,
  McpPanel,
  OnboardingWizard,
  SettingsPanel,
  type ApiKeyItem,
  type DetectedCapability,
} from "../components";
import { AgentActivityPanel } from "../components/AgentActivityPanel";
import type { DashboardTab } from "./dashboard-data";

interface DashboardPanelsProps {
  activeTab: DashboardTab;
  user: AuthUser | null;
  isAuthenticated: boolean;
  defconLevel: number;
  onDefconChange: (level: number) => void;
  telemetry: ReturnType<typeof useGatewayTelemetry>;
  userRealRequests: number;
  domain: string;
  capabilities: DetectedCapability[];
  apiKeys: ApiKeyItem[];
  activeApiKey: string | null;
  onCreateKey: (name: string, rpm: number) => Promise<CreateKeyResult>;
  onRevokeKey: (id: string) => void;
  onOnboardingComplete: (domain: string, capabilities: DetectedCapability[]) => void;
  onOpenWizard: () => void;
  effectiveTier: string;
  maxTransactions: number;
}

export function DashboardPanels({
  activeTab,
  user,
  isAuthenticated,
  defconLevel,
  onDefconChange,
  telemetry,
  userRealRequests,
  domain,
  capabilities,
  apiKeys,
  activeApiKey,
  onCreateKey,
  onRevokeKey,
  onOnboardingComplete,
  onOpenWizard,
  effectiveTier,
  maxTransactions,
}: DashboardPanelsProps) {
  return (
    <div className="animate-in fade-in duration-300">
      {activeTab === "gateway" && (
        <GatewayPanel
          selectedDefcon={defconLevel}
          onDefconChange={flags.defcon ? onDefconChange : undefined}
          metrics={telemetry.metrics}
          status={telemetry.status}
          isLive={telemetry.isLive}
          isLoading={telemetry.isLoading}
          telemetryScope={telemetry.scope}
          isAuthenticated={isAuthenticated}
          registeredDomains={isAuthenticated && domain ? [domain] : []}
        />
      )}

      {activeTab === "agents" && <AgentActivityPanel isAuthenticated={isAuthenticated} />}

      {flags.hitl && activeTab === "hitl" && <HitlApprovalPanel />}

      {flags.hitl && activeTab === "flight-plan" && (
        <FlightPlanPanel
          domain={domain}
          capabilities={capabilities}
          onReset={onOpenWizard}
          metrics={telemetry.metrics}
        />
      )}

      {activeTab === "api-keys" && (
        <ApiKeysPanel
          apiKeys={apiKeys}
          onCreateKey={onCreateKey}
          onRevokeKey={onRevokeKey}
        />
      )}

      {flags.mcpPanel && activeTab === "mcp" && <McpPanel apiKey={activeApiKey} />}

      {activeTab === "wizard" && <OnboardingWizard onComplete={onOnboardingComplete} />}

      {activeTab === "settings" && (
        <SettingsPanel
          user={user}
          isAuthenticated={isAuthenticated}
          userPlanTier={effectiveTier}
          userRealRequests={userRealRequests}
          maxTransactions={maxTransactions}
          domain={domain}
        />
      )}
    </div>
  );
}
