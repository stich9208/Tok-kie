'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { encodePairingUrl, type DashboardGateway, type PairingMember } from '../lib/gateway';

interface MobilePairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  gateway: DashboardGateway | null;
}

function defaultWebUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WEB_APP_URL;
  if (configured) return configured;
  // A packaged app cannot safely assume that an unrelated public deployment
  // exists. HTTPS web builds may use their own origin; desktop builds require
  // the operator/user to provide the deployed viewer URL explicitly.
  return window.location.protocol === 'https:' ? window.location.origin : '';
}

export const MobilePairingModal: React.FC<MobilePairingModalProps> = ({ isOpen, onClose, gateway }) => {
  const [webUrl, setWebUrl] = useState('');
  const [pairingUrl, setPairingUrl] = useState('');
  const [expiresAt, setExpiresAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [members, setMembers] = useState<readonly PairingMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberActionId, setMemberActionId] = useState('');
  const copiedPairingUrlRef = useRef('');

  const clearOwnedPairingMaterial = useCallback(() => {
    const copiedValue = copiedPairingUrlRef.current;
    copiedPairingUrlRef.current = '';
    setPairingUrl('');
    setExpiresAt(0);
    setSecondsLeft(0);
    setCopied(false);

    if (!copiedValue || !navigator.clipboard?.readText) return;
    void navigator.clipboard.readText().then(async (currentValue) => {
      // Never erase clipboard content that the user or another app replaced.
      if (currentValue === copiedValue) await navigator.clipboard.writeText('');
    }).catch(() => {
      // Clipboard read permission may be unavailable; failing closed avoids
      // erasing a value whose ownership cannot be proven.
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      setWebUrl(defaultWebUrl());
      setErrorMessage('');
      return;
    }
    // Clear the token-bearing URL as soon as the modal closes.
    clearOwnedPairingMaterial();
    setMembers([]);
  }, [clearOwnedPairingMaterial, isOpen]);

  useEffect(() => {
    if (!expiresAt) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1_000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        clearOwnedPairingMaterial();
      }
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [clearOwnedPairingMaterial, expiresAt]);

  useEffect(() => {
    if (!isOpen || !gateway?.capabilities.pairing) return;
    let cancelled = false;
    const load = async (showSpinner: boolean) => {
      if (showSpinner) setMembersLoading(true);
      try {
        const next = await gateway.listPairingMembers();
        if (!cancelled) setMembers(next);
      } catch (error) {
        if (!cancelled && showSpinner) {
          setErrorMessage(error instanceof Error ? error.message : '페어링 멤버를 읽지 못했습니다.');
        }
      } finally {
        if (!cancelled && showSpinner) setMembersLoading(false);
      }
    };
    void load(true);
    const timer = window.setInterval(() => void load(false), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [gateway, isOpen]);

  if (!isOpen) return null;

  const createPairing = async () => {
    if (!gateway) return;
    setErrorMessage('');
    setPairingUrl('');
    setIsLoading(true);
    try {
      const target = new URL(webUrl);
      if (target.protocol !== 'https:') throw new Error('배포 웹 주소는 HTTPS여야 합니다.');
      const envelope = await gateway.createPairing();
      setPairingUrl(encodePairingUrl(target.toString(), envelope));
      setExpiresAt(envelope.exp);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '페어링 QR을 만들지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const copyPairingUrl = async () => {
    if (!pairingUrl) return;
    try {
      await navigator.clipboard.writeText(pairingUrl);
      copiedPairingUrlRef.current = pairingUrl;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setErrorMessage('클립보드에 링크를 복사하지 못했습니다.');
    }
  };

  const canPair = Boolean(gateway?.capabilities.pairing);

  const changeMember = async (member: PairingMember, action: 'approve' | 'revoke') => {
    if (!gateway) return;
    setMemberActionId(member.id);
    setErrorMessage('');
    try {
      if (action === 'approve') await gateway.approvePairingMember(member.id);
      else await gateway.revokePairingMember(member.id);
      setMembers(await gateway.listPairingMembers());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '페어링 멤버 상태를 변경하지 못했습니다.');
    } finally {
      setMemberActionId('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 pt-16 sm:pt-24 bg-black/65 backdrop-blur-sm overflow-y-auto custom-scrollbar app-no-drag select-text">
      <div className="bg-surface-nav border border-surface-border w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden mb-8">
        <div className="px-6 py-5 border-b border-surface-border flex items-center justify-between bg-surface-card/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-lavender-accent/15 border border-lavender-accent/30 flex items-center justify-center text-lavender-accent"><Smartphone className="w-5 h-5" /></div>
            <div><h2 className="text-lg font-bold text-text-primary">모바일 보안 연동</h2><p className="text-xs text-text-secondary mt-0.5">한 번만 사용할 수 있는 5분 QR</p></div>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="p-2 rounded-xl text-text-secondary hover:text-text-primary hover:bg-surface-border/50"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 sm:p-7 flex flex-col items-center text-center space-y-5">
          {errorMessage && (
            <div role="alert" className="w-full p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-start gap-2 text-left"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{errorMessage}</span></div>
          )}

          {!canPair ? (
            <div className="w-full p-6 rounded-2xl bg-surface-card border border-surface-border">
              <Smartphone className="w-7 h-7 text-text-secondary mx-auto mb-2" />
              <p className="text-sm font-bold text-text-primary">QR 생성은 데스크톱 앱에서만 가능합니다</p>
              <p className="text-xs text-text-secondary mt-1">웹 화면은 받은 QR을 소비하는 역할만 수행합니다.</p>
            </div>
          ) : pairingUrl ? (
            <>
              <div className="p-4 bg-white rounded-2xl shadow-xl border border-neutral-200"><QRCodeSVG value={pairingUrl} size={200} level="M" includeMargin={false} /></div>
              <div>
                <h3 className="text-sm font-bold text-text-primary">스마트폰 카메라로 스캔하세요</h3>
                <p className="text-xs text-text-secondary mt-1">남은 시간 {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</p>
              </div>
              <button type="button" onClick={copyPairingUrl} className="px-4 py-2 rounded-xl bg-surface-card border border-surface-border text-xs font-bold text-text-primary flex items-center gap-2">{copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}{copied ? '복사됨' : '일회용 링크 복사'}</button>
            </>
          ) : (
            <div className="w-full p-8 rounded-2xl bg-surface-card border border-dashed border-surface-border">
              <QrCode className="w-9 h-9 text-text-secondary mx-auto mb-3" />
              <p className="text-sm font-bold text-text-primary">새 일회용 QR을 생성하세요</p>
              <p className="text-xs text-text-secondary mt-1">생성 전에는 어떤 키나 토큰도 화면에 유지하지 않습니다.</p>
            </div>
          )}

          {canPair && !pairingUrl && (
            <div className="w-full text-left space-y-2">
              <label htmlFor="pairing-web-url" className="block text-xs font-bold text-text-primary">배포된 웹 주소</label>
              <input id="pairing-web-url" type="url" value={webUrl} onChange={(event) => setWebUrl(event.target.value)} placeholder="https://your-tokkie-viewer.example" className="w-full px-3.5 py-2.5 rounded-xl bg-surface-card border border-surface-border text-text-primary text-xs font-mono" />
              <button type="button" onClick={createPairing} disabled={isLoading || !webUrl} className="w-full py-3 rounded-xl bg-lavender-accent text-surface-nav font-bold text-xs disabled:opacity-50 flex items-center justify-center gap-2">{isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}{isLoading ? '5분 토큰 생성 중…' : '5분 일회용 QR 생성'}</button>
            </div>
          )}

          {canPair && (
            <section className="w-full text-left space-y-3 pt-1" aria-label="페어링 멤버 관리">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-text-primary">연결 요청 및 활성 멤버</h3>
                  <p className="text-[11px] text-text-secondary mt-0.5">새 요청은 승인 전까지 데이터를 읽을 수 없습니다.</p>
                </div>
                {membersLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-text-secondary" />}
              </div>
              {members.length === 0 ? (
                <div className="p-3.5 rounded-xl bg-surface-card border border-surface-border text-xs text-text-secondary">
                  대기 중이거나 활성화된 모바일 멤버가 없습니다.
                </div>
              ) : (
                <div className="space-y-2">
                  {members.map((member) => {
                    const approved = Boolean(member.approved_at);
                    const busy = memberActionId === member.id;
                    return (
                      <div key={member.id} className="p-3.5 rounded-xl bg-surface-card border border-surface-border flex items-center gap-3">
                        <Smartphone className="w-4 h-4 text-text-secondary flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-text-primary truncate">{member.display_name}</p>
                          <p className={`text-[10px] mt-0.5 ${approved ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {approved ? '승인됨' : '승인 대기'} · {member.role}
                          </p>
                        </div>
                        {!approved && (
                          <button type="button" disabled={busy} onClick={() => void changeMember(member, 'approve')} className="p-2 rounded-lg bg-emerald-500/15 text-emerald-400 disabled:opacity-50" aria-label={`${member.display_name} 승인`}>
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                          </button>
                        )}
                        <button type="button" disabled={busy} onClick={() => void changeMember(member, 'revoke')} className="p-2 rounded-lg bg-rose-500/10 text-rose-400 disabled:opacity-50" aria-label={`${member.display_name} 연결 해제`}>
                          {busy && approved ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <div className="w-full py-3 px-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-2 text-emerald-400 text-xs text-left"><ShieldCheck className="w-4 h-4 flex-shrink-0" /><span>QR에는 Supabase 프로젝트 URL과 5분 일회용 토큰만 포함됩니다. publishable/service-role key, DB 비밀번호, refresh token은 포함되지 않습니다.</span></div>
        </div>
      </div>
    </div>
  );
};
