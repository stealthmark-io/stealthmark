'use client';

import React from 'react';
import { LEAD_HONEYPOT_FIELD } from '@/lib/lead-fields';

interface HoneypotFieldProps {
  value: string;
  onChange: (value: string) => void;
}

/** Hidden field that people never see or fill; automated form fillers do, and the API rejects those posts. */
export function HoneypotField({ value, onChange }: HoneypotFieldProps) {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
      <label>
        Leave this field empty
        <input
          type="text"
          name={LEAD_HONEYPOT_FIELD}
          tabIndex={-1}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  );
}
