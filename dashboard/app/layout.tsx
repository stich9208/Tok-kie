import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="ko" className="dark">
      <body className="bg-canvas text-text-primary min-h-screen font-sans antialiased selection:bg-lavender-accent/30 selection:text-white">
        {children}
      </body>
    </html>
  );
}
