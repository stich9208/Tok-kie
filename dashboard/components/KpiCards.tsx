'use client';

import React from 'react';
import {
  Zap,
  TrendingUp,
  Coins,
  MessageSquare,
  ArrowUpRight,
  Laptop
} from 'lucide-react';

interface KpiCardsProps {
  totalTokens: number;
  totalCostUsd: number;
  unpricedSessionCount?: number;
  sessionCount: number;
  todayTokens?: number;
  todayCostUsd?: number;
  todayUnpricedSessionCount?: number;
  todaySessions?: number;
  deviceCount?: number;
}

export const KpiCards: React.FC<KpiCardsProps> = ({
  totalTokens,
  totalCostUsd,
  unpricedSessionCount = 0,
  sessionCount,
  todayTokens = 0,
  todayCostUsd = 0,
  todayUnpricedSessionCount = 0,
  todaySessions = 0,
  deviceCount = 1,
}) => {
  const formatNumber = (num: number) => {
    return (num || 0).toLocaleString();
  };

  const formatCompactNumber = (num: number) => {
    const value = Number(num) || 0;
    if (Math.abs(value) < 1_000_000) return formatNumber(value);
    return new Intl.NumberFormat(undefined, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  };

  const formatCost = (cost: number) => {
    return `$${(Number(cost) || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatCompactCost = (cost: number) => {
    const value = Number(cost) || 0;
    if (Math.abs(value) < 100_000) return formatCost(value);
    return `$${new Intl.NumberFormat(undefined, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value)}`;
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-3.5 sm:gap-5">
      {/* 1. Tokens Used */}
      <div className="min-w-0 overflow-hidden bg-surface-card border border-surface-border rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col justify-between space-y-3.5 sm:space-y-4 hover:border-surface-border-light transition-all">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-sans text-xs font-semibold text-text-secondary tracking-wider">
              Total Tokens Used
            </span>
            <span className="text-xs text-amber-accent">✨</span>
          </div>
          <div className="w-8 h-8 rounded-full bg-lavender-accent/15 border border-lavender-accent/30 flex items-center justify-center text-lavender-accent">
            <Zap className="w-4 h-4" />
          </div>
        </div>

        <div>
          <div className="font-sans font-bold text-2xl sm:text-3xl text-text-primary tracking-tight leading-none truncate" title={`${formatNumber(totalTokens)} tokens`}>
            {formatCompactNumber(totalTokens)}
          </div>
          <div className="text-xs text-text-secondary font-medium mt-1">
            All-Time Cumulative
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-mint-accent font-semibold pt-1 border-t border-surface-border/40">
          <ArrowUpRight className="w-3.5 h-3.5" />
          <span>Real-time Tracking</span>
        </div>
      </div>

      {/* 2. Today's Usage */}
      <div className="min-w-0 overflow-hidden bg-surface-card border border-surface-border rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col justify-between space-y-3.5 sm:space-y-4 hover:border-surface-border-light transition-all">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-sans text-xs font-semibold text-text-secondary tracking-wider">
              Today's Usage
            </span>
            <span className="text-xs">📈</span>
          </div>
          <div className="w-8 h-8 rounded-full bg-mint-accent/15 border border-mint-accent/30 flex items-center justify-center text-mint-accent">
            <TrendingUp className="w-4 h-4" />
          </div>
        </div>

        <div>
          <div className="font-sans font-bold text-2xl sm:text-3xl text-text-primary tracking-tight leading-none truncate" title={`${formatNumber(todayTokens)} tokens`}>
            {formatCompactNumber(todayTokens)}
          </div>
          <div className="text-xs text-text-secondary font-medium mt-1">
            {todayUnpricedSessionCount > 0
              ? `Known-model estimate ${formatCost(todayCostUsd)} · ${todayUnpricedSessionCount} unavailable`
              : todayCostUsd > 0 ? `Est. ${formatCost(todayCostUsd)} value` : 'Tokens consumed today'}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-text-secondary font-medium pt-1 border-t border-surface-border/40">
          <span className="px-2.5 py-0.5 bg-surface-container rounded-full text-text-primary text-[11px] font-semibold border border-surface-border">
            Sessions Today: {todaySessions}
          </span>
        </div>
      </div>

      {/* 3. Value Saved */}
      <div className="min-w-0 overflow-hidden bg-surface-card border border-surface-border rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col justify-between space-y-3.5 sm:space-y-4 hover:border-surface-border-light transition-all">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-sans text-xs font-semibold text-text-secondary tracking-wider">
              Value Saved
            </span>
            <span className="text-xs">💰</span>
          </div>
          <div className="w-8 h-8 rounded-full bg-amber-accent/15 border border-amber-accent/30 flex items-center justify-center text-amber-accent">
            <Coins className="w-4 h-4" />
          </div>
        </div>

        <div>
          <div className="font-sans font-bold text-2xl sm:text-3xl text-amber-accent tracking-tight leading-none truncate" title={formatCost(totalCostUsd)}>
            {formatCompactCost(totalCostUsd)}
          </div>
          <div className="text-xs text-text-secondary font-medium mt-1">
            {unpricedSessionCount > 0
              ? `Known models only · ${unpricedSessionCount} unavailable`
              : 'Subscription Equivalent'}
          </div>
        </div>

        <div className="text-xs text-text-secondary font-medium pt-1 border-t border-surface-border/40 truncate">
          Estimated savings vs API costs
        </div>
      </div>

      {/* 4. Active Sessions */}
      <div className="min-w-0 overflow-hidden bg-surface-card border border-surface-border rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col justify-between space-y-3.5 sm:space-y-4 hover:border-surface-border-light transition-all">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-sans text-xs font-semibold text-text-secondary tracking-wider">
              Active Sessions
            </span>
            <span className="text-xs">💬</span>
          </div>
          <div className="w-8 h-8 rounded-full bg-pink-accent/15 border border-pink-accent/30 flex items-center justify-center text-pink-accent">
            <MessageSquare className="w-4 h-4" />
          </div>
        </div>

        <div>
          <div className="font-sans font-bold text-2xl lg:text-3xl text-text-primary tracking-tight">
            {sessionCount}
          </div>
          <div className="text-xs text-text-secondary font-medium mt-1">
            Human Root Conversations
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-text-secondary font-medium pt-1 border-t border-surface-border/40">
          <Laptop className="w-3.5 h-3.5 text-lavender-accent" />
          <span>{deviceCount} Device Synced</span>
        </div>
      </div>
    </div>
  );
};
