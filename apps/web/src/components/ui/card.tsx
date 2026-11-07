import React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "bordered" | "glow";
  glowColor?: "purple" | "cyan" | "emerald" | "amber";
  hoverEffect?: "lift" | "glow" | "none";
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className,
      variant = "default",
      glowColor = "purple",
      hoverEffect = "lift",
      children,
      ...props
    },
    ref
  ) => {
    const base = "rounded-2xl transition-all duration-300 relative overflow-hidden";

    const variants = {
      default:
        "bg-[#0d1017]/80 backdrop-blur-xl border border-white/[0.08] shadow-xl",
      elevated:
        "bg-[#0d1017]/95 backdrop-blur-2xl border border-white/[0.12] shadow-2xl shadow-cyan-950/20",
      bordered:
        "bg-transparent border border-white/[0.12] hover:border-cyan-500/40",
      glow: "bg-[#0d1017]/90 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_30px_-5px_rgba(0,210,254,0.2)]",
    };

    const hoverStyles = {
      lift: "hover:-translate-y-1 hover:border-cyan-500/40 hover:shadow-cyan-950/30 hover:shadow-2xl",
      glow: "hover:shadow-[0_0_35px_-5px_rgba(0,210,254,0.3)] hover:border-cyan-500/40",
      none: "",
    };

    const glowOverlays = {
      purple: "from-purple-600/10 via-transparent to-transparent",
      cyan: "from-cyan-500/10 via-transparent to-transparent",
      emerald: "from-emerald-500/10 via-transparent to-transparent",
      amber: "from-amber-500/10 via-transparent to-transparent",
    };

    return (
      <div
        ref={ref}
        className={cn(base, variants[variant], hoverStyles[hoverEffect], className)}
        {...props}
      >
        <div
          className={cn(
            "absolute inset-0 bg-gradient-to-br pointer-events-none opacity-50",
            glowOverlays[glowColor]
          )}
        />
        <div className="relative z-10">{children}</div>
      </div>
    );
  }
);

Card.displayName = "Card";

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pb-3 space-y-1.5", className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-lg font-semibold tracking-tight text-white", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-slate-400 font-normal leading-relaxed", className)} {...props} />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-3", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("p-6 pt-0 flex items-center border-t border-white/[0.05] mt-4", className)}
      {...props}
    />
  );
}
