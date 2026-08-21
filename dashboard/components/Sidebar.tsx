'use client';

import React from 'react';
import {
  LayoutDashboard,
  MessageSquareText,
  BarChart3,
  Bot,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  sessionCount: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  sessionCount,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen = false,
  onCloseMobile,
}) => {
  const navItems = [
    { id: 'dashboard', label: '대시보드', subLabel: 'Overview', icon: LayoutDashboard },
    { id: 'conversations', label: '대화 세션', subLabel: 'Conversations', icon: MessageSquareText, count: sessionCount },
    { id: 'analytics', label: '기간별 분석', subLabel: 'Analytics', icon: BarChart3 },
    { id: 'agents', label: '에이전트 현황', subLabel: 'Agents', icon: Bot },
  ];

  const handleTabClick = (tabId: string) => {
    onSelectTab(tabId);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  return (
    <>
      {/* 1. Mobile Backdrop Overlay */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden animate-in fade-in duration-200"
        />
      )}

      {/* 2. Sidebar Container */}
      <aside
        className={`bg-surface-nav border-r border-surface-border flex flex-col justify-between p-4 min-h-screen select-none transition-all duration-300 z-50 ${
          /* Mobile: Drawer Fixed Slide-in */
          isMobileOpen
            ? 'fixed inset-y-0 left-0 w-72 shadow-2xl flex md:hidden animate-in slide-in-from-left duration-200'
            : 'hidden md:flex sticky top-0'
        } ${isCollapsed ? 'md:w-20' : 'md:w-64'}`}
      >
        <div className="space-y-6">
          {/* Brand Logo & Collapse / Close Toggle */}
          <div className="flex items-center justify-between px-1.5 pt-1">
            <div
              className="flex items-center gap-3 cursor-pointer overflow-hidden"
              onClick={() => handleTabClick('dashboard')}
            >
              <div className="w-9 h-9 rounded-2xl bg-surface-card border border-surface-border flex items-center justify-center flex-shrink-0 shadow-sm">
                <Sparkles className="w-4 h-4 text-amber-accent" />
              </div>
              {(!isCollapsed || isMobileOpen) && (
                <div className="animate-in fade-in duration-200">
                  <div className="flex items-center gap-1.5">
                    <span className="font-serif font-bold text-lg text-text-primary tracking-tight">
                      Lumina
                    </span>
                    <span className="text-xs text-amber-accent">✨</span>
                  </div>
                  <span className="text-[10px] tracking-wider uppercase font-semibold text-text-secondary">
                    Agent Tracker
                  </span>
                </div>
              )}
            </div>

            {/* Desktop Collapse / Mobile Close Button */}
            <button
              onClick={isMobileOpen ? onCloseMobile : onToggleCollapse}
              title={isMobileOpen ? '닫기' : isCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
              className="p-1.5 rounded-xl bg-surface-card border border-surface-border text-text-secondary hover:text-text-primary transition-colors flex-shrink-0"
            >
              {isMobileOpen ? (
                <ChevronLeft className="w-4 h-4" />
              ) : isCollapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronLeft className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Navigation Items */}
          <nav className="space-y-1.5 pt-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              const showText = !isCollapsed || isMobileOpen;

              return (
                <button
                  key={item.id}
                  onClick={() => handleTabClick(item.id)}
                  title={!showText ? `${item.label} (${item.subLabel})` : undefined}
                  className={`w-full flex items-center ${
                    !showText ? 'justify-center px-0' : 'justify-between px-3.5'
                  } py-3 rounded-2xl text-xs font-semibold transition-colors duration-150 relative ${
                    isActive
                      ? 'bg-surface-card text-text-primary border border-surface-border shadow-sm'
                      : 'text-text-secondary hover:text-text-primary hover:bg-surface-card/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      className={`w-4 h-4 flex-shrink-0 ${
                        isActive ? 'text-lavender-accent' : 'text-text-secondary'
                      }`}
                    />
                    {showText && (
                      <div className="flex flex-col items-start text-left">
                        <span className="leading-tight">{item.label}</span>
                        <span className="text-[10px] text-text-secondary font-normal font-sans">
                          {item.subLabel}
                        </span>
                      </div>
                    )}
                  </div>

                  {showText && item.count !== undefined && item.count > 0 && (
                    <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-surface-container text-lavender-accent border border-surface-border rounded-full">
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Footer Info */}
        <div className="pt-4 border-t border-surface-border/60 px-1">
          <div
            className={`flex items-center ${
              isCollapsed && !isMobileOpen ? 'justify-center' : 'justify-between'
            } text-[11px] text-text-secondary`}
          >
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-mint-accent animate-pulse" />
              {(!isCollapsed || isMobileOpen) && <span>Sync Active</span>}
            </div>
            {(!isCollapsed || isMobileOpen) && <span className="font-mono text-[10px]">v2.2</span>}
          </div>
        </div>
      </aside>
    </>
  );
};
