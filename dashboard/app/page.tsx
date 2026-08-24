'use client';

import React, { useState, useEffect } from 'react';
import { Session, Step, DailyStat, MonthlyStat, YearlyStat } from '../lib/types';
import { fetchSessions, aggregateSessions } from '../lib/supabase';
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

  // Fetch data with visibility awareness and smooth background refresh
  useEffect(() => {
    async function load(isInitial = false) {
      if (isInitial) setLoading(true);
      const data = await fetchSessions();
      setSessions(data);
      if (isInitial) setLoading(false);
    }

    load(true);

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
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Handle OAuth callback status
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('supabase_connected') === 'true' || urlParams.get('supabase_error')) {
        setIsSupabaseOpen(true);
      }
    }
  }, []);

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
  const { dailyStats, monthlyStats, yearlyStats, totalTokens, totalCostUsd } =
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
  const todaySessionsCount = todaySessionsList.length;

  const deviceList = Array.from(
    new Set(sessions.map((s) => s.device_name).filter(Boolean))
  );

  const accountList = Array.from(
    new Set(sessions.map((s) => s.user_email).filter((e): e is string => Boolean(e) && e !== 'unknown'))
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
        />

        {/* Content Area (Scrollbar is isolated strictly inside this area below Header) */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-4 sm:space-y-6">
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
                sessionCount={filteredSessions.length}
                todayTokens={todayTokens}
                todayCostUsd={todayCostUsd}
                todaySessions={todaySessionsCount}
                deviceCount={deviceList.length || 1}
              />

              {/* Bento Row 2: Balanced 2-Column Core Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
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
          onClose={() => setSelectedSession(null)}
        />
      )}

      {/* Cloud & Mobile Settings Modals */}
      <SupabaseModal
        isOpen={isSupabaseOpen}
        onClose={() => setIsSupabaseOpen(false)}
      />

      <MobilePairingModal
        isOpen={isMobilePairingOpen}
        onClose={() => setIsMobilePairingOpen(false)}
      />
    </div>
  );
}
