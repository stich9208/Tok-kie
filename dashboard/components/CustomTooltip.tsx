'use client';

import React from 'react';

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number | string;
    color?: string;
    dataKey?: string;
  }>;
  label?: string;
}

export const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const formatTokens = (val: any) => {
    const num = Number(val);
    if (isNaN(num)) return String(val);
    return num.toLocaleString() + ' Tokens';
  };

  const formatCost = (val: any) => {
    const num = Number(val);
    if (isNaN(num)) return String(val);
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl p-3.5 shadow-2xl space-y-2 min-w-[170px] pointer-events-none z-50">
      {label && (
        <div className="text-xs font-bold text-text-primary pb-1.5 border-b border-surface-border/60">
          {label}
        </div>
      )}
      <div className="space-y-1.5 text-xs">
        {payload.map((entry, index) => {
          const isCost = entry.dataKey === 'cost' || entry.name.includes('비용') || entry.name.includes('가치');
          return (
            <div key={`item-${index}`} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: entry.color || '#e6d7ff' }}
                />
                <span className="text-text-secondary text-[11px]">
                  {entry.name}
                </span>
              </div>
              <span className="font-mono font-bold text-text-primary text-xs">
                {isCost ? formatCost(entry.value) : formatTokens(entry.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
