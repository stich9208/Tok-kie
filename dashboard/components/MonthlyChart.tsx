'use client';

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { MonthlyStat } from '../lib/types';
import { CustomTooltip } from './CustomTooltip';
import { BarChart3, Coins, Zap } from 'lucide-react';

interface MonthlyChartProps {
  data: MonthlyStat[];
}

export const MonthlyChart: React.FC<MonthlyChartProps> = ({ data }) => {
  // Aggregate deduplicated by month in ascending order
  const monthMap: Record<string, { month: string; tokens: number; cost: number; sessions: number }> = {};

  data.forEach(d => {
    const mStr = d.month; // YYYY-MM
    const mLabel = `${parseInt(mStr.slice(5), 10)}월`; // e.g. "8월"
    if (!monthMap[mStr]) {
      monthMap[mStr] = {
        month: mLabel,
        tokens: 0,
        cost: 0,
        sessions: 0
      };
    }
    monthMap[mStr].tokens += Number(d.total_tokens) || 0;
    monthMap[mStr].cost += Number(d.total_cost_usd) || 0;
    monthMap[mStr].sessions += Number(d.session_count) || 0;
  });

  const chartData = Object.keys(monthMap)
    .sort()
    .map(key => monthMap[key]);

  const totalTokens = chartData.reduce((acc, d) => acc + d.tokens, 0);
  const totalCost = chartData.reduce((acc, d) => acc + d.cost, 0);

  return (
    <div className="bg-surface-card border border-surface-border rounded-3xl p-6 shadow-sm flex flex-col justify-between space-y-4 hover:border-surface-border-light transition-all">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border/60 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-surface-container flex items-center justify-center text-mint-accent border border-surface-border">
            <BarChart3 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text-primary flex items-center gap-1.5">
              Monthly Usage Trends
              <span className="text-xs">📊</span>
            </h3>
            <p className="text-[11px] text-text-secondary">
              월별 토큰 소비량 및 환산 구독 가치 종합
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 bg-surface-container border border-surface-border rounded-full text-xs font-mono font-bold text-amber-accent flex items-center gap-1">
            <Coins className="w-3 h-3" />
            ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 가치
          </span>
          <span className="px-2.5 py-1 bg-surface-container border border-surface-border rounded-full text-xs font-mono font-bold text-mint-accent flex items-center gap-1">
            <Zap className="w-3 h-3" />
            {totalTokens >= 1000000000 ? `${(totalTokens / 1000000000).toFixed(1)}B` : `${(totalTokens / 1000000).toFixed(1)}M`}
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
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#252424" vertical={false} />
              <XAxis
                dataKey="month"
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
              <Bar
                dataKey="tokens"
                name="월간 토큰"
                fill="#a7d7c5"
                radius={[8, 8, 0, 0]}
                barSize={36}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};
