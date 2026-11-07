"use client";

import type { ReactNode } from "react";
import { Bot, Fingerprint, Key, Plus, Route, Settings, Terminal, Zap } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { TAB_ENABLED, type DashboardTab } from "./dashboard-data";
import { isEnabledTab } from "./dashboard-helpers";

interface DashboardTabsProps {
  activeTab: DashboardTab;
  onChange: (tab: DashboardTab) => void;
}

const ALL_TAB_ITEMS: Array<{ id: DashboardTab; label: string; icon: ReactNode }> = [
  { id: "gateway", label: "Telemetry", icon: <Zap className="w-4 h-4" /> },
  { id: "agents", label: "Agents", icon: <Bot className="w-4 h-4" /> },
  { id: "hitl", label: "HITL Approvals", icon: <Fingerprint className="w-4 h-4" /> },
  { id: "flight-plan", label: "Flight Plan", icon: <Route className="w-4 h-4" /> },
  { id: "api-keys", label: "API Keys", icon: <Key className="w-4 h-4" /> },
  { id: "mcp", label: "MCP Setup", icon: <Terminal className="w-4 h-4" /> },
  { id: "wizard", label: "Add Domain", icon: <Plus className="w-4 h-4" /> },
  { id: "settings", label: "Settings & Billing", icon: <Settings className="w-4 h-4" /> },
];

export function DashboardTabs({ activeTab, onChange }: DashboardTabsProps) {
  const tabItems = ALL_TAB_ITEMS.filter((item) => TAB_ENABLED[item.id]);

  return (
    <div className="flex justify-start sm:justify-center overflow-x-auto os-scroll pb-2">
      <Tabs
        items={tabItems}
        activeId={activeTab}
        onChange={(id) => {
          if (isEnabledTab(id)) onChange(id);
        }}
        variant="pill"
      />
    </div>
  );
}
