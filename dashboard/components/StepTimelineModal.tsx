'use client';

import React, { useEffect, useState } from 'react';
import { Session, Step } from '../lib/types';
import type { DashboardGateway } from '../lib/gateway';
import {
  X,
  User,
  Bot,
  Wrench,
  Zap,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  RotateCcw
} from 'lucide-react';

interface StepTimelineModalProps {
  session: Session | null;
  onClose: () => void;
  gateway: DashboardGateway | null;
}

export const StepTimelineModal: React.FC<StepTimelineModalProps> = ({ session, onClose, gateway }) => {
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const sessionId = session?.id;

  useEffect(() => {
    if (!sessionId) {
      setSteps([]);
      setLoading(false);
      setLoadError('');
      return;
    }

    if (!gateway) {
      setSteps([]);
      setLoading(false);
      setLoadError('로컬 데이터 연결이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    let cancelled = false;
    let settled = false;

    setSteps([]);
    setExpandedSteps({});
    setLoading(true);
    setLoadError('');

    const timeoutId = window.setTimeout(() => {
      if (cancelled || settled) return;
      settled = true;
      setLoading(false);
      setLoadError('작업 기록 조회가 지연되고 있습니다. 다시 시도하면 로컬 데이터에서 새로 조회합니다.');
    }, 8_000);

    gateway.querySteps({ session_id: sessionId, limit: 1_000 })
      .then((data) => {
        if (cancelled || settled) return;
        settled = true;
        setSteps(data);
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled || settled) return;
        settled = true;
        setLoadError(error instanceof Error ? error.message : '작업 기록을 불러오지 못했습니다.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [sessionId, gateway, loadAttempt]);

  useEffect(() => {
    if (!session) return;

    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalStyle;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [session, onClose]);

  if (!session) return null;

  const toggleExpand = (stepId: string) => {
    setExpandedSteps(prev => ({ ...prev, [stepId]: !prev[stepId] }));
  };

  const totalSessionTokens = session.total_tokens || steps.reduce((acc, s) => acc + s.total_tokens, 0) || 1;
  const totalPromptTokens = session.total_prompt_tokens || steps.reduce((acc, s) => acc + s.prompt_tokens, 0);
  const totalCompletionTokens = session.total_completion_tokens || steps.reduce((acc, s) => acc + s.completion_tokens, 0);

  const formatNumber = (n: number) => (n || 0).toLocaleString();
  const formatCompactNumber = (n: number) => Math.abs(n || 0) < 1_000_000
    ? formatNumber(n)
    : new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
  const formatCost = (c: number | null) => c === null
    ? '추정 불가'
    : `$${c.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatTimestamp = (value: string) => {
    const date = new Date(value);
    return Number.isFinite(date.valueOf())
      ? date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
      : value;
  };

  type ContentRole = 'user' | 'assistant' | 'tool';
  type ContentBlock = { role: ContentRole; content: string };

  const parseContentBlocks = (text: string, source: string): ContentBlock[] => {
    const markerPattern = /\*\*\[(사용자 지시|작업 내용 및 결과|도구 실행)\]\*\*/g;
    const matches = Array.from(text.matchAll(markerPattern));
    const roleByLabel: Record<string, ContentRole> = {
      '사용자 지시': 'user',
      '작업 내용 및 결과': 'assistant',
      '도구 실행': 'tool',
    };

    if (matches.length > 0) {
      return matches.flatMap((match, index) => {
        const start = (match.index ?? 0) + match[0].length;
        const end = matches[index + 1]?.index ?? text.length;
        const role = roleByLabel[match[1]];
        return text.slice(start, end)
          .split(/\n\s*---\s*\n/g)
          .map((content) => content.trim())
          .filter(Boolean)
          .map((content) => ({ role, content }));
      });
    }

    if (text.includes('**[서브에이전트 작업:')) {
      const parts = text.split('**[작업 결과]**');
      return [
        { role: 'user', content: parts[0].trim() },
        ...(parts[1]?.trim() ? [{ role: 'assistant' as const, content: parts[1].trim() }] : []),
      ];
    }

    const normalized = text.trim();
    if (!normalized) return [];

    // Backward compatibility for records collected before role markers were persisted.
    if (source === 'turn') {
      const newline = normalized.indexOf('\n');
      if (newline > 0 && newline <= 1_200) {
        const legacyBlocks: ContentBlock[] = [
          { role: 'user', content: normalized.slice(0, newline).trim() },
          { role: 'assistant', content: normalized.slice(newline + 1).trim() },
        ];
        return legacyBlocks.filter((block) => block.content);
      }
      const questionBoundary = /^([\s\S]{1,600}?[?？])\s+([\s\S]+)$/.exec(normalized);
      if (questionBoundary) {
        return [
          { role: 'user', content: questionBoundary[1].trim() },
          { role: 'assistant', content: questionBoundary[2].trim() },
        ];
      }
    }

    return [{ role: source === 'user' ? 'user' : source === 'tool' ? 'tool' : 'assistant', content: normalized }];
  };

  const renderFormattedText = (text: string) => {
    if (!text) return null;
    const chunks = text.split('```');

    return (
      <div className="space-y-2 text-sm text-text-primary leading-6 font-sans break-words">
        {chunks.map((chunk, chunkIndex) => {
          if (chunkIndex % 2 === 1) {
            return (
              <pre
                key={`code_${chunkIndex}`}
                className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-surface-border bg-black/25 px-4 py-3 font-mono text-xs leading-5 text-mint-accent custom-scrollbar"
              >
                <code>{chunk.trim()}</code>
              </pre>
            );
          }

          const readable = chunk
            .replace(/\s+(?=#{1,6}\s)/g, '\n')
            .replace(/\s+(?=(?:[-*•]|\d+\.)\s)/g, '\n');
          return readable.split('\n').map((line, lineIndex) => {
            const key = `text_${chunkIndex}_${lineIndex}`;
            const trimmed = line.trim();
            if (!trimmed) return <div key={key} className="h-1" />;

            if (trimmed === '---') return <hr key={key} className="my-3 border-surface-border/70" />;

            const heading = trimmed.match(/^(#{1,6})\s+(.*)/);
            if (heading) {
              return <h4 key={key} className="pt-2 text-sm font-bold text-text-primary">{formatInline(heading[2])}</h4>;
            }

            if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
              const bulletText = trimmed.slice(2);
              return (
                <div key={key} className="flex items-start gap-2 pl-1.5">
                  <span className="text-lavender-accent text-xs mt-0.5">•</span>
                  <span className="text-text-primary text-sm">{formatInline(bulletText)}</span>
                </div>
              );
            }

            const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
            if (numMatch) {
              return (
                <div key={key} className="flex items-start gap-2 pl-1.5">
                  <span className="font-bold text-lavender-accent text-xs">{numMatch[1]}.</span>
                  <span className="text-text-primary text-sm">{formatInline(numMatch[2])}</span>
                </div>
              );
            }

            return <p key={key} className="text-text-primary text-sm whitespace-pre-wrap">{formatInline(trimmed)}</p>;
          });
        })}
      </div>
    );
  };

  const formatInline = (str: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = str.split(urlRegex);

    return parts.map((part, i) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-lavender-accent hover:underline inline-flex items-center gap-0.5 break-all font-medium"
          >
            <span>{part}</span>
            <ExternalLink className="w-3 h-3 flex-shrink-0 ml-0.5 inline" />
          </a>
        );
      }
      const boldParts = part.split(/(\*\*.*?\*\*)/g);
      return boldParts.map((bp, j) => {
        if (bp.startsWith('**') && bp.endsWith('**')) {
          return <strong key={j} className="text-white font-bold">{bp.slice(2, -2)}</strong>;
        }
        return bp;
      });
    });
  };

  const PASTEL_PALETTE = ['#a7d7c5', '#ffd8e4', '#e6d7ff', '#fbbf24', '#c9c5c6', '#909194'];
  const contentRoleStyle: Record<ContentRole, {
    label: string;
    container: string;
    icon: React.ReactNode;
  }> = {
    user: {
      label: '사용자 요청',
      container: 'border-lavender-accent/35 bg-lavender-accent/[0.06]',
      icon: <User className="w-3.5 h-3.5 text-lavender-accent" />,
    },
    assistant: {
      label: '에이전트 응답',
      container: 'border-pink-accent/30 bg-surface-card',
      icon: <Bot className="w-3.5 h-3.5 text-pink-accent" />,
    },
    tool: {
      label: '도구 실행',
      container: 'border-mint-accent/25 bg-mint-accent/[0.05]',
      icon: <Wrench className="w-3.5 h-3.5 text-mint-accent" />,
    },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 pt-12 sm:pt-16 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 app-no-drag select-text overflow-y-auto custom-scrollbar">
      <div className="bg-surface-card border border-surface-border rounded-3xl w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden mb-8">
        
        {/* ========================================================== */}
        {/* 1. Modal Header matching Image 1 */}
        {/* ========================================================== */}
        <div className="p-4 sm:p-6 border-b border-surface-border/80 bg-surface-card sticky top-0 z-10 space-y-3 sm:space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 max-w-[88%]">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="px-3 py-1 text-xs font-semibold bg-surface-container text-text-primary border border-surface-border rounded-full">
                  대화 상세 리포트
                </span>
                <span className="text-xs font-bold px-3 py-1 bg-white/10 text-text-primary border border-white/30 rounded-full uppercase">
                  {session.agent_type}
                </span>
                {(session.status === 'interrupted' || session.is_interrupted) && (
                  <span className="px-2.5 py-0.5 text-xs font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 rounded-full flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                    중단된 대화
                  </span>
                )}
                {session.status === 'running' && (
                  <span className="px-2.5 py-0.5 text-xs font-bold bg-mint-accent/15 text-mint-accent border border-mint-accent/30 rounded-full flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-mint-accent animate-pulse" />
                    작업 중
                  </span>
                )}
                <span className="text-xs text-text-secondary font-mono">
                  {session.model_name || 'unknown'}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-bold text-text-primary line-clamp-2">
                {session.title || '대화 세션'}
              </h2>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-text-secondary hover:text-text-primary bg-surface-container hover:bg-surface-border rounded-full transition-colors flex-shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 3 KPI Cards matching Image 1 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            {/* Input Tokens */}
            <div className="min-w-0 bg-surface-container border border-surface-border rounded-2xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">총 INPUT 토큰 (프롬프트)</span>
                <div className="text-lg font-bold text-text-primary mt-1 truncate" title={`${formatNumber(totalPromptTokens)} tokens`}>
                  {formatCompactNumber(totalPromptTokens)} <span className="text-xs font-normal text-text-secondary">Tokens</span>
                </div>
              </div>
              <div className="p-2 bg-surface-card rounded-full text-text-secondary">
                <User className="w-4 h-4" />
              </div>
            </div>

            {/* Output Tokens */}
            <div className="min-w-0 bg-surface-container border border-surface-border rounded-2xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">총 OUTPUT 토큰 (생성 답변)</span>
                <div className="text-lg font-bold text-text-primary mt-1 truncate" title={`${formatNumber(totalCompletionTokens)} tokens`}>
                  {formatCompactNumber(totalCompletionTokens)} <span className="text-xs font-normal text-text-secondary">Tokens</span>
                </div>
              </div>
              <div className="p-2 bg-surface-card rounded-full text-text-secondary">
                <Bot className="w-4 h-4" />
              </div>
            </div>

            {/* Total Tokens & Cost */}
            <div className="min-w-0 bg-surface-container border border-surface-border rounded-2xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">대화 총 소모 토큰 & 비용</span>
                <div className="text-lg font-bold text-amber-accent mt-1 truncate" title={`${formatNumber(totalSessionTokens)} tokens · ${formatCost(session.estimated_cost_usd)}`}>
                  {formatCompactNumber(totalSessionTokens)} <span className="text-xs font-normal text-text-secondary">({formatCost(session.estimated_cost_usd)})</span>
                </div>
              </div>
              <div className="p-2 bg-surface-card rounded-full text-amber-accent">
                <Zap className="w-4 h-4" />
              </div>
            </div>
          </div>

          {/* Segmented Pastel Correlation Bar matching Image 1 */}
          <div className="bg-surface-container border border-surface-border rounded-2xl p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs text-text-secondary">
              <span className="flex items-center gap-1.5 font-semibold text-text-primary">
                <Clock className="w-3.5 h-3.5 text-text-secondary" />
                작업 간 토큰 소모 비중 및 상관관계 ({loading ? '확인 중' : `총 ${steps.length}개 작업`})
              </span>
            </div>
            <div className="w-full h-3 bg-surface-card rounded-full flex overflow-hidden border border-surface-border">
              {steps.map((st, idx) => {
                const pct = Math.max(1, Math.round((st.total_tokens / totalSessionTokens) * 100));
                return (
                  <div
                    key={st.id || idx}
                    style={{
                      width: `${pct}%`,
                      backgroundColor: PASTEL_PALETTE[idx % PASTEL_PALETTE.length]
                    }}
                    title={`작업 #${idx + 1}: ${formatNumber(st.total_tokens)} 토큰 (${pct}%)`}
                    className="h-full transition-all hover:opacity-80"
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* ========================================================== */}
        {/* 2. Task Cards matching Image 1 */}
        {/* ========================================================== */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-surface-card">
          {loading ? (
            <div className="py-20 text-center text-text-secondary animate-pulse">
              대화 내 작업 기록을 분석하고 있습니다...
            </div>
          ) : loadError ? (
            <div className="py-20 px-6 text-center" role="alert">
              <AlertCircle className="w-6 h-6 text-rose-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-rose-400">작업 기록을 불러오지 못했습니다</p>
              <p className="text-xs text-text-secondary mt-1">{loadError}</p>
              <button
                type="button"
                onClick={() => setLoadAttempt((attempt) => attempt + 1)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-surface-border bg-surface-container px-4 py-2 text-xs font-bold text-text-primary hover:border-lavender-accent transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                다시 시도
              </button>
            </div>
          ) : steps.length === 0 ? (
            <div className="py-20 text-center text-text-secondary">
              <p className="text-sm font-bold text-text-primary">기록된 세부 작업 내역이 없습니다.</p>
              <p className="mt-1 text-xs">이 세션은 토큰 합계만 저장되어 있어 표시할 작업 본문이 없습니다.</p>
            </div>
          ) : (
            <div className={`relative max-w-3xl mx-auto space-y-6 ${steps.length > 1 ? 'pl-6 sm:pl-8' : ''}`}>
              {steps.map((step, idx) => {
                const stepKey = step.id || `step_${idx}`;
                const isExpanded = expandedSteps[stepKey];
                const dotColor = PASTEL_PALETTE[idx % PASTEL_PALETTE.length];
                const pct = Math.round((step.total_tokens / totalSessionTokens) * 100) || 1;
                const isLast = idx === steps.length - 1;

                const contentBlocks = parseContentBlocks(step.preview_text || '', step.source);
                const isLong = contentBlocks.some((block) => block.content.length > 1_800);
                const displayBlocks = contentBlocks.map((block) => ({
                  ...block,
                  content: isExpanded || block.content.length <= 1_800
                    ? block.content
                    : `${block.content.slice(0, 1_800)}…`,
                }));
                const hasDetail = contentBlocks.length > 0;

                return (
                  <div key={stepKey} className="relative group">
                    {/* Only show timeline node and segment connector if there are multiple steps */}
                    {steps.length > 1 && (
                      <>
                        {/* Connecting line to NEXT step (not rendered on the last step) */}
                        {!isLast && (
                          <div className="absolute -left-[13px] sm:-left-[17px] top-9 -bottom-6 w-0.5 bg-gradient-to-b from-lavender-accent/60 via-pink-accent/40 to-surface-border rounded-full pointer-events-none" />
                        )}

                        {/* Timeline Node on the connecting line */}
                        <div
                          className="absolute -left-6 sm:-left-8 top-5 w-6 h-6 rounded-full bg-surface-card border-2 flex items-center justify-center shadow-sm z-10 transition-transform group-hover:scale-110"
                          style={{ borderColor: dotColor }}
                        >
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: dotColor }}
                          />
                        </div>
                      </>
                    )}

                    {/* Step Content Card */}
                    <div className="bg-surface-container border border-surface-border rounded-3xl p-5 sm:p-6 shadow-sm space-y-4 hover:border-lavender-accent/50 hover:shadow-md transition-all">
                      {/* Top Task Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border/60 pb-3">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-surface-card border border-surface-border text-text-primary shadow-inner">
                            Step #{step.step_index || idx + 1}
                          </span>
                          <span className="text-xs text-text-secondary font-medium">
                            (이 대화의 {pct}% 소모)
                          </span>
                          {step.user_email && step.user_email !== 'unknown' && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-surface-border text-text-secondary bg-surface-card font-mono">
                              {step.user_email}
                            </span>
                          )}
                          <span className="text-[10px] px-2 py-0.5 rounded-full border border-surface-border text-text-secondary bg-surface-card">
                            {step.source} · {step.action_type}
                          </span>
                        </div>

                        {/* Right Tokens Token Receipt */}
                        <div className="text-xs font-mono text-text-secondary flex flex-wrap items-center justify-end gap-x-2 gap-y-1 min-w-0">
                          <span>in: <strong className="text-text-primary">{formatNumber(step.prompt_tokens)}</strong></span>
                          <span>out: <strong className="text-text-primary">{formatNumber(step.completion_tokens)}</strong></span>
                          <span className="font-bold text-amber-accent">총 {formatNumber(step.total_tokens)} 토큰</span>
                        </div>
                      </div>

                      {displayBlocks.length > 0 && (
                        <div className="space-y-3" aria-label="사용자와 에이전트의 대화 흐름">
                          {displayBlocks.map((block, blockIndex) => {
                            const roleStyle = contentRoleStyle[block.role];
                            return (
                              <section
                                key={`${stepKey}_${block.role}_${blockIndex}`}
                                className={`rounded-2xl border p-4 sm:p-5 ${roleStyle.container}`}
                              >
                                <div className="mb-3 flex items-center gap-2 text-xs font-bold text-text-secondary">
                                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-surface-border bg-surface-container">
                                    {roleStyle.icon}
                                  </span>
                                  <span>{roleStyle.label}</span>
                                </div>
                                <div className={block.role === 'tool' ? 'font-mono text-mint-accent' : ''}>
                                  {renderFormattedText(block.content)}
                                </div>
                              </section>
                            );
                          })}
                        </div>
                      )}

                      {!hasDetail && (
                        <div className="rounded-2xl border border-dashed border-surface-border bg-surface-card px-4 py-4 text-sm text-text-secondary">
                          {session.agent_type === 'codex' && session.status === 'running'
                            ? '진행 중인 Codex 작업입니다. 현재까지 저장된 메시지가 아직 없어 완료 후 상세 내용이 채워집니다.'
                            : '원본 기록에는 이 작업의 토큰 합계만 있고 표시할 메시지 본문은 없습니다.'}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-text-secondary">
                        <span>{formatTimestamp(step.timestamp)}</span>
                        {isLong && (
                          <button
                            onClick={() => toggleExpand(stepKey)}
                            className="text-xs text-lavender-accent hover:underline font-bold flex items-center gap-1"
                          >
                            {isExpanded ? <>접기 <ChevronUp className="w-3.5 h-3.5" /></> : <>전체 내용 보기 <ChevronDown className="w-3.5 h-3.5" /></>}
                          </button>
                        )}
                      </div>

                      {/* 4. Interruption Banner if step or session is interrupted */}
                      {(step.action_type === 'interrupted' || step.is_interrupted || (idx === steps.length - 1 && (session.status === 'interrupted' || session.is_interrupted))) && (
                        <div className="flex items-center gap-2.5 p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-400 text-xs font-semibold animate-in fade-in">
                          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                          <span>사용자에 의해 AI 작업 생성이 중간에 중단(Interrupted)되었습니다.</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-border bg-surface-card flex items-center justify-between">
          <span className="text-xs text-text-secondary">
            대화 내 각 작업의 Input/Output 토큰과 작업 상관관계가 실시간으로 집계됩니다.
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-surface-container hover:bg-surface-border text-text-primary text-xs font-bold rounded-full transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
