'use client';

import React, { useState, useEffect } from 'react';
import { Cloud, CheckCircle2, AlertCircle, X, ExternalLink, Loader2, Database } from 'lucide-react';

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
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetch('/api/config')
        .then(res => res.json())
        .then(data => {
          setIsConfigured(data.configured);
          setMaskedUrl(data.supabaseUrl || '');
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
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

      setSuccessMsg('✅ Supabase 연동이 완료되었습니다! 3초 후 화면이 갱신됩니다.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-surface-nav border border-surface-border w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between bg-surface-card/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-text-primary">Supabase 클라우드 동기화</h2>
              <p className="text-xs text-text-secondary">무료 PostgreSQL DB와 연동하여 어디서나 대시보드 조회</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-border/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {isConfigured && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-3 text-xs text-emerald-400">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">클라우드 동기화 활성화됨</span>
                <p className="text-emerald-400/80 mt-0.5">현재 연결된 프로젝트: {maskedUrl || 'Supabase Cloud'}</p>
              </div>
            </div>
          )}

          <div className="p-3.5 rounded-xl bg-surface-card border border-surface-border space-y-2 text-xs text-text-secondary">
            <div className="font-semibold text-text-primary flex items-center justify-between">
              <span>💡 1분 만에 무료 Supabase DB 만들기</span>
              <a
                href="https://supabase.com"
                target="_blank"
                rel="noreferrer"
                className="text-lavender-accent hover:underline flex items-center gap-1 font-normal"
              >
                supabase.com <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed">
              <li>Supabase 무료 프로젝트 생성 후 <b>SQL Editor</b> 이동</li>
              <li>프로젝트의 <code className="bg-surface-border px-1 py-0.5 rounded text-amber-accent">supabase/schema.sql</code> 복사 & 붙여넣고 <b>Run</b> 실행</li>
              <li><b>Project Settings &gt; Data API</b>에서 URL과 anon key 복사</li>
            </ol>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5 pt-1">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                Supabase Project URL
              </label>
              <input
                type="url"
                required
                placeholder="https://xxxxxxxxxxxx.supabase.co"
                value={supabaseUrl}
                onChange={e => setSupabaseUrl(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface-card border border-surface-border text-text-primary text-xs focus:outline-none focus:border-lavender-accent transition-colors placeholder:text-text-secondary/50 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                Supabase Anon Public Key
              </label>
              <input
                type="password"
                required
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                value={supabaseKey}
                onChange={e => setSupabaseKey(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface-card border border-surface-border text-text-primary text-xs focus:outline-none focus:border-lavender-accent transition-colors placeholder:text-text-secondary/50 font-mono"
              />
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl bg-surface-card border border-surface-border text-text-secondary text-xs font-semibold hover:text-text-primary hover:bg-surface-border/50 transition-colors"
              >
                닫기
              </button>
              <button
                type="submit"
                disabled={isLoading || !supabaseUrl || !supabaseKey}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-lavender-accent to-pink-accent text-surface-nav font-bold text-xs shadow-md hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    저장 및 동기화 중...
                  </>
                ) : (
                  '연결 및 동기화'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
