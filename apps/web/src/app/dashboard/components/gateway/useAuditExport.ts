import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { buildEventsCsv, domainFileSlug } from "./format";
import type { AgentTrafficEvent } from "./types";

interface UseEventsExportArgs {
  /** Events to export: the ones the table shows, already filtered to the selected domain. */
  trafficEvents: AgentTrafficEvent[];
  blockedByPolicy: number;
  /** Selected domain, or null for all domains. */
  domain: string | null;
  /** Why there is nothing to export when `trafficEvents` is empty. */
  emptyMessage: string;
}

function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function useAuditExport({ trafficEvents, blockedByPolicy, domain, emptyMessage }: UseEventsExportArgs) {
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);

  const exportAuditLog = () => {
    if (trafficEvents.length === 0) {
      toast({ title: "Nothing to export", description: emptyMessage, type: "error" });
      return;
    }

    setIsExporting(true);
    try {
      const now = new Date();
      const csv = buildEventsCsv({ events: trafficEvents, blockedByPolicy, exportedAt: now.toISOString(), domain });
      const scope = domain === null ? "" : `-${domainFileSlug(domain)}`;
      const filename = `stealthmark-agent-events${scope}-${now.toISOString().slice(0, 10)}.csv`;
      downloadCsv(csv, filename);
      toast({ title: "Events exported", description: `Downloaded ${filename}.`, type: "success" });
    } catch (err) {
      console.error("Export error:", err);
      toast({ title: "Export failed", description: "Could not generate the CSV file.", type: "error" });
    } finally {
      setIsExporting(false);
    }
  };

  return { isExporting, exportAuditLog };
}
