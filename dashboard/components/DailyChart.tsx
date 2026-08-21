'use client';

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { DailyStat } from '../lib/types';
import { CustomTooltip } from './CustomTooltip';
import { TrendingUp, Coins, Zap } from 'lucide-react';

interface DailyChartProps {
  data: DailyStat[];
}

export const DailyChart: React.FC<DailyChartProps> = ({ data }) => {
  // Deduplicate by date
  const dayMap: Record<string, { date: string; tokens: number; cost: number; sessions: number }> = {};

  data.forEach(d => {
    const dStr = d.date; // YYYY-MM-DD
    const dLabel = `${parseInt(dStr.slice(5, 7), 10)}/${parseInt(dStr.slice(8, 10), 10)}`; // e.g. "8/14"
    if (!dayMap[dStr]) {
      dayMap[dStr] = {
        date: dLabel,
        tokens: 0,
        cost: 0,
        sessions: 0
      };
    }
    dayMap[dStr].tokens += Number(d.total_tokens) || 0;
    dayMap[dStr].cost += Number(d.total_cost_usd) || 0;
    dayMap[dStr].sessions += Number(d.session_count) || 0;
  });

  const chartData = Object.keys(dayMap)
    .sort()
    .slice(-14)
    .map(key => dayMap[key]);

  const totalTokens = chartData.reduce((acc, d) => acc + d.tokens, 0);
  const totalCost = chartData.reduce((acc, d) => acc + d.cost, 0);

  return (
    <div className="bg-surface-card border border-surface-border rounded-3xl p-6 shadow-sm flex flex-col justify-between space-y-4 hover:border-surface-border-light transition-all">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border/60 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-surface-container flex items-center justify-center text-mint-accent border border-surface-border">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text-primary flex items-center gap-1.5">
              Daily Activity
              <span className="text-xs">📈</span>
            </h3>
            <p className="text-[11px] text-text-secondary">
              최근 14일 일자별 토큰 소비량 및 환산 가치
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
      <div className="h-60 w-full pt-2">
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-text-secondary text-xs">
            데이터가 없습니다.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#252424" vertical={false} />
              <XAxis
                dataKey="date"
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
              <Line
                type="monotone"
                dataKey="tokens"
                name="일일 토큰"
                stroke="#a7d7c5"
                strokeWidth={3}
                dot={{ r: 3.5, fill: '#a7d7c5', strokeWidth: 0 }}
                activeDot={{ r: 6, fill: '#ffffff' }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};
