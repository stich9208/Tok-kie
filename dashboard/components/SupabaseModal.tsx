'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Copy,
  Database,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';
import type { DashboardGateway, OAuthProject } from '../lib/gateway';
import type { ManualCloudSetupView } from '../../shared/ipc';

interface SupabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  gateway: DashboardGateway | null;
}

type OAuthPhase = 'idle' | 'authorizing' | 'projects' | 'saving';
type ManualPhase = 'idle' | 'preparing' | 'sql-ready' | 'claiming';

export const SupabaseModal: React.FC<SupabaseModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  gateway,
}) => {
  const [configuredUrl, setConfiguredUrl] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [oauthPhase, setOAuthPhase] = useState<OAuthPhase>('idle');
  const [projects, setProjects] = useState<readonly OAuthProject[]>([]);
  const [selectedProjectRef, setSelectedProjectRef] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [projectUrl, setProjectUrl] = useState('');
  const [publishableKey, setPublishableKey] = useState('');
  const [manualPhase, setManualPhase] = useState<ManualPhase>('idle');
  const [manualSetup, setManualSetup] = useState<ManualCloudSetupView | null>(null);
  const [copied, setCopied] = useState(false);

  const canManage = Boolean(gateway?.capabilities.cloudSettings);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setErrorMessage('');
    setSuccessMessage('');
    setProjects([]);
    setSelectedProjectRef('');
    setOAuthPhase('idle');
    setPublishableKey('');

    if (!gateway?.capabilities.cloudSettings) return;
    setIsLoading(true);
    gateway.getCloudSettings()
      .then((settings) => {
        setIsConfigured(settings.configured);
        setConfiguredUrl(settings.project_url || 'Supabase project');
      })
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : '클라우드 설정을 읽지 못했습니다.'))
      .finally(() => setIsLoading(false));
  }, [gateway, isOpen]);

  if (!isOpen) return null;

  const beginOAuth = async () => {
    if (!gateway) return;
    setErrorMessage('');
    setSuccessMessage('');
    setOAuthPhase('authorizing');
    try {
      await gateway.beginOAuth();
    } catch (error) {
      setOAuthPhase('idle');
      setErrorMessage(error instanceof Error ? error.message : 'Supabase 인증을 시작하지 못했습니다.');
    }
  };

  const loadProjects = async () => {
    if (!gateway) return;
    setErrorMessage('');
    setIsLoading(true);
    try {
      const availableProjects = await gateway.listOAuthProjects();
      setProjects(availableProjects);
      // Project choice must be an explicit user action; management OAuth never
      // grants authority to silently select the first project.
      setSelectedProjectRef('');
      setOAuthPhase('projects');
      if (availableProjects.length === 0) setErrorMessage('선택할 수 있는 Supabase 프로젝트가 없습니다.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '프로젝트 목록을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const selectProject = async () => {
    if (!gateway || !selectedProjectRef) return;
    setErrorMessage('');
    setOAuthPhase('saving');
    try {
      const settings = await gateway.selectOAuthProject(selectedProjectRef);
      setIsConfigured(settings.configured);
      setConfiguredUrl(settings.project_url || selectedProjectRef);
      setSuccessMessage('선택한 프로젝트와 안전하게 연결되었습니다.');
      setOAuthPhase('idle');
      onSuccess?.();
    } catch (error) {
      setOAuthPhase('projects');
      setErrorMessage(error instanceof Error ? error.message : '프로젝트 연결에 실패했습니다.');
    }
  };

  const prepareManualSetup = async () => {
    if (!gateway || !projectUrl || !publishableKey) return;
    setErrorMessage('');
    setSuccessMessage('');
    setManualPhase('preparing');
    try {
      const setup = await gateway.beginManualCloudSetup(projectUrl.trim(), publishableKey.trim());
      setManualSetup(setup);
      setProjectUrl(projectUrl.trim().replace(/\/$/, ''));
      setPublishableKey('');
      setManualPhase('sql-ready');
    } catch (error) {
      setManualPhase('idle');
      setErrorMessage(error instanceof Error ? error.message : '수동 설정 SQL을 준비하지 못했습니다.');
    }
  };

  const copySetupSql = async () => {
    if (!manualSetup) return;
    try {
      await navigator.clipboard.writeText(manualSetup.setup_sql);
      setCopied(true);
    } catch {
      setErrorMessage('SQL을 자동 복사하지 못했습니다. 아래 내용을 직접 선택해 복사하세요.');
    }
  };

  const confirmManualSetup = async () => {
    if (!gateway || !manualSetup) return;
    setErrorMessage('');
    setManualPhase('claiming');
    try {
      const settings = await gateway.confirmManualCloudSetup(manualSetup.setup_id, projectUrl);
      setIsConfigured(settings.configured);
      setConfiguredUrl(settings.project_url || projectUrl);
      setManualSetup(null);
      setManualPhase('idle');
      setSuccessMessage('SQL 적용을 확인하고 owner 연결을 완료했습니다.');
      onSuccess?.();
    } catch (error) {
      // A confirmation attempt is one-shot even when it fails. Starting again
      // creates a fresh main-process secret and digest statement.
      setManualSetup(null);
      setManualPhase('idle');
      setErrorMessage(error instanceof Error ? error.message : '수동 owner 연결에 실패했습니다. 다시 시작해 주세요.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 pt-8 sm:pt-16 bg-black/65 backdrop-blur-sm overflow-y-auto custom-scrollbar app-no-drag select-text">
      <div className="bg-surface-nav border border-surface-border w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden mb-8">
        <div className="px-6 py-5 border-b border-surface-border flex items-center justify-between bg-surface-card/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400"><Database className="w-5 h-5" /></div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">Supabase 클라우드 동기화</h2>
              <p className="text-xs text-text-secondary mt-0.5">OAuth·프로젝트 선택은 Electron main에서 처리됩니다.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="p-2 rounded-xl text-text-secondary hover:text-text-primary hover:bg-surface-border/50"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 sm:p-7 space-y-5 max-h-[75vh] overflow-y-auto custom-scrollbar">
          {!canManage && (
            <div className="p-5 rounded-2xl bg-surface-card border border-surface-border text-center">
              <Cloud className="w-7 h-7 text-text-secondary mx-auto mb-2" />
              <p className="text-sm font-bold text-text-primary">웹에서는 데스크톱 연결 설정을 변경할 수 없습니다</p>
              <p className="text-xs text-text-secondary mt-1">토큰과 프로젝트 권한은 데스크톱 main 프로세스와 OS 보안 저장소에서만 관리합니다.</p>
            </div>
          )}

          {isConfigured && (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-3 text-sm text-emerald-400">
              <CheckCircle2 className="w-5 h-5 mt-0.5" />
              <div><span className="font-bold">클라우드 동기화 활성화됨</span><p className="text-xs mt-0.5 font-mono break-all">{configuredUrl}</p></div>
            </div>
          )}

          {errorMessage && (
            <div role="alert" className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-start gap-2.5"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{errorMessage}</span></div>
          )}
          {successMessage && (
            <div role="status" className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2.5"><CheckCircle2 className="w-4 h-4" /><span>{successMessage}</span></div>
          )}

          {canManage && (
            <>
              <section className="p-5 rounded-3xl bg-gradient-to-br from-emerald-950/30 via-surface-card to-surface-card border border-emerald-500/30 space-y-4">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm"><Zap className="w-4 h-4" /><span>Supabase OAuth 연결</span></div>
                <p className="text-xs text-text-secondary leading-relaxed">main 프로세스가 PKCE와 state를 보관하고 인증을 완료합니다. 인증 뒤 프로젝트를 직접 선택하세요.</p>

                {oauthPhase === 'idle' && (
                  <button type="button" onClick={beginOAuth} className="w-full py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-bold text-sm">브라우저에서 안전하게 인증</button>
                )}

                {oauthPhase === 'authorizing' && (
                  <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 space-y-3 text-center">
                    <Loader2 className="w-5 h-5 text-emerald-400 animate-spin mx-auto" />
                    <p className="text-xs text-text-secondary">브라우저 인증을 마친 뒤 프로젝트 목록을 불러오세요.</p>
                    <button type="button" disabled={isLoading} onClick={loadProjects} className="px-4 py-2 rounded-xl bg-surface-card border border-surface-border text-xs font-bold text-text-primary disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 inline mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />프로젝트 불러오기</button>
                  </div>
                )}

                {(oauthPhase === 'projects' || oauthPhase === 'saving') && (
                  <div className="space-y-3">
                    <label className="block text-xs font-bold text-text-primary" htmlFor="supabase-project">연결할 프로젝트</label>
                    <select id="supabase-project" value={selectedProjectRef} onChange={(event) => setSelectedProjectRef(event.target.value)} disabled={oauthPhase === 'saving'} className="w-full px-3.5 py-2.5 rounded-xl bg-surface-card border border-surface-border text-xs text-text-primary">
                      <option value="" disabled>프로젝트를 직접 선택하세요</option>
                      {projects.map((project) => <option key={project.ref} value={project.ref}>{project.name} ({project.ref})</option>)}
                    </select>
                    <button type="button" onClick={selectProject} disabled={!selectedProjectRef || oauthPhase === 'saving'} className="w-full py-2.5 rounded-xl bg-emerald-500 text-gray-950 font-bold text-xs disabled:opacity-50">{oauthPhase === 'saving' ? '연결 중…' : '이 프로젝트 연결'}</button>
                  </div>
                )}
              </section>

              {gateway?.capabilities.manualCloudSetup && (
                <section className="p-5 rounded-3xl bg-surface-card border border-surface-border space-y-4">
                  <div className="flex items-center gap-2 text-text-primary font-bold text-sm"><Database className="w-4 h-4 text-emerald-400" /><span>URL + 공개 키로 직접 연결</span></div>
                  <p className="text-xs text-text-secondary leading-relaxed">OAuth를 사용할 수 없을 때 프로젝트 URL과 publishable key(또는 legacy anon key)만 입력하세요. 생성되는 SQL에는 일회성 비밀값이 아닌 SHA-256 digest만 포함됩니다.</p>

                  {(manualPhase === 'idle' || manualPhase === 'preparing') && (
                    <div className="space-y-3">
                      <label className="block text-xs font-bold text-text-primary" htmlFor="manual-project-url">Project URL</label>
                      <input id="manual-project-url" type="url" value={projectUrl} onChange={(event) => setProjectUrl(event.target.value)} disabled={manualPhase === 'preparing'} placeholder="https://your-project.supabase.co" className="w-full px-3.5 py-2.5 rounded-xl bg-surface-nav border border-surface-border text-xs text-text-primary font-mono" />
                      <label className="block text-xs font-bold text-text-primary" htmlFor="manual-publishable-key">Publishable / legacy anon key</label>
                      <input id="manual-publishable-key" type="password" value={publishableKey} onChange={(event) => setPublishableKey(event.target.value)} disabled={manualPhase === 'preparing'} autoComplete="off" className="w-full px-3.5 py-2.5 rounded-xl bg-surface-nav border border-surface-border text-xs text-text-primary font-mono" />
                      <p className="text-[11px] text-text-secondary">service-role, secret key, PAT, OAuth client secret는 허용되지 않습니다.</p>
                      <button type="button" onClick={prepareManualSetup} disabled={!projectUrl.trim() || !publishableKey.trim() || manualPhase === 'preparing'} className="w-full py-2.5 rounded-xl border border-emerald-500/40 text-emerald-400 font-bold text-xs disabled:opacity-50">{manualPhase === 'preparing' ? 'SQL 준비 중…' : '설정 SQL 만들기'}</button>
                    </div>
                  )}

                  {(manualPhase === 'sql-ready' || manualPhase === 'claiming') && manualSetup && (
                    <div className="space-y-3">
                      <ol className="list-decimal pl-4 space-y-1 text-xs text-text-secondary leading-relaxed">
                        <li>Supabase Dashboard의 SQL Editor에서 아래 SQL 전체를 한 번 실행하세요.</li>
                        <li>성공한 뒤 아래 만료 시각 전에 확인 버튼을 한 번 누르세요.</li>
                      </ol>
                      <textarea readOnly value={manualSetup.setup_sql} aria-label="Supabase 설정 SQL" className="w-full h-44 px-3 py-2 rounded-xl bg-black/30 border border-surface-border text-[10px] leading-relaxed text-text-secondary font-mono resize-y" />
                      <button type="button" onClick={copySetupSql} className="w-full py-2 rounded-xl bg-surface-nav border border-surface-border text-xs font-bold text-text-primary"><Copy className="w-3.5 h-3.5 inline mr-1.5" />{copied ? '복사됨' : 'SQL 전체 복사'}</button>
                      <p className="text-[10px] text-text-secondary break-all">대상 프로젝트: {manualSetup.project_ref} · 만료: {new Date(manualSetup.expires_at).toLocaleTimeString()}</p>
                      <button type="button" onClick={confirmManualSetup} disabled={manualPhase === 'claiming'} className="w-full py-2.5 rounded-xl bg-emerald-500 text-gray-950 font-bold text-xs disabled:opacity-50">{manualPhase === 'claiming' ? 'owner 연결 확인 중…' : 'SQL 실행 완료 — owner 연결 확인'}</button>
                    </div>
                  )}
                </section>
              )}

              <div className="p-4 rounded-2xl bg-surface-card border border-surface-border text-[11px] text-text-secondary leading-relaxed">
                수동 연결에서도 renderer에는 공개 프로젝트 정보와 digest-only SQL만 전달됩니다. 원본 일회성 증명값과 세션은 Electron main 및 OS 보안 저장소 밖으로 노출되지 않습니다.
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-surface-border flex items-center gap-2 bg-surface-card/30 text-xs text-text-secondary"><ShieldCheck className="w-4 h-4 text-emerald-400" />OAuth code와 access/refresh token은 renderer로 전달되지 않습니다.</div>
      </div>
    </div>
  );
};

export default SupabaseModal;
