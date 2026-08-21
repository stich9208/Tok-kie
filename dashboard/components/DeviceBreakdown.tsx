'use client';

import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { Session } from '../lib/types';
import { CustomTooltip } from './CustomTooltip';
import { Laptop, Bot, User } from 'lucide-react';

interface DeviceBreakdownProps {
  sessions: Session[];
}

export const DeviceBreakdown: React.FC<DeviceBreakdownProps> = ({ sessions }) => {
  // 1. Group by Device
  const deviceMap: Record<string, number> = {};
  // 2. Group by Account (Email)
  const accountMap: Record<string, number> = {};
  // 3. Group by Agent
  const agentMap: Record<string, number> = {};

  sessions.forEach(s => {
    const dev = s.device_name || 'MacBook Pro';
    const acc = s.user_email && s.user_email !== 'unknown' ? s.user_email : 'Unknown Account';
    const agent = s.agent_type || 'other';

    deviceMap[dev] = (deviceMap[dev] || 0) + (s.total_tokens || 0);
    accountMap[acc] = (accountMap[acc] || 0) + (s.total_tokens || 0);
    agentMap[agent] = (agentMap[agent] || 0) + (s.total_tokens || 0);
  });

  const deviceData = Object.entries(deviceMap).map(([name, value]) => ({ name, value }));
  const accountData = Object.entries(accountMap).map(([name, value]) => ({ name, value }));
  const agentData = Object.entries(agentMap).map(([name, value]) => ({ name, value }));

  const PASTEL_COLORS = ['#e6d7ff', '#a7d7c5', '#fbbf24', '#ffd8e4', '#c9c5c6', '#bae6fd', '#fed7aa'];

  const totalTokens = sessions.reduce((acc, s) => acc + (s.total_tokens || 0), 0);
  
  const sortedDevices = [...deviceData].sort((a, b) => b.value - a.value);
  const topDevice = sortedDevices[0]?.name || '-';
  const topDevicePct = totalTokens > 0 && sortedDevices[0] ? Math.round((sortedDevices[0].value / totalTokens) * 100) : 0;

  const sortedAccounts = [...accountData].sort((a, b) => b.value - a.value);
  const topAccount = sortedAccounts[0]?.name || '-';
  const topAccountPct = totalTokens > 0 && sortedAccounts[0] ? Math.round((sortedAccounts[0].value / totalTokens) * 100) : 0;

  const sortedAgents = [...agentData].sort((a, b) => b.value - a.value);
  const topAgent = sortedAgents[0]?.name || '-';
  const topAgentPct = totalTokens > 0 && sortedAgents[0] ? Math.round((sortedAgents[0].value / totalTokens) * 100) : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-5">
      {/* 1. Device Share */}
      <div className="bg-surface-card border border-surface-border rounded-3xl p-5 shadow-sm flex flex-col justify-between space-y-3 hover:border-surface-border-light transition-all">
        <div className="flex items-center justify-between border-b border-surface-border/60 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-surface-container flex items-center justify-center text-lavender-accent border border-surface-border">
              <Laptop className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary">Device Share</h3>
              <p className="text-[11px] text-text-secondary">기기별 토큰 점유율</p>
            </div>
          </div>
        </div>

        <div className="h-44 w-full relative flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <Tooltip content={<CustomTooltip />} />
              <Pie
                data={deviceData}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={58}
                paddingAngle={3}
                dataKey="value"
              >
                {deviceData.map((_, index) => (
                  <Cell key={`cell-dev-${index}`} fill={PASTEL_COLORS[index % PASTEL_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute flex flex-col items-center justify-center pointer-events-none text-center px-1">
            <span className="font-sans font-bold text-base text-text-primary">{topDevicePct}%</span>
            <span className="text-[10px] text-text-secondary truncate max-w-[80px]">{topDevice}</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-xs text-text-secondary min-h-[28px]">
          {deviceData.map((d, i) => (
            <div key={d.name} className="flex items-center gap-1.5" title={d.name}>
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PASTEL_COLORS[i % PASTEL_COLORS.length] }} />
              <span className="truncate max-w-[95px] text-[11px]">{d.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Account Share (Multi-Account) */}
      <div className="bg-surface-card border border-surface-border rounded-3xl p-5 shadow-sm flex flex-col justify-between space-y-3 hover:border-surface-border-light transition-all">
        <div className="flex items-center justify-between border-b border-surface-border/60 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-surface-container flex items-center justify-center text-mint-accent border border-surface-border">
              <User className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary">Account Share</h3>
              <p className="text-[11px] text-text-secondary">계정(이메일)별 사용 비중</p>
            </div>
          </div>
        </div>

        <div className="h-44 w-full relative flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <Tooltip content={<CustomTooltip />} />
              <Pie
                data={accountData}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={58}
                paddingAngle={3}
                dataKey="value"
              >
                {accountData.map((_, index) => (
                  <Cell key={`cell-acc-${index}`} fill={PASTEL_COLORS[(index + 2) % PASTEL_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute flex flex-col items-center justify-center pointer-events-none text-center px-1">
            <span className="font-sans font-bold text-base text-text-primary">{topAccountPct}%</span>
            <span className="text-[10px] text-mint-accent font-mono truncate max-w-[80px]">{topAccount}</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-xs text-text-secondary min-h-[28px]">
          {accountData.map((acc, i) => (
            <div key={acc.name} className="flex items-center gap-1.5" title={acc.name}>
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PASTEL_COLORS[(i + 2) % PASTEL_COLORS.length] }} />
              <span className="truncate max-w-[105px] font-mono text-[11px]">{acc.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Agent Share */}
      <div className="bg-surface-card border border-surface-border rounded-3xl p-5 shadow-sm flex flex-col justify-between space-y-3 hover:border-surface-border-light transition-all">
        <div className="flex items-center justify-between border-b border-surface-border/60 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-surface-container flex items-center justify-center text-amber-accent border border-surface-border">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary">Agent Share</h3>
              <p className="text-[11px] text-text-secondary">에이전트별 토큰 사용 비중</p>
            </div>
          </div>
        </div>

        <div className="h-44 w-full relative flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <Tooltip content={<CustomTooltip />} />
              <Pie
                data={agentData}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={58}
                paddingAngle={3}
                dataKey="value"
              >
                {agentData.map((_, index) => (
                  <Cell key={`cell-agent-${index}`} fill={PASTEL_COLORS[(index + 4) % PASTEL_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute flex flex-col items-center justify-center pointer-events-none text-center px-1">
            <span className="font-serif font-bold text-sm text-text-primary capitalize truncate max-w-[80px]">{topAgent}</span>
            <span className="text-[10px] text-amber-accent font-mono font-bold">{topAgentPct}%</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-xs text-text-secondary min-h-[28px]">
          {agentData.map((a, i) => (
            <div key={a.name} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PASTEL_COLORS[(i + 4) % PASTEL_COLORS.length] }} />
              <span className="capitalize text-[11px]">{a.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
