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
  title: 'Tok-kie 🐰 | AI Coding Agent Token Tracker',
  description: 'A friendly, local-first token & cost tracker for AI coding agents (Claude Code, OpenAI Codex, Google Antigravity)',
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
