import type { DailyStat, MonthlyStat, Session, YearlyStat } from './types';

export function safeIsoDate(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return new Date(0).toISOString();
  const milliseconds = typeof value === 'number' && value < 10_000_000_000 ? value * 1_000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

export function aggregateSessions(sessions: Session[]): {
  dailyStats: DailyStat[];
  monthlyStats: MonthlyStat[];
  yearlyStats: YearlyStat[];
  totalTokens: number;
  totalCostUsd: number;
  unpricedSessions: number;
} {
  const dailyMap: Record<string, DailyStat> = {};
  const monthlyMap: Record<string, MonthlyStat> = {};
  const yearlyMap: Record<string, YearlyStat> = {};

  sessions.forEach((session) => {
    const iso = safeIsoDate(session.started_at);
    const date = iso.slice(0, 10);
    const month = iso.slice(0, 7);
    const year = iso.slice(0, 4);
    const deviceName = session.device_name || 'This device';
    const agentName = session.agent_type || 'unknown';
    const userEmail = session.user_email || 'unknown';
    const accountType = session.account_type || 'personal';

    if (!dailyMap[date]) {
      dailyMap[date] = {
        date,
        month,
        year,
        device_name: deviceName,
        user_email: userEmail,
        account_type: accountType,
        agent_type: agentName,
        model_name: session.model_name || 'unknown',
        session_count: 0,
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_tokens: 0,
        total_cost_usd: 0,
      };
    }
    dailyMap[date].session_count += 1;
    dailyMap[date].total_prompt_tokens += Number(session.total_prompt_tokens) || 0;
    dailyMap[date].total_completion_tokens += Number(session.total_completion_tokens) || 0;
    dailyMap[date].total_tokens += Number(session.total_tokens) || 0;
    dailyMap[date].total_cost_usd += Number(session.estimated_cost_usd) || 0;

    if (!monthlyMap[month]) {
      monthlyMap[month] = {
        month,
        year,
        device_name: deviceName,
        user_email: userEmail,
        account_type: accountType,
        agent_type: agentName,
        session_count: 0,
        total_tokens: 0,
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_cost_usd: 0,
      };
    }
    monthlyMap[month].session_count += 1;
    monthlyMap[month].total_prompt_tokens += Number(session.total_prompt_tokens) || 0;
    monthlyMap[month].total_completion_tokens += Number(session.total_completion_tokens) || 0;
    monthlyMap[month].total_tokens += Number(session.total_tokens) || 0;
    monthlyMap[month].total_cost_usd += Number(session.estimated_cost_usd) || 0;

    if (!yearlyMap[year]) {
      yearlyMap[year] = {
        year,
        device_name: deviceName,
        user_email: userEmail,
        account_type: accountType,
        agent_type: agentName,
        session_count: 0,
        total_tokens: 0,
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_cost_usd: 0,
      };
    }
    yearlyMap[year].session_count += 1;
    yearlyMap[year].total_prompt_tokens += Number(session.total_prompt_tokens) || 0;
    yearlyMap[year].total_completion_tokens += Number(session.total_completion_tokens) || 0;
    yearlyMap[year].total_tokens += Number(session.total_tokens) || 0;
    yearlyMap[year].total_cost_usd += Number(session.estimated_cost_usd) || 0;
  });

  return {
    dailyStats: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
    monthlyStats: Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month)),
    yearlyStats: Object.values(yearlyMap).sort((a, b) => a.year.localeCompare(b.year)),
    totalTokens: sessions.reduce((total, session) => total + (Number(session.total_tokens) || 0), 0),
    totalCostUsd: sessions.reduce((total, session) => total + (Number(session.estimated_cost_usd) || 0), 0),
    unpricedSessions: sessions.filter((session) => session.estimated_cost_usd === null).length,
  };
}
