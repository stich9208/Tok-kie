'use client';

import React from 'react';
import {
  Search,
  Laptop,
  Bot,
  User,
  Menu,
  Cloud,
  Smartphone
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import type { GatewayCapabilities, GatewayKind } from '../lib/gateway';

interface HeaderProps {
  selectedDevice: string;
  onSelectDevice: (device: string) => void;
  selectedAccount?: string;
  onSelectAccount?: (account: string) => void;
  accountList?: string[];
  selectedAgent: string;
  onSelectAgent: (agent: string) => void;
  agentList?: string[];
  deviceList: string[];
  searchTerm: string;
  onSearchChange: (query: string) => void;
  onToggleMobileMenu?: () => void;
  onOpenSupabase?: () => void;
  onOpenMobilePairing?: () => void;
  gatewayKind: GatewayKind;
  gatewayCapabilities?: GatewayCapabilities;
  isCloudConfigured: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  selectedDevice,
  onSelectDevice,
  selectedAccount = 'All',
  onSelectAccount,
  accountList = [],
  selectedAgent,
  onSelectAgent,
  agentList = [],
  deviceList,
  searchTerm,
  onSearchChange,
  onToggleMobileMenu,
  onOpenSupabase,
  onOpenMobilePairing,
  gatewayKind,
  gatewayCapabilities,
  isCloudConfigured,
}) => {
  const canManageCloud = Boolean(gatewayCapabilities?.cloudSettings);
  const canPairMobile = Boolean(gatewayCapabilities?.pairing);

  const DEFAULT_AGENTS = ['antigravity', 'codex', 'claude_code'];
  const allAgents = Array.from(new Set([...DEFAULT_AGENTS, ...agentList]));

  const formatAgentName = (name: string) => {
    switch (name) {
      case 'antigravity':
        return 'Antigravity';
      case 'claude_code':
        return 'Claude Code';
      case 'codex':
        return 'Codex';
      default:
        return name.charAt(0).toUpperCase() + name.slice(1);
    }
  };

  const formatAccountName = (name: string) => name === 'unknown' ? '계정 정보 없음' : name;

  return (
    <header className="sticky top-0 z-30 bg-canvas/90 backdrop-blur-md border-b border-surface-border px-5 sm:px-7 lg:px-9 py-3.5 md:py-4 transition-all app-drag select-none">
      {/* 1. Mobile Top Row (Hamburger + Logo + Theme + Profile) */}
      <div className="flex md:hidden items-center justify-between gap-3 pb-2.5 app-no-drag">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onToggleMobileMenu}
            title="메뉴 열기"
            className="p-2 rounded-xl bg-surface-card border border-surface-border text-text-primary hover:bg-surface-container transition-colors"
          >
            <Menu className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-base text-text-primary tracking-tight">
              Tok-kie
            </span>
            <span className="text-sm">🐰</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenSupabase}
            disabled={!canManageCloud}
            title={canManageCloud ? 'Supabase 클라우드 설정' : '클라우드 설정은 데스크톱 앱에서 관리합니다'}
            className={`p-1.5 rounded-full border text-xs flex items-center justify-center transition-all ${
              isCloudConfigured
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-surface-card border-surface-border text-lavender-accent'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" />
          </button>
          <ThemeToggle />
          <div
            title={selectedAccount && selectedAccount !== 'All' ? selectedAccount : 'User Profile'}
            className="w-7 h-7 rounded-full bg-gradient-to-tr from-lavender-accent to-pink-accent flex items-center justify-center text-surface-nav font-bold text-[11px] shadow-sm uppercase"
          >
            {selectedAccount && selectedAccount !== 'All' ? selectedAccount.slice(0, 2) : 'AI'}
          </div>
        </div>
      </div>

      {/* 2. Main Flex Container (Desktop 1-row, Mobile multi-row) */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 md:gap-4">
        {/* Search Bar */}
        <div className="w-full md:flex-1 md:max-w-md app-no-drag">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-text-secondary absolute left-3.5 top-2.5" />
            <input
              type="text"
              placeholder="대화명, 모델, 작업 내용 검색..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full bg-surface-card border border-surface-border rounded-full pl-9 pr-4 py-1.5 text-xs text-text-primary placeholder-text-secondary focus:outline-none focus:border-lavender-accent transition-colors"
            />
          </div>
        </div>

        {/* Filter Strip: Mobile 3-column equal grid, Desktop flex-end */}
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2 w-full md:flex md:w-auto md:items-center md:justify-end flex-shrink-0 app-no-drag">
          {/* Live Status Badge (Desktop Only) */}
          <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 bg-surface-card border border-surface-border rounded-full text-[11px] font-semibold text-mint-accent flex-shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${loadStatusColor(gatewayKind)}`} />
            <span className="hidden 2xl:inline">{gatewayKind === 'electron' ? 'Local IPC' : gatewayKind === 'web' ? 'Supabase' : 'Starting'}</span>
          </div>

          {/* Device Filter Dropdown */}
          <div className="relative w-full md:w-auto">
            <select
              value={selectedDevice}
              onChange={(e) => onSelectDevice(e.target.value)}
              className="w-full md:w-auto bg-surface-card border border-surface-border text-text-primary text-[11px] sm:text-xs font-medium rounded-full pl-2 sm:pl-3 pr-5 sm:pr-6 py-1.5 focus:outline-none focus:border-lavender-accent cursor-pointer appearance-none shadow-sm md:max-w-[95px] lg:max-w-[120px] truncate"
            >
              <option value="All">모든 기기</option>
              {deviceList.map((dev) => (
                <option key={dev} value={dev}>
                  {dev}
                </option>
              ))}
            </select>
            <Laptop className="w-3 h-3 text-text-secondary absolute right-2 top-2.5 pointer-events-none" />
          </div>

          {/* Dynamic Account Filter Dropdown */}
          {onSelectAccount && (
            <div className="relative w-full md:w-auto">
              <select
                value={selectedAccount}
                onChange={(e) => onSelectAccount(e.target.value)}
                className="w-full md:w-auto bg-surface-card border border-surface-border text-text-primary text-[11px] sm:text-xs font-medium rounded-full pl-2 sm:pl-3 pr-5 sm:pr-6 py-1.5 focus:outline-none focus:border-lavender-accent cursor-pointer appearance-none shadow-sm md:max-w-[100px] lg:max-w-[135px] truncate"
              >
                <option value="All">모든 계정</option>
                {accountList.map((acc) => (
                  <option key={acc} value={acc}>
                    {formatAccountName(acc)}
                  </option>
                ))}
              </select>
              <User className="w-3 h-3 text-text-secondary absolute right-2 top-2.5 pointer-events-none" />
            </div>
          )}

          {/* Agent Filter Dropdown */}
          <div className="relative w-full md:w-auto">
            <select
              value={selectedAgent}
              onChange={(e) => onSelectAgent(e.target.value)}
              className="w-full md:w-auto bg-surface-card border border-surface-border text-text-primary text-[11px] sm:text-xs font-medium rounded-full pl-2 sm:pl-3 pr-5 sm:pr-6 py-1.5 focus:outline-none focus:border-lavender-accent cursor-pointer appearance-none shadow-sm md:max-w-[95px] lg:max-w-[120px] truncate"
            >
              <option value="All">모든 에이전트</option>
              {allAgents.map((ag) => (
                <option key={ag} value={ag}>
                  {formatAgentName(ag)}
                </option>
              ))}
            </select>
            <Bot className="w-3 h-3 text-text-secondary absolute right-2 top-2.5 pointer-events-none" />
          </div>

          {/* Desktop Right Controls (Cloud Sync, Mobile Sync, Theme, Notifications, Profile) */}
          <div className="hidden md:flex items-center gap-1.5 lg:gap-2 pl-1 flex-shrink-0 app-no-drag">
            <button
              onClick={onOpenMobilePairing}
              disabled={!canPairMobile}
              title={canPairMobile ? '5분 모바일 QR 연동' : '모바일 페어링은 데스크톱 앱에서 생성합니다'}
              className="p-1.5 lg:px-3 lg:py-1.5 rounded-full border border-surface-border bg-surface-card text-text-secondary hover:text-text-primary hover:border-lavender-accent text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Smartphone className="w-3.5 h-3.5 text-lavender-accent" />
              <span className="hidden xl:inline">모바일 연동</span>
            </button>

            <button
              onClick={onOpenSupabase}
              disabled={!canManageCloud}
              title={isCloudConfigured ? 'Supabase 클라우드 연결됨' : 'Supabase 클라우드 연결 설정'}
              className={`p-1.5 lg:px-3 lg:py-1.5 rounded-full border text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed ${
                isCloudConfigured
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                  : 'bg-surface-card border-surface-border text-lavender-accent hover:border-lavender-accent'
              }`}
            >
              <Cloud className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">{isCloudConfigured ? '클라우드 연동됨' : 'Supabase 연동'}</span>
            </button>
            <ThemeToggle />
            <div
              title={selectedAccount && selectedAccount !== 'All' ? selectedAccount : 'User Profile'}
              className="w-7 h-7 lg:w-8 lg:h-8 rounded-full bg-gradient-to-tr from-lavender-accent to-pink-accent flex items-center justify-center text-surface-nav font-bold text-[11px] lg:text-xs shadow-sm cursor-pointer uppercase flex-shrink-0"
            >
              {selectedAccount && selectedAccount !== 'All' ? selectedAccount.slice(0, 2) : 'AI'}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

function loadStatusColor(kind: GatewayKind): string {
  if (kind === 'electron' || kind === 'web') return 'bg-mint-accent animate-pulse';
  return 'bg-text-secondary';
}
