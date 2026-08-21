'use client';

import React, { useEffect, useState } from 'react';
import { Session, Step } from '../lib/types';
import { fetchSteps } from '../lib/supabase';
import {
  X,
  User,
  Bot,
  Wrench,
  Zap,
  Laptop,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Sparkles,
  AlertCircle
} from 'lucide-react';

interface StepTimelineModalProps {
  session: Session | null;
  onClose: () => void;
}

export const StepTimelineModal: React.FC<StepTimelineModalProps> = ({ session, onClose }) => {
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!session) return;

    // 1. Lock background scrolling
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';

    // 2. Fetch steps
    setLoading(true);
    fetchSteps(session.id).then(data => {
      setSteps(data);
      setLoading(false);
    });

    // 3. Handle ESC key to close
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
  const formatCost = (c: number) => `$${(Number(c) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const parseSections = (text: string) => {
    let userPrompt = '';
    let toolSummary = '';
    let aiSummary = text;

    if (text.includes('**[사용자 지시]**') && text.includes('**[작업 내용 및 결과]**')) {
      const parts = text.split('**[작업 내용 및 결과]**');
      const userPart = parts[0].replace('**[사용자 지시]**', '').trim();
      aiSummary = parts[1] ? parts[1].trim() : '';

      if (userPart.includes('🛠️')) {
        const uSplit = userPart.split('🛠️');
        userPrompt = uSplit[0].trim();
        toolSummary = '🛠️' + uSplit[1].trim();
      } else {
        userPrompt = userPart;
      }
    } else if (text.includes('**[서브에이전트 작업:')) {
      const parts = text.split('**[작업 결과]**');
      userPrompt = parts[0].trim();
      aiSummary = parts[1] ? parts[1].trim() : '';
    } else if (text.includes('**[사용자 지시]**')) {
      userPrompt = text.replace('**[사용자 지시]**', '').trim();
      aiSummary = '';
    }

    return { userPrompt, toolSummary, aiSummary };
  };

  const renderFormattedText = (text: string) => {
    if (!text) return null;
    const lines = text.split('\n');

    return (
      <div className="space-y-1.5 text-xs text-text-primary leading-relaxed font-sans">
        {lines.map((line, idx) => {
          const trimmed = line.trim();
          if (!trimmed) return <div key={idx} className="h-1" />;

          if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            const bText = trimmed.slice(2);
            return (
              <div key={idx} className="flex items-start gap-1.5 pl-1.5">
                <span className="text-lavender-accent text-xs mt-0.5">•</span>
                <span className="text-text-primary text-xs">{formatInline(bText)}</span>
              </div>
            );
          }

          const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
          if (numMatch) {
            return (
              <div key={idx} className="flex items-start gap-1.5 pl-1.5">
                <span className="font-bold text-lavender-accent text-xs">{numMatch[1]}.</span>
                <span className="text-text-primary text-xs">{formatInline(numMatch[2])}</span>
              </div>
            );
          }

          return <p key={idx} className="text-text-primary text-xs">{formatInline(trimmed)}</p>;
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-surface-card border border-surface-border rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            {/* Input Tokens */}
            <div className="bg-surface-container border border-surface-border rounded-2xl p-4 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">총 INPUT 토큰 (프롬프트)</span>
                <div className="text-base sm:text-lg font-bold text-text-primary mt-1">
                  {formatNumber(totalPromptTokens)} <span className="text-xs font-normal text-text-secondary">Tokens</span>
                </div>
              </div>
              <div className="p-2 bg-surface-card rounded-full text-text-secondary">
                <User className="w-4 h-4" />
              </div>
            </div>

            {/* Output Tokens */}
            <div className="bg-surface-container border border-surface-border rounded-2xl p-4 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">총 OUTPUT 토큰 (생성 답변)</span>
                <div className="text-base sm:text-lg font-bold text-text-primary mt-1">
                  {formatNumber(totalCompletionTokens)} <span className="text-xs font-normal text-text-secondary">Tokens</span>
                </div>
              </div>
              <div className="p-2 bg-surface-card rounded-full text-text-secondary">
                <Bot className="w-4 h-4" />
              </div>
            </div>

            {/* Total Tokens & Cost */}
            <div className="bg-surface-container border border-surface-border rounded-2xl p-4 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">대화 총 소모 토큰 & 비용</span>
                <div className="text-base sm:text-lg font-bold text-amber-accent mt-1">
                  {formatNumber(totalSessionTokens)} <span className="text-xs font-normal text-text-secondary">({formatCost(session.estimated_cost_usd)})</span>
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
                작업 간 토큰 소모 비중 및 상관관계 (총 {steps.length}개 작업)
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
          ) : steps.length === 0 ? (
            <div className="py-20 text-center text-text-secondary">
              기록된 세부 작업 내역이 없습니다.
            </div>
          ) : (
            <div className={`relative max-w-3xl mx-auto space-y-6 ${steps.length > 1 ? 'pl-6 sm:pl-8' : ''}`}>
              {steps.map((step, idx) => {
                const stepKey = step.id || `step_${idx}`;
                const isExpanded = expandedSteps[stepKey];
                const dotColor = PASTEL_PALETTE[idx % PASTEL_PALETTE.length];
                const pct = Math.round((step.total_tokens / totalSessionTokens) * 100) || 1;
                const isLast = idx === steps.length - 1;

                const { userPrompt, toolSummary, aiSummary } = parseSections(step.preview_text || '');
                const isLong = (aiSummary && aiSummary.length > 300) || (userPrompt && userPrompt.length > 300);
                const displayAi = isExpanded ? aiSummary : (isLong ? `${aiSummary.slice(0, 300)}...` : aiSummary);

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
                        <div className="flex items-center gap-2 flex-wrap">
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
                        </div>

                        {/* Right Tokens Token Receipt */}
                        <div className="text-xs font-mono text-text-secondary flex items-center gap-2">
                          <span>in: <strong className="text-text-primary">{formatNumber(step.prompt_tokens)}</strong></span>
                          <span>out: <strong className="text-text-primary">{formatNumber(step.completion_tokens)}</strong></span>
                          <span className="font-bold text-amber-accent">총 {formatNumber(step.total_tokens)} 토큰</span>
                        </div>
                      </div>

                      {/* 1. 요청 / 지시 내용 */}
                      {userPrompt && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
                            <User className="w-3.5 h-3.5 text-lavender-accent" />
                            <span>요청 / 지시 내용</span>
                          </div>
                          <div className="bg-surface-card border border-surface-border rounded-2xl p-4 text-text-primary text-xs leading-relaxed">
                            {renderFormattedText(userPrompt)}
                          </div>
                        </div>
                      )}

                      {/* 2. 도구 실행 */}
                      {toolSummary && (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-surface-card border border-surface-border rounded-full text-xs font-mono text-mint-accent">
                          <Wrench className="w-3.5 h-3.5 text-amber-accent" />
                          <span>{toolSummary}</span>
                        </div>
                      )}

                      {/* 3. AI 작업 결과 */}
                      {displayAi && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
                            <Bot className="w-3.5 h-3.5 text-pink-accent" />
                            <span>작업 내용 및 결과</span>
                          </div>
                          <div className="bg-surface-card border border-surface-border rounded-2xl p-4 text-text-primary text-xs leading-relaxed">
                            {renderFormattedText(displayAi)}
                            {isLong && (
                              <button
                                onClick={() => toggleExpand(stepKey)}
                                className="mt-2.5 text-xs text-lavender-accent hover:underline font-bold flex items-center gap-1"
                              >
                                {isExpanded ? <>접기 <ChevronUp className="w-3.5 h-3.5" /></> : <>전체 내용 보기 <ChevronDown className="w-3.5 h-3.5" /></>}
                              </button>
                            )}
                          </div>
                        </div>
                      )}

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
