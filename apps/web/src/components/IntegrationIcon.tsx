'use client';

import React from 'react';
import { BrandLogo } from '@/components/BrandLogo';

export interface IntegrationIconProps {
  id?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  iconClassName?: string;
  active?: boolean;
  children?: React.ReactNode;
}

const SIZE_CLASSES = {
  sm: 'w-8 h-8 rounded-lg',
  md: 'w-10 h-10 rounded-xl',
  lg: 'w-12 h-12 rounded-xl',
  xl: 'w-14 h-14 rounded-2xl',
};

const ICON_SIZE_CLASSES = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
  xl: 'w-7 h-7',
};

export function IntegrationIcon({
  id,
  size = 'md',
  className = '',
  iconClassName = '',
  active = false,
  children,
}: IntegrationIconProps) {
  const containerSizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  const iconSizeClass = ICON_SIZE_CLASSES[size] || ICON_SIZE_CLASSES.md;

  const filterClasses = active
    ? 'grayscale-0 opacity-100'
    : 'grayscale opacity-70 group-hover:grayscale-0 group-hover:opacity-100';

  return (
    <div
      className={`aspect-square ${containerSizeClass} flex items-center justify-center shrink-0 border transition-all duration-300 ${
        active
          ? 'bg-cyan-950/30 border-cyan-400/50 shadow-lg shadow-cyan-500/10'
          : 'bg-white/[0.04] border-white/10 group-hover:border-white/20 group-hover:bg-white/[0.07]'
      } ${className}`}
    >
      <div
        className={`w-full h-full flex items-center justify-center object-contain transition-all duration-300 ${filterClasses} ${iconClassName}`}
      >
        {children ? (
          children
        ) : id ? (
          <BrandLogo id={id} className={iconSizeClass} />
        ) : null}
      </div>
    </div>
  );
}
