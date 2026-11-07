import type { LucideIcon } from "lucide-react";
import { TouchableTooltip, type TouchableTooltipProps } from "@/components/ui/tooltip";

interface MetricCardProps {
  tooltip: Pick<TouchableTooltipProps, "title" | "badge" | "badgeColor" | "align" | "content">;
  label: string;
  Icon: LucideIcon;
  iconClassName: string;
  borderClassName: string;
  hoverBorderClassName: string;
  valueClassName: string;
  value: string;
  footnote: string;
}

export function MetricCard({
  tooltip,
  label,
  Icon,
  iconClassName,
  borderClassName,
  hoverBorderClassName,
  valueClassName,
  value,
  footnote,
}: MetricCardProps) {
  return (
    <TouchableTooltip {...tooltip} side="bottom" docLink="/trust" className="w-full" triggerClassName="w-full">
      <div
        className={`w-full p-4 rounded-2xl bg-[#0d1017] ${borderClassName} space-y-1 shadow-xl ${hoverBorderClassName} transition cursor-pointer`}
      >
        <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
          <span>{label}</span>
          <Icon className={`w-3.5 h-3.5 ${iconClassName}`} />
        </div>
        <div className={`text-2xl font-bold font-mono ${valueClassName}`}>{value}</div>
        <div className="text-xs text-slate-400 font-mono">{footnote}</div>
      </div>
    </TouchableTooltip>
  );
}
