'use client';

import React, { useCallback, useState, useEffect } from 'react';
import type { Session } from '../lib/types';
import { aggregateSessions } from '../lib/analytics';
import { createDashboardGateway, type DashboardGateway } from '../lib/gateway';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { KpiCards } from '../components/KpiCards';
import { YearlyChart } from '../components/YearlyChart';
import { MonthlyChart } from '../components/MonthlyChart';
import { DailyChart } from '../components/DailyChart';
import { DeviceBreakdown } from '../components/DeviceBreakdown';
import { SessionTable } from '../components/SessionTable';
import { StepTimelineModal } from '../components/StepTimelineModal';
import { SupabaseModal } from '../components/SupabaseModal';
import { MobilePairingModal } from '../components/MobilePairingModal';

export default function DashboardPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [gateway, setGateway] = useState<DashboardGateway | null>(null);
  const [cloudConfigured, setCloudConfigured] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSupabaseOpen, setIsSupabaseOpen] = useState(false);
  const [isMobilePairingOpen, setIsMobilePairingOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState('All');
  const [selectedAccount, setSelectedAccount] = useState('All');
  const [selectedAgent, setSelectedAgent] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const closeSelectedSession = useCallback(() => setSelectedSession(null), []);

  useEffect(() => {
    setGateway(createDashboardGateway());
  }, []);

  // Fetch data with visibility awareness and smooth background refresh.
  useEffect(() => {
    if (!gateway) return;
    let cancelled = false;

    async function load(isInitial = false) {
      if (isInitial) setLoading(true);
      try {
        const data = await gateway!.querySessions({ include_archived: false });
        if (cancelled) return;
        setSessions(data);
        setLoadError('');
        if (gateway!.kind === 'web') setCloudConfigured(true);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : '데이터를 불러오지 못했습니다.');
      } finally {
        if (!cancelled && isInitial) setLoading(false);
      }
    }

    load(true);

    if (gateway.capabilities.cloudSettings) {
      gateway.getCloudSettings()
        .then((settings) => {
          if (!cancelled) setCloudConfigured(settings.configured);
        })
        .catch(() => {
          if (!cancelled) setCloudConfigured(false);
        });
    }

    const interval = setInterval(() => {
      // Only poll when window / tab is active to save CPU and battery
      if (typeof document !== 'undefined' && !document.hidden) {
        load(false);
      }
    }, 12000);

    // Refresh immediately when window becomes visible again
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        load(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [gateway, refreshNonce]);

  // Filter sessions
  const filteredSessions = sessions.filter((s) => {
    const matchDev = selectedDevice === 'All' || s.device_name === selectedDevice;
    const matchAccount = selectedAccount === 'All' || s.user_email === selectedAccount;
    const matchAgent = selectedAgent === 'All' || s.agent_type === selectedAgent;
    const matchQuery =
      !searchTerm ||
      (s.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.id || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.model_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.user_email || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchDev && matchAccount && matchAgent && matchQuery;
  });

  // Aggregated data
  const { dailyStats, monthlyStats, yearlyStats, totalTokens, totalCostUsd, unpricedSessions } =
    aggregateSessions(filteredSessions);

  // Precise Today (KST) usage calculation
  const todayKst = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const todaySessionsList = filteredSessions.filter((s) => {
    try {
      const d = new Date(s.started_at);
      if (isNaN(d.getTime())) return false;
      const kstDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
      return kstDate === todayKst;
    } catch {
      return false;
    }
  });

  const todayTokens = todaySessionsList.reduce((acc, s) => acc + (Number(s.total_tokens) || 0), 0);
  const todayCostUsd = todaySessionsList.reduce((acc, s) => acc + (Number(s.estimated_cost_usd) || 0), 0);
  const todayUnpricedSessions = todaySessionsList.filter((session) => session.estimated_cost_usd === null).length;
  const todaySessionsCount = todaySessionsList.length;

  const deviceList = Array.from(
    new Set(sessions.map((s) => s.device_name).filter(Boolean))
  );

  const accountList = Array.from(
    new Set(sessions.map((s) => s.user_email || 'unknown'))
  );

  const agentList = Array.from(
    new Set(sessions.map((s) => s.agent_type).filter(Boolean))
  );

  return (
    <div className="h-screen bg-canvas text-text-primary flex overflow-hidden">
      {/* 1. Left Collapsible Sidebar (Desktop sticky, Mobile drawer) */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        sessionCount={filteredSessions.length}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        isMobileOpen={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      {/* 2. Main Canvas */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden transition-all duration-300">
        {/* Sticky Header with Global Controls & Light/Dark Theme Switcher */}
        <Header
          selectedDevice={selectedDevice}
          onSelectDevice={setSelectedDevice}
          selectedAccount={selectedAccount}
          onSelectAccount={setSelectedAccount}
          accountList={accountList}
          selectedAgent={selectedAgent}
          onSelectAgent={setSelectedAgent}
          agentList={agentList}
          deviceList={deviceList}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          onToggleMobileMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          onOpenSupabase={() => setIsSupabaseOpen(true)}
          onOpenMobilePairing={() => setIsMobilePairingOpen(true)}
          gatewayKind={gateway?.kind || 'unavailable'}
          gatewayCapabilities={gateway?.capabilities}
          isCloudConfigured={cloudConfigured}
        />

        {/* Content Area (Scrollbar is isolated strictly inside this area below Header) */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-4 sm:space-y-6">
          {loading && (
            <div className="rounded-2xl border border-surface-border bg-surface-card px-5 py-4 text-sm text-text-secondary animate-pulse" role="status">
              {gateway?.label || '데이터 환경'}에서 사용 기록을 불러오는 중입니다…
            </div>
          )}

          {!loading && loadError && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 flex flex-wrap items-center justify-between gap-3" role="alert">
              <div>
                <p className="text-sm font-bold text-rose-400">데이터 연결을 확인해주세요</p>
                <p className="text-xs text-text-secondary mt-1">{loadError}</p>
              </div>
              <button
                type="button"
                onClick={() => setRefreshNonce((value) => value + 1)}
                className="px-4 py-2 rounded-xl bg-surface-card border border-surface-border text-xs font-bold text-text-primary hover:border-rose-400 transition-colors"
              >
                다시 시도
              </button>
            </div>
          )}

          {!loading && !loadError && sessions.length === 0 && (
            <div className="rounded-2xl border border-surface-border bg-surface-card px-5 py-8 text-center" role="status">
              <p className="text-sm font-bold text-text-primary">아직 표시할 대화가 없습니다</p>
              <p className="text-xs text-text-secondary mt-1">
                {gateway?.kind === 'electron'
                  ? '첫 로컬 스캔이 완료되면 대화가 자동으로 나타납니다.'
                  : '인증된 계정에 동기화된 대화가 없습니다.'}
              </p>
            </div>
          )}

          {/* Section 1: Dashboard (Overview) */}
          {currentTab === 'dashboard' && (
            <div className="space-y-4 sm:space-y-5 animate-in fade-in duration-200">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h1 className="font-serif font-bold text-2xl sm:text-3xl text-text-primary tracking-tight">
                    Overview Dashboard
                  </h1>
                  <p className="text-xs text-text-secondary">
                    AI 코딩 에이전트 실시간 토큰 소비량 및 주요 활동 지표
                  </p>
                </div>
              </div>

              {/* Bento Row 1: 4 KPI Cards */}
              <KpiCards
                totalTokens={totalTokens}
                totalCostUsd={totalCostUsd}
                unpricedSessionCount={unpricedSessions}
                sessionCount={filteredSessions.length}
                todayTokens={todayTokens}
                todayCostUsd={todayCostUsd}
                todayUnpricedSessionCount={todayUnpricedSessions}
                todaySessions={todaySessionsCount}
                deviceCount={deviceList.length || 1}
              />

              {/* Bento Row 2: Balanced 2-Column Core Charts */}
              <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4 sm:gap-5">
                <DailyChart data={dailyStats} />
                <DeviceBreakdown sessions={filteredSessions} />
              </div>
            </div>
          )}

          {/* Section 2: Conversations (대화 세션 목록) */}
          {currentTab === 'conversations' && (
            <div className="animate-in fade-in duration-200">
              <SessionTable
                sessions={filteredSessions}
                onSelectSession={setSelectedSession}
                selectedAgent={selectedAgent}
                onSelectAgent={setSelectedAgent}
              />
            </div>
          )}

          {/* Section 3: Analytics (기간별 분석 리포트) */}
          {currentTab === 'analytics' && (
            <div className="space-y-4 sm:space-y-5 animate-in fade-in duration-200">
              <div>
                <h1 className="font-serif font-bold text-2xl sm:text-3xl text-text-primary tracking-tight">
                  Comprehensive Analytics
                </h1>
                <p className="text-xs text-text-secondary">
                  연간, 월별, 일자별 토큰 소비량 및 환산 구독 가치($) 심층 분석
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
                <MonthlyChart data={monthlyStats} />
                <DailyChart data={dailyStats} />
              </div>

              <YearlyChart data={yearlyStats} />
            </div>
          )}

          {/* Section 4: Agents (에이전트 현황) */}
          {currentTab === 'agents' && (
            <div className="space-y-4 sm:space-y-5 animate-in fade-in duration-200">
              <div>
                <h1 className="font-serif font-bold text-2xl sm:text-3xl text-text-primary tracking-tight">
                  Agent Ecosystem & Devices
                </h1>
                <p className="text-xs text-text-secondary">
                  Codex, Antigravity, Claude Code 에이전트 및 Mac 디바이스별 사용 점유율
                </p>
              </div>

              <DeviceBreakdown sessions={filteredSessions} />
            </div>
          )}
        </main>
      </div>

      {/* Level 5: Conversation Detail Modal */}
      {selectedSession && (
        <StepTimelineModal
          session={selectedSession}
          onClose={closeSelectedSession}
          gateway={gateway}
        />
      )}

      {/* Cloud & Mobile Settings Modals */}
      <SupabaseModal
        isOpen={isSupabaseOpen}
        onClose={() => setIsSupabaseOpen(false)}
        gateway={gateway}
        onSuccess={() => setRefreshNonce((value) => value + 1)}
      />

      <MobilePairingModal
        isOpen={isMobilePairingOpen}
        onClose={() => setIsMobilePairingOpen(false)}
        gateway={gateway}
      />

    </div>
  );
}
