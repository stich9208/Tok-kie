'use client';

import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, QrCode, X, Copy, Check, ExternalLink, Sparkles, ShieldCheck, Share2 } from 'lucide-react';

interface MobilePairingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MobilePairingModal: React.FC<MobilePairingModalProps> = ({ isOpen, onClose }) => {
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [webHostUrl, setWebHostUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // 1. Set default web host
      if (typeof window !== 'undefined') {
        const defaultHost = window.location.origin.includes('localhost')
          ? 'https://tok-kie.vercel.app'
          : window.location.origin;
        setWebHostUrl(defaultHost);
      }

      // 2. Fetch configured Supabase credentials from local server
      fetch('/api/config')
        .then(res => res.json())
        .then(data => {
          setIsConfigured(data.configured);
          if (data.supabaseUrl) setSupabaseUrl(data.supabaseUrl);
        })
        .catch(() => {});

      // Check localStorage as well
      if (typeof window !== 'undefined') {
        const savedUrl = localStorage.getItem('tokkie_supabase_url');
        const savedKey = localStorage.getItem('tokkie_supabase_key');
        if (savedUrl && savedKey) {
          setSupabaseUrl(savedUrl);
          setSupabaseKey(savedKey);
          setIsConfigured(true);
        }
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Generate pairing payload
  const generatePairingUrl = () => {
    if (!supabaseUrl && !supabaseKey) return webHostUrl;
    try {
      const payload = JSON.stringify({ url: supabaseUrl, key: supabaseKey });
      const encoded = btoa(unescape(encodeURIComponent(payload)));
      return `${webHostUrl}/#sync=${encoded}`;
    } catch {
      return webHostUrl;
    }
  };

  const pairingUrl = generatePairingUrl();

  const handleCopyLink = () => {
    navigator.clipboard.writeText(pairingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 pt-16 sm:pt-24 bg-black/65 backdrop-blur-sm animate-in fade-in duration-200 app-no-drag select-text overflow-y-auto custom-scrollbar">
      <div className="bg-surface-nav border border-surface-border w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 mb-8">
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-surface-border flex items-center justify-between bg-surface-card/40 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-lavender-accent/15 border border-lavender-accent/30 flex items-center justify-center text-lavender-accent flex-shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary flex items-center gap-1.5">
                모바일 1초 연동 <span className="text-sm">🐰</span>
              </h2>
              <p className="text-xs sm:text-sm text-text-secondary mt-0.5">회원가입 없이 QR 코드로 내 폰과 1초 직결</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-text-secondary hover:text-text-primary hover:bg-surface-border/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 sm:p-7 flex flex-col items-center text-center space-y-5 overflow-y-auto custom-scrollbar flex-1">
          {/* QR Code Container */}
          <div className="p-4 bg-white rounded-2xl shadow-xl border border-neutral-200 flex items-center justify-center relative group">
            <QRCodeSVG
              value={pairingUrl}
              size={200}
              level="M"
              includeMargin={false}
            />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-base font-bold text-text-primary flex items-center justify-center gap-1.5">
              <span>스마트폰 카메라로 스캔하세요</span>
              <Sparkles className="w-4 h-4 text-amber-accent" />
            </h3>
            <p className="text-xs sm:text-sm text-text-secondary max-w-sm leading-relaxed">
              아이폰 기본 카메라 앱으로 QR 코드를 비추면 모바일 대시보드가 즉시 열리고 페어링됩니다.
            </p>
          </div>

          {/* Privacy Badge */}
          <div className="w-full py-2.5 px-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center gap-2 text-emerald-400 text-xs sm:text-sm">
            <ShieldCheck className="w-4 h-4 flex-shrink-0" />
            <span>중앙 서버 0원 / 내 폰과 내 DB 1:1 직통 암호화 연결</span>
          </div>

          {/* Web Host Configuration */}
          <div className="w-full text-left space-y-2 pt-1">
            <label className="block text-xs sm:text-sm font-bold text-text-primary">
              배포된 웹 주소 (Vercel URL)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={webHostUrl}
                onChange={e => setWebHostUrl(e.target.value)}
                placeholder="https://tok-kie.vercel.app"
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-surface-card border border-surface-border text-text-primary text-xs sm:text-sm font-mono focus:outline-none focus:border-lavender-accent transition-colors shadow-sm"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                title="페어링 링크 복사"
                className="p-2.5 rounded-xl bg-surface-card border border-surface-border text-text-secondary hover:text-text-primary transition-colors flex items-center justify-center"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* iPhone Home Screen Tip */}
          <div className="w-full p-3.5 rounded-2xl bg-surface-card border border-surface-border text-left space-y-1.5 text-xs text-text-secondary">
            <div className="font-bold text-text-primary flex items-center gap-1.5 text-xs sm:text-sm">
              <Share2 className="w-4 h-4 text-lavender-accent" />
              <span>📱 아이폰 앱처럼 홈 화면에 추가하는 법</span>
            </div>
            <p className="text-[11px] sm:text-xs leading-relaxed text-text-secondary">
              Safari 하단의 <b>공유 버튼</b> ➔ <b>[홈 화면에 추가]</b>를 누르면 아이폰 바탕화면에 <b>Tok-kie 🐰</b> 네이티브 앱 아이콘이 생성됩니다!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
