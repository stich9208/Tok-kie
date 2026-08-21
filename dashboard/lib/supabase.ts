import { createClient } from '@supabase/supabase-js';
import { Session, Step, DailyStat, MonthlyStat, YearlyStat } from './types';

// Helper to extract credentials from URL Hash (#sync=...), LocalStorage, or Environment Variables
export function getSupabaseCredentials(): { url: string; key: string } {
  if (typeof window === 'undefined') {
    return {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    };
  }

  // 1. Check URL Hash for #sync=<base64> (QR Code Pairing)
  if (window.location.hash && window.location.hash.includes('sync=')) {
    try {
      const match = window.location.hash.match(/sync=([^&]+)/);
      if (match && match[1]) {
        const decoded = JSON.parse(decodeURIComponent(escape(atob(match[1]))));
        if (decoded.url && decoded.key) {
          localStorage.setItem('tokkie_supabase_url', decoded.url);
          localStorage.setItem('tokkie_supabase_key', decoded.key);
          // Clean up address bar URL
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
          return { url: decoded.url, key: decoded.key };
        }
      }
    } catch (e) {
      console.warn('Failed to parse #sync hash from URL:', e);
    }
  }

  // 2. Check localStorage
  const savedUrl = localStorage.getItem('tokkie_supabase_url');
  const savedKey = localStorage.getItem('tokkie_supabase_key');
  if (savedUrl && savedKey) {
    return { url: savedUrl, key: savedKey };
  }

  // 3. Fallback to process.env
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  };
}

export function getSupabaseClient() {
  const creds = getSupabaseCredentials();
  if (creds.url && creds.key) {
    return createClient(creds.url, creds.key);
  }
  return null;
}

export const supabase = (typeof window !== 'undefined')
  ? getSupabaseClient()
  : ((process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      : null);

export function safeIsoDate(iso: any): string {
  if (!iso) return new Date().toISOString();
  if (typeof iso === 'number') {
    const ms = iso < 10000000000 ? iso * 1000 : iso;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  if (typeof iso === 'string') {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  return new Date().toISOString();
}

export function aggregateSessions(sessions: Session[]): {
  dailyStats: DailyStat[];
  monthlyStats: MonthlyStat[];
  yearlyStats: YearlyStat[];
  totalTokens: number;
  totalCostUsd: number;
} {
  const dailyMap: Record<string, DailyStat> = {};
  const monthlyMap: Record<string, MonthlyStat> = {};
  const yearlyMap: Record<string, YearlyStat> = {};

  sessions.forEach(s => {
    const iso = safeIsoDate(s.started_at);
    const dStr = iso.slice(0, 10); // YYYY-MM-DD
    const mStr = iso.slice(0, 7);  // YYYY-MM
    const yStr = iso.slice(0, 4);  // YYYY

    const devName = s.device_name || 'MacBook';
    const agentName = s.agent_type || 'general';
    const userEmail = s.user_email || 'unknown';
    const accountType = s.account_type || 'personal';

    // 1. Daily: Pure date-level aggregation (unique per YYYY-MM-DD)
    if (!dailyMap[dStr]) {
      dailyMap[dStr] = {
        date: dStr,
        month: mStr,
        year: yStr,
        device_name: devName,
        user_email: userEmail,
        account_type: accountType,
        agent_type: agentName,
        model_name: s.model_name || 'unknown',
        session_count: 0,
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_tokens: 0,
        total_cost_usd: 0
      };
    }
    dailyMap[dStr].session_count += 1;
    dailyMap[dStr].total_prompt_tokens += Number(s.total_prompt_tokens) || 0;
    dailyMap[dStr].total_completion_tokens += Number(s.total_completion_tokens) || 0;
    dailyMap[dStr].total_tokens += Number(s.total_tokens) || 0;
    dailyMap[dStr].total_cost_usd += Number(s.estimated_cost_usd) || 0;

    // 2. Monthly: Pure month-level aggregation (unique per YYYY-MM)
    if (!monthlyMap[mStr]) {
      monthlyMap[mStr] = {
        month: mStr,
        year: yStr,
        device_name: devName,
        user_email: userEmail,
        account_type: accountType,
        agent_type: agentName,
        session_count: 0,
        total_tokens: 0,
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_cost_usd: 0
      };
    }
    monthlyMap[mStr].session_count += 1;
    monthlyMap[mStr].total_prompt_tokens += Number(s.total_prompt_tokens) || 0;
    monthlyMap[mStr].total_completion_tokens += Number(s.total_completion_tokens) || 0;
    monthlyMap[mStr].total_tokens += Number(s.total_tokens) || 0;
    monthlyMap[mStr].total_cost_usd += Number(s.estimated_cost_usd) || 0;

    // 3. Yearly: Pure year-level aggregation (unique per YYYY)
    if (!yearlyMap[yStr]) {
      yearlyMap[yStr] = {
        year: yStr,
        device_name: devName,
        user_email: userEmail,
        account_type: accountType,
        agent_type: agentName,
        session_count: 0,
        total_tokens: 0,
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_cost_usd: 0
      };
    }
    yearlyMap[yStr].session_count += 1;
    yearlyMap[yStr].total_prompt_tokens += Number(s.total_prompt_tokens) || 0;
    yearlyMap[yStr].total_completion_tokens += Number(s.total_completion_tokens) || 0;
    yearlyMap[yStr].total_tokens += Number(s.total_tokens) || 0;
    yearlyMap[yStr].total_cost_usd += Number(s.estimated_cost_usd) || 0;
  });

  const totalTokens = sessions.reduce((acc, s) => acc + (Number(s.total_tokens) || 0), 0);
  const totalCostUsd = sessions.reduce((acc, s) => acc + (Number(s.estimated_cost_usd) || 0), 0);

  return {
    // Chronological ASCENDING order for clean graphs!
    dailyStats: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
    monthlyStats: Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month)),
    yearlyStats: Object.values(yearlyMap).sort((a, b) => a.year.localeCompare(b.year)),
    totalTokens,
    totalCostUsd
  };
}

export async function fetchSessions(deviceName?: string, agentType?: string, userEmail?: string): Promise<Session[]> {
  if (!supabase) {
    try {
      const res = await fetch('/api/local-data');
      if (res.ok) {
        const json = await res.json();
        if (json.sessions && Array.isArray(json.sessions) && json.sessions.length > 0) {
          let list: Session[] = json.sessions;
          if (deviceName && deviceName !== 'All') {
            list = list.filter(s => s.device_name === deviceName);
          }
          if (agentType && agentType !== 'All') {
            list = list.filter(s => s.agent_type === agentType);
          }
          if (userEmail && userEmail !== 'All') {
            list = list.filter(s => s.user_email === userEmail);
          }
          return list;
        }
      }
    } catch (e) {
      console.warn('Local offline SQLite DB fetch failed, using fallback:', e);
    }
    return [];
  }

  try {
    let query = supabase
      .from('sessions')
      .select('*')
      .order('started_at', { ascending: false });

    if (deviceName && deviceName !== 'All') {
      query = query.eq('device_name', deviceName);
    }
    if (agentType && agentType !== 'All') {
      query = query.eq('agent_type', agentType);
    }
    if (userEmail && userEmail !== 'All') {
      query = query.eq('user_email', userEmail);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((d: any) => ({
      ...d,
      started_at: safeIsoDate(d.started_at),
    }));
  } catch (err) {
    console.error('Supabase fetchSessions error:', err);
    return [];
  }
}

export async function fetchSteps(sessionId: string): Promise<Step[]> {
  if (!supabase) {
    try {
      const res = await fetch(`/api/local-data?session_id=${encodeURIComponent(sessionId)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.steps && Array.isArray(json.steps)) {
          return json.steps;
        }
      }
    } catch (e) {
      console.warn('Local steps fetch failed:', e);
    }
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('steps')
      .select('*')
      .eq('session_id', sessionId)
      .order('step_index', { ascending: true });

    if (error) throw error;
    return (data || []).map((d: any) => ({
      ...d,
      timestamp: safeIsoDate(d.timestamp),
    }));
  } catch (err) {
    console.error('Supabase fetchSteps error:', err);
    return [];
  }
}
