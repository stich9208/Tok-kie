'use client';

import React, { useState } from 'react';
import { Session } from '../lib/types';
import {
  Laptop,
  Calendar,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Clock,
  Sparkles,
  Bot,
  Zap,
  ArrowRight
} from 'lucide-react';

interface SessionTableProps {
  sessions: Session[];
  onSelectSession: (session: Session) => void;
  selectedAgent?: string;
  onSelectAgent?: (agent: string) => void;
}

export const SessionTable: React.FC<SessionTableProps> = ({
  sessions,
  onSelectSession,
  selectedAgent = 'All',
  onSelectAgent
}) => {
  const [viewType, setViewType] = useState<'table' | 'timeline'>('table');
  const [localAgent, setLocalAgent] = useState<string>(selectedAgent);
  const [showFilterBar, setShowFilterBar] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = viewType === 'table' ? 6 : 4;

  const currentAgent = onSelectAgent ? selectedAgent : localAgent;
  const handleAgentChange = (agent: string) => {
    if (onSelectAgent) {
      onSelectAgent(agent);
    } else {
      setLocalAgent(agent);
    }
    setPage(1);
  };

  // Local filter if not managed globally
  const displayedSessions = onSelectAgent
    ? sessions
    : sessions.filter((s) => currentAgent === 'All' || s.agent_type === currentAgent);

  const totalPages = Math.ceil(displayedSessions.length / pageSize) || 1;
  const paginatedSessions = displayedSessions.slice((page - 1) * pageSize, page * pageSize);

  const agentTabs = [
    { id: 'All', label: 'All Agents' },
    { id: 'antigravity', label: 'Antigravity' },
    { id: 'codex', label: 'Codex' },
    { id: 'claude_code', label: 'Claude Code' },
  ];

  const getAgentBadge = (agent: string) => {
    switch ((agent || '').toLowerCase()) {
      case 'antigravity':
        return 'bg-lavender-accent/15 text-lavender-accent border-lavender-accent/40';
      case 'claude_code':
        return 'bg-amber-accent/15 text-amber-accent border-amber-accent/40';
      case 'codex':
        return 'bg-mint-accent/15 text-mint-accent border-mint-accent/40';
      default:
        return 'bg-pink-accent/15 text-pink-accent border-pink-accent/40';
    }
  };

  const formatDate = (iso: any) => {
    if (!iso) return '-';
    try {
      let d: Date;
      if (typeof iso === 'number') {
        const ms = iso < 10000000000 ? iso * 1000 : iso;
        d = new Date(ms);
      } else {
        d = new Date(iso);
      }
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return String(iso);
    }
  };

  const formatFullDate = (iso: any) => {
    if (!iso) return '-';
    try {
      let d: Date;
      if (typeof iso === 'number') {
        const ms = iso < 10000000000 ? iso * 1000 : iso;
        d = new Date(ms);
      } else {
        d = new Date(iso);
      }
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleString('ko-KR', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return String(iso);
    }
  };

  const formatTokens = (n: number) => (n || 0).toLocaleString();
  const formatCost = (c: number | null) => c === null
    ? '추정 불가'
    : `$${c.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6 w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="space-y-1">
          <h2 className="font-serif font-bold text-2xl sm:text-3xl lg:text-4xl text-text-primary tracking-tight">
            Session History
          </h2>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-surface-container border border-surface-border rounded-full text-xs font-semibold text-text-primary">
            <span className="w-2 h-2 rounded-full bg-mint-accent animate-pulse" />
            <span>Live Tracking</span>
          </div>
        </div>

        {/* View Toggle, Agent Chips & Filter */}
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {/* Agent Filter Chips */}
          <div className="bg-surface-container border border-surface-border rounded-full p-1 flex items-center shadow-inner overflow-x-auto max-w-full">
            {agentTabs.map((tab) => {
              const isSelected = currentAgent === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleAgentChange(tab.id)}
                  className={`px-3 py-1 sm:px-3.5 sm:py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                    isSelected
                      ? 'bg-surface-card text-text-primary shadow-sm border border-surface-border/50'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* View Toggle */}
          <div className="bg-surface-container border border-surface-border rounded-full p-1 flex items-center shadow-inner">
            <button
              onClick={() => { setViewType('table'); setPage(1); }}
              className={`px-3.5 py-1 sm:px-4 sm:py-1.5 rounded-full text-xs font-bold transition-all ${
                viewType === 'table' ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => { setViewType('timeline'); setPage(1); }}
              className={`px-3.5 py-1 sm:px-4 sm:py-1.5 rounded-full text-xs font-bold transition-all ${
                viewType === 'timeline' ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Timeline
            </button>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="bg-surface-card border border-surface-border rounded-3xl p-4 sm:p-7 shadow-sm space-y-4 w-full">
        {viewType === 'table' ? (
          /* Table View - Smooth horizontal scroll on mobile */
          <div className="w-full overflow-x-auto scrollbar-none">
            <table className="w-full min-w-[580px] table-fixed text-left text-xs">
              <thead>
                <tr className="text-text-secondary uppercase tracking-wider font-semibold border-b border-surface-border/80 pb-3">
                  <th className="py-3 px-3 font-sans text-[11px] w-[38%]">Session Details</th>
                  <th className="py-3 px-3 font-sans text-[11px] w-[18%]">Agent & Model</th>
                  <th className="py-3 px-3 font-sans text-[11px] w-[16%]">Source Device</th>
                  <th className="py-3 px-3 text-right font-sans text-[11px] w-[14%]">Tokens Used</th>
                  <th className="py-3 px-3 text-right font-sans text-[11px] w-[14%]">Total Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border/40">
                {paginatedSessions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-16 text-center text-text-secondary">
                      수집된 대화 세션이 없습니다.
                    </td>
                  </tr>
                ) : (
                  paginatedSessions.map((session) => (
                    <tr
                      key={session.id}
                      onClick={() => onSelectSession(session)}
                      className="hover:bg-surface-container/60 cursor-pointer transition-colors group"
                    >
                      <td className="py-3.5 px-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-sm text-text-primary group-hover:text-lavender-accent transition-colors truncate">
                            {session.title || 'Conversation Session'}
                          </span>
                          {(session.status === 'interrupted' || session.is_interrupted) && (
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30 flex-shrink-0 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                              중단됨
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-text-secondary font-mono truncate max-w-[160px]">
                            ID: {session.id}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="flex flex-col items-start gap-1">
                          <span className={`px-2.5 py-0.5 text-[10px] font-bold border rounded-full uppercase truncate max-w-full ${getAgentBadge(session.agent_type)}`}>
                            {session.agent_type === 'codex' ? 'Codex' : session.agent_type}
                          </span>
                          <span className="text-[11px] text-text-secondary font-mono truncate max-w-full">
                            {session.model_name || 'unknown'}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <Laptop className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate max-w-full font-medium">{session.device_name || 'Unknown Device'}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        <div className="font-mono font-bold text-text-primary text-sm">{formatTokens(session.total_tokens)}</div>
                        <div className="text-[11px] text-text-secondary font-mono">In: {formatTokens(session.total_prompt_tokens)} / Out: {formatTokens(session.total_completion_tokens)}</div>
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        <div className="font-mono font-bold text-amber-accent text-sm">{formatCost(session.estimated_cost_usd)}</div>
                        <div className="text-[11px] text-text-secondary flex items-center justify-end gap-1">
                          <Calendar className="w-3 h-3 text-text-secondary" />
                          <span>{formatDate(session.started_at)}</span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-2 space-y-4">
            {paginatedSessions.length === 0 ? (
              <div className="py-16 text-center text-text-secondary">수집된 대화 세션이 없습니다.</div>
            ) : (
              <div className="relative pl-6 sm:pl-8 before:absolute before:left-2.5 sm:before:left-3.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-surface-border space-y-4">
                {paginatedSessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => onSelectSession(session)}
                    className="relative bg-surface-container/70 hover:bg-surface-container border border-surface-border hover:border-surface-border-light rounded-2xl p-4 sm:p-5 transition-all cursor-pointer group shadow-sm"
                  >
                    <div className={`absolute -left-[27px] sm:-left-[31px] top-5 w-4 h-4 rounded-full bg-surface-card border-2 transition-transform group-hover:scale-125 ${
                      session.status === 'interrupted' || session.is_interrupted
                        ? 'border-rose-400'
                        : 'border-lavender-accent'
                    }`} />
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-2.5 py-0.5 text-[10px] font-bold border rounded-full uppercase ${getAgentBadge(session.agent_type)}`}>
                            {session.agent_type === 'codex' ? 'Codex' : session.agent_type}
                          </span>
                          {(session.status === 'interrupted' || session.is_interrupted) && (
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                              중단됨
                            </span>
                          )}
                          <span className="text-xs text-text-secondary font-mono">{session.model_name || 'unknown'}</span>
                          {session.user_email && session.user_email !== 'unknown' && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-surface-border text-text-secondary bg-surface-card font-mono">{session.user_email}</span>
                          )}
                          <span className="text-xs text-text-secondary flex items-center gap-1">
                            <Clock className="w-3 h-3 text-text-secondary" />
                            {formatFullDate(session.started_at)}
                          </span>
                        </div>
                        <h3 className="font-bold text-sm sm:text-base text-text-primary group-hover:text-lavender-accent transition-colors truncate">
                          {session.title || 'Conversation Session'}
                        </h3>
                        <div className="flex items-center gap-4 text-xs text-text-secondary">
                          <div className="flex items-center gap-1.5">
                            <Laptop className="w-3.5 h-3.5" />
                            <span>{session.device_name}</span>
                          </div>
                          <span className="font-mono text-[11px]">ID: {session.id.slice(0, 18)}...</span>
                        </div>
                      </div>

                      {/* Right: Metrics */}
                      <div className="flex items-center sm:flex-col sm:items-end justify-between sm:justify-center border-t sm:border-t-0 pt-2 sm:pt-0 border-surface-border/50 gap-1 flex-shrink-0">
                        <div className="text-right">
                          <div className="font-bold text-sm sm:text-base text-amber-accent font-sans">
                            {formatCost(session.estimated_cost_usd)}
                          </div>
                          <div className="text-xs text-text-secondary font-mono">
                            {formatTokens(session.total_tokens)} tokens
                          </div>
                        </div>
                        <div className="text-[11px] text-lavender-accent font-semibold flex items-center gap-1 sm:mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span>상세 보기</span>
                          <ArrowRight className="w-3 h-3" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer Pagination */}
        <div className="flex items-center justify-between pt-4 border-t border-surface-border/60 text-xs text-text-secondary">
          <div>
            Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, sessions.length)} of {sessions.length} sessions
          </div>

          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="w-8 h-8 rounded-full bg-surface-container hover:bg-surface-border disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-text-primary transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 font-mono text-[11px]">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="w-8 h-8 rounded-full bg-surface-container hover:bg-surface-border disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-text-primary transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
