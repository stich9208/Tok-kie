'use client';

import React, { useState, useEffect } from 'react';
import { Cloud, CheckCircle2, AlertCircle, X, ExternalLink, Loader2, Database, Zap, Key, ChevronDown, ChevronUp, Sparkles, Copy, Check, ShieldCheck, Settings } from 'lucide-react';

interface SupabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const SupabaseModal: React.FC<SupabaseModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [maskedUrl, setMaskedUrl] = useState('');
  
  // OAuth states
  const [isOAuthConfigured, setIsOAuthConfigured] = useState(false);
  const [oauthClientId, setOauthClientId] = useState('');
  const [isOAuthSetupOpen, setIsOAuthSetupOpen] = useState(false);
  const [isOAuthWaiting, setIsOAuthWaiting] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isOAuthLoading, setIsOAuthLoading] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [copiedRedirect, setCopiedRedirect] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const redirectUri = 'tokkie://oauth/callback';

  const loadConfig = () => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        setIsConfigured(data.configured);
        setMaskedUrl(data.supabaseUrl || '');
        setIsOAuthConfigured(data.oauthConfigured);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      setErrorMsg('');
      setSuccessMsg('');

      // Check URL query parameters for OAuth result
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('supabase_connected') === 'true') {
          const projName = urlParams.get('project_name') || 'Supabase';
          setSuccessMsg(`🎉 [${projName}] 프로젝트와 원클릭 연동 및 테이블 생성이 완료되었습니다!`);
          setIsConfigured(true);
          setIsOAuthWaiting(false);
          window.history.replaceState({}, '', window.location.pathname);
          if (onSuccess) onSuccess();
        } else if (urlParams.get('supabase_error')) {
          setErrorMsg(decodeURIComponent(urlParams.get('supabase_error') || 'OAuth 연동에 실패했습니다.'));
          setIsOAuthWaiting(false);
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
    }
  }, [isOpen, onSuccess]);

  if (!isOpen) return null;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedRedirect(true);
    setTimeout(() => setCopiedRedirect(false), 2000);
  };

  const handleOAuthConnect = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setIsOAuthLoading(true);

    try {
      const res = await fetch('/api/auth/supabase?mode=json');
      const data = await res.json();

      if (!data.configured) {
        // OAuth Client ID not yet set: Open setup form inside modal without page navigation
        setIsOAuthSetupOpen(true);
        setIsOAuthLoading(false);
        return;
      }

      // OAuth is configured: Open browser
      setIsOAuthWaiting(true);
      setIsOAuthLoading(false);
      window.open(data.authUrl, '_blank', 'width=700,height=800');
    } catch (err: any) {
      setIsOAuthLoading(false);
      setErrorMsg(err.message || 'OAuth 연동 요청 중 오류가 발생했습니다.');
    }
  };

  const handleSaveOAuthCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oauthClientId) {
      setErrorMsg('Client ID를 입력해주세요.');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oauthClientId }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save OAuth credentials');

      setIsOAuthConfigured(true);
      setIsOAuthSetupOpen(false);
      setIsLoading(false);
      
      // Immediately initiate OAuth login
      handleOAuthConnect();
    } catch (err: any) {
      setIsLoading(false);
      setErrorMsg(err.message || 'OAuth 키 저장 중 오류가 발생했습니다.');
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supabaseUrl, supabaseKey }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save configuration');

      setSuccessMsg('✅ Supabase 수동 연동이 완료되었습니다! 2초 후 새로고침됩니다.');
      setIsConfigured(true);
      if (onSuccess) onSuccess();

      setTimeout(() => {
        onClose();
        window.location.reload();
      }, 2000);
    } catch (err: any) {
      setErrorMsg(err.message || '설정 저장 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 pt-8 sm:pt-16 bg-black/65 backdrop-blur-sm animate-in fade-in duration-200 app-no-drag select-text overflow-y-auto custom-scrollbar">
      <div className="bg-surface-nav border border-surface-border w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 mb-8">
        {/* Header */}
        <div className="px-6 py-5 border-b border-surface-border flex items-center justify-between bg-surface-card/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 flex-shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">Supabase 클라우드 동기화</h2>
              <p className="text-xs sm:text-sm text-text-secondary mt-0.5">개인 DB와 연동하여 어디서나 안전하게 대시보드 조회</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-text-secondary hover:text-text-primary hover:bg-surface-border/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 sm:p-7 space-y-5 overflow-y-auto custom-scrollbar flex-1 max-h-[75vh]">
          {isConfigured && (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-3 text-sm text-emerald-400">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">클라우드 동기화 활성화됨</span>
                <p className="text-emerald-400/80 text-xs sm:text-sm mt-0.5 font-mono">{maskedUrl || 'Supabase Cloud'}</p>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs sm:text-sm flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs sm:text-sm flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* 1. Primary Recommendation: Supabase One-Click OAuth */}
          <div className="p-5 rounded-3xl bg-gradient-to-br from-emerald-950/30 via-surface-card to-surface-card border border-emerald-500/30 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm sm:text-base">
                <Sparkles className="w-4 h-4" />
                <span>1초 원클릭 자동 연동</span>
              </div>
            </div>
            
            <p className="text-xs sm:text-[13px] text-text-secondary leading-relaxed">
              Supabase 로그인 한 번으로 프로젝트를 선택하면, <b>데이터베이스 연결과 실시간 클라우드 동기화</b>가 자동으로 완료됩니다.
            </p>

            {isOAuthWaiting ? (
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col items-center justify-center text-center space-y-2 py-5">
                <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
                <span className="text-sm font-bold text-emerald-300">Supabase 브라우저 인증 창 대기 중...</span>
                <p className="text-xs text-text-secondary max-w-sm">
                  새 창에서 Supabase 프로젝트를 선택하고 [Authorize]를 누르시면 이곳에 자동으로 연동 완료가 뜹니다.
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleOAuthConnect}
                disabled={isOAuthLoading}
                className="w-full py-3.5 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-gray-950 font-bold text-sm shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2"
              >
                {isOAuthLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Supabase 확인 중...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 fill-current" />
                    ⚡ Supabase로 1초 원클릭 연동하기
                  </>
                )}
              </button>
            )}

            {/* In-Modal OAuth Setup Form (Reveals if client_id is not yet registered) */}
            {isOAuthSetupOpen && (
              <div className="pt-3 border-t border-surface-border/60 space-y-3.5 animate-in fade-in duration-200">
                <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300/90 leading-relaxed">
                  💡 <b>왜 이 단계가 필요한가요?</b><br />
                  Tok-kie가 사용자의 Supabase 계정과 안전하게 통신할 수 있도록 <b>인증 식별자(Client ID)</b>를 연결하는 최초 1회 준비 과정입니다. 등록 후에는 언제나 버튼 하나로 바로 연동됩니다.
                </div>
                
                <div className="p-3.5 rounded-2xl bg-surface-nav/80 border border-surface-border text-xs text-text-secondary space-y-2 leading-relaxed">
                  <div className="flex items-center justify-between">
                    <span>1. <a href="https://supabase.com/dashboard/account/me" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline font-semibold inline-flex items-center gap-0.5">Supabase Account &gt; OAuth Apps <ExternalLink className="w-3 h-3" /></a> 접속</span>
                  </div>
                  <div>2. <b>[Add new app]</b> 클릭 후 App Name에 <b>Tok-kie</b> 입력</div>
                  <div className="space-y-1">
                    <div>3. Redirect URI 칸에 아래 주소 복사 & 붙여넣기:</div>
                    <div className="flex items-center gap-2 bg-surface-card p-2 rounded-xl border border-surface-border">
                      <code className="text-[11px] text-text-primary font-mono flex-1 overflow-x-auto select-all">{redirectUri}</code>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(redirectUri)}
                        className="p-1 rounded bg-surface-border hover:bg-surface-border-light text-text-primary transition-colors flex items-center gap-1 text-[10px] font-semibold"
                      >
                        {copiedRedirect ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        {copiedRedirect ? '복사됨' : '복사'}
                      </button>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleSaveOAuthCredentials} className="space-y-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-bold text-text-primary mb-1">
                      발급받은 Client ID (Secret 불필요 ⚡)
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="예: d817fe..."
                      value={oauthClientId}
                      onChange={e => setOauthClientId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-surface-card border border-surface-border text-text-primary text-xs focus:outline-none focus:border-emerald-500 font-mono shadow-sm"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsOAuthSetupOpen(false)}
                      className="px-3.5 py-1.5 rounded-xl text-text-secondary hover:text-text-primary text-xs font-semibold"
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-bold text-xs shadow-md transition-all flex items-center gap-1.5"
                    >
                      {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '저장 및 로그인 시작'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          {/* 2. Secondary Option: Manual Key Input Accordion */}
          <div className="border border-surface-border rounded-2xl overflow-hidden bg-surface-card/40">
            <button
              type="button"
              onClick={() => setShowManualForm(!showManualForm)}
              className="w-full px-4 py-3 flex items-center justify-between text-xs sm:text-sm font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-card/80 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4" />
                <span>직접 URL 및 API Key 입력하기 (사내망/수동 설정)</span>
              </div>
              {showManualForm ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showManualForm && (
              <form onSubmit={handleManualSubmit} className="p-4 pt-2 space-y-3.5 border-t border-surface-border">
                <div className="p-3 rounded-xl bg-surface-nav text-[11px] text-text-secondary leading-relaxed">
                  💡 수동 입력 시에는 Supabase SQL Editor에서 <code className="text-amber-400 font-mono">supabase/schema.sql</code> 파일을 1회 실행하셔야 합니다.
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-primary mb-1">
                    Supabase Project URL
                  </label>
                  <input
                    type="url"
                    required
                    placeholder="https://xxxxxxxxxxxx.supabase.co"
                    value={supabaseUrl}
                    onChange={e => setSupabaseUrl(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-card border border-surface-border text-text-primary text-xs focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-text-secondary/50 font-mono shadow-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-primary mb-1">
                    Supabase Anon / Publishable Key
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="sb_publishable_... 또는 eyJhbGci..."
                    value={supabaseKey}
                    onChange={e => setSupabaseKey(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-card border border-surface-border text-text-primary text-xs focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-text-secondary/50 font-mono shadow-sm"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={isLoading || !supabaseUrl || !supabaseKey}
                    className="px-5 py-2 rounded-xl bg-surface-border text-text-primary font-bold text-xs hover:bg-surface-border-light transition-all disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '수동 저장'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-surface-border flex items-center justify-between bg-surface-card/30 text-xs text-text-secondary">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>모든 데이터는 사용자 본인의 개인 DB에만 저장됩니다.</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary underline font-medium"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

export default SupabaseModal;
