import type { Metadata } from 'next';
import { Playfair_Display, Sora } from 'next/font/google';
import './globals.css';

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
});

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-sora',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Lumina Ledger - Joyful Agent Monitoring',
  description: 'Claude Code, Antigravity, Codex 등 멀티 Mac 코딩 에이전트 실시간 토큰 & 비용 통합 모니터링',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className={`dark ${playfair.variable} ${sora.variable}`}>
      <body className="bg-canvas text-text-primary min-h-screen font-sans antialiased selection:bg-lavender-accent/30 selection:text-white">
        {children}
      </body>
    </html>
  );
}
