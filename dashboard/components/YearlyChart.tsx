'use client';

import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { YearlyStat } from '../lib/types';
import { CustomTooltip } from './CustomTooltip';
import { Calendar, Sparkles, Coins } from 'lucide-react';

interface YearlyChartProps {
  data: YearlyStat[];
}

export const YearlyChart: React.FC<YearlyChartProps> = ({ data }) => {
  const chartData = data.map(d => ({
    year: `${d.year}년`,
    tokens: d.total_tokens,
    cost: Number(d.total_cost_usd || 0),
    sessions: d.session_count
  }));

  const totalTokens = data.reduce((acc, d) => acc + d.total_tokens, 0);
  const totalCost = data.reduce((acc, d) => acc + (d.total_cost_usd || 0), 0);

  return (
    <div className="bg-surface-card border border-surface-border rounded-3xl p-6 shadow-sm flex flex-col justify-between space-y-4 hover:border-surface-border-light transition-all">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border/60 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-surface-container flex items-center justify-center text-lavender-accent border border-surface-border">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text-primary flex items-center gap-1.5">
              Yearly Token Consumption
              <span className="text-xs text-amber-accent">✨</span>
            </h3>
            <p className="text-[11px] text-text-secondary">
              연간 총 토큰 소모량 및 구독 가치 추이
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 bg-surface-container border border-surface-border rounded-full text-xs font-mono font-bold text-amber-accent flex items-center gap-1">
            <Coins className="w-3 h-3" />
            ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 가치
          </span>
          <span className="px-2.5 py-1 bg-surface-container border border-surface-border rounded-full text-xs font-mono text-text-secondary">
            {new Date().getFullYear()}
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="h-64 w-full pt-2">
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-text-secondary text-xs">
            데이터가 없습니다.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="yearlyGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#e6d7ff" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#e6d7ff" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#252424" vertical={false} />
              <XAxis
                dataKey="year"
                stroke="#858384"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: '#313030' }}
              />
              <YAxis
                stroke="#858384"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => (v >= 1000000000 ? `${(v / 1000000000).toFixed(1)}B` : v >= 1000000 ? `${(v / 1000000).toFixed(0)}M` : `${(v / 1000).toFixed(0)}k`)}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="tokens"
                name="토큰 소모량"
                stroke="#e6d7ff"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#yearlyGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};
