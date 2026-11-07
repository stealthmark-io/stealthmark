import React from "react";
import { cn } from "@/lib/utils";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "text" | "card" | "avatar" | "button" | "custom";
}

export function Skeleton({
  className,
  variant = "custom",
  ...props
}: SkeletonProps) {
  const base =
    "relative overflow-hidden rounded-lg bg-white/[0.06] before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_2s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/[0.08] before:to-transparent";

  const variants = {
    text: "h-4 w-3/4 rounded",
    card: "h-36 w-full rounded-2xl",
    avatar: "h-10 w-10 rounded-full shrink-0",
    button: "h-10 w-28 rounded-xl",
    custom: "",
  };

  return <div className={cn(base, variants[variant], className)} {...props} />;
}
