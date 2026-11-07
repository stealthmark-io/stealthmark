'use client';

import React, { useId, useState, useRef, useEffect } from 'react';
import { Info, HelpCircle, ExternalLink, X } from 'lucide-react';

export interface TouchableTooltipProps {
  title: string;
  badge?: string;
  badgeColor?: 'cyan' | 'emerald' | 'amber' | 'rose' | 'purple';
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  docLink?: string;
  className?: string;
  /** Extra classes for the element that opens the popover, for example `w-full` to make a card fill its cell. */
  triggerClassName?: string;
}

export function TouchableTooltip({
  title,
  badge,
  badgeColor = 'cyan',
  content,
  children,
  side = 'bottom',
  align = 'center',
  docLink,
  className = '',
  triggerClassName = '',
}: TouchableTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverId = useId();
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen((prev) => !prev);
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    setIsOpen((prev) => !prev);
  };

  // Opens for keyboard focus only: a mouse press also focuses the trigger and must not undo the click toggle.
  const handleTriggerFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.matches(':focus-visible')) setIsOpen(true);
  };

  // Moving focus into the popover (close button, reference link) keeps it open; leaving the whole widget closes it.
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsOpen(false);
  };

  const getBadgeStyle = () => {
    switch (badgeColor) {
      case 'emerald':
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'amber':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'rose':
        return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      case 'purple':
        return 'bg-purple-500/15 text-purple-300 border-purple-500/30';
      default:
        return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    }
  };

  const getPositionClasses = () => {
    let classes = '';

    // Side position
    if (side === 'top') {
      classes += 'bottom-full mb-2 ';
    } else if (side === 'bottom') {
      classes += 'top-full mt-2 ';
    } else if (side === 'left') {
      classes += 'right-full mr-2 top-1/2 -translate-y-1/2 ';
    } else if (side === 'right') {
      classes += 'left-full ml-2 top-1/2 -translate-y-1/2 ';
    }

    // Align position
    if (side === 'top' || side === 'bottom') {
      if (align === 'center') {
        classes += 'left-1/2 -translate-x-1/2 ';
      } else if (align === 'start') {
        classes += 'left-0 ';
      } else if (align === 'end') {
        classes += 'right-0 ';
      }
    }

    return classes;
  };

  return (
    <div className={`relative inline-flex items-center ${className}`} onBlur={handleBlur}>
      {/* Trigger */}
      <div
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
        aria-describedby={isOpen ? popoverId : undefined}
        onClick={toggle}
        onKeyDown={handleTriggerKeyDown}
        onFocus={handleTriggerFocus}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        className={`inline-flex items-center cursor-pointer select-none ${triggerClassName}`}
      >
        {children}
      </div>

      {/* Floating Popup Card */}
      {isOpen && (
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-label={title}
          tabIndex={-1}
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
          className={`absolute z-50 w-72 sm:w-80 rounded-2xl bg-[#090B10]/95 backdrop-blur-xl border border-cyan-500/30 p-4 shadow-[0_10px_35px_rgba(0,0,0,0.8),0_0_20px_rgba(0,210,254,0.15)] animate-in fade-in zoom-in-95 duration-150 text-left focus:outline-none ${getPositionClasses()}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2 pb-2 border-b border-white/[0.08]">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-white text-xs tracking-tight">{title}</span>
                {badge && (
                  <span
                    className={`px-2 py-0.2 rounded-full text-[9px] font-mono font-bold tracking-wider uppercase border ${getBadgeStyle()}`}
                  >
                    {badge}
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              aria-label="Close"
              onClick={() => setIsOpen(false)}
              className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition sm:hidden"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Body Content */}
          <div className="text-[11px] text-slate-300 leading-relaxed pt-2.5 space-y-2">
            {typeof content === 'string' ? <p>{content}</p> : content}
          </div>

          {/* Optional Documentation Link */}
          {docLink && (
            <div className="pt-2.5 mt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] font-mono">
              <span className="text-slate-400">Architecture Spec:</span>
              <a
                href={docLink}
                className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 hover:underline"
                target={docLink.startsWith('http') ? '_blank' : undefined}
                rel="noreferrer"
              >
                <span>Read Reference</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
