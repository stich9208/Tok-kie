'use client';

import React, { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export const ThemeToggle: React.FC = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const saved = localStorage.getItem('lumina_theme') as 'dark' | 'light' | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.classList.toggle('dark', saved === 'dark');
      document.documentElement.classList.toggle('light', saved === 'light');
    } else {
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('lumina_theme', nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
    document.documentElement.classList.toggle('light', nextTheme === 'light');
  };

  return (
    <button
      onClick={toggleTheme}
      title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
      className="p-2 rounded-full bg-surface-card border border-surface-border text-text-secondary hover:text-text-primary transition-all active:scale-95"
      aria-label="Toggle Theme"
    >
      {theme === 'dark' ? (
        <Sun className="w-4 h-4 text-amber-accent" />
      ) : (
        <Moon className="w-4 h-4 text-lavender-accent" />
      )}
    </button>
  );
};
