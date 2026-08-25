export interface Session {
  id: string;
  device_name: string;
  user_email?: string;
  account_type?: 'work' | 'personal' | string;
  agent_type: 'antigravity' | 'claude_code' | 'codex' | 'aider' | string;
  model_name: string;
  title: string;
  status?: 'completed' | 'interrupted' | 'running' | string;
  is_interrupted?: boolean;
  started_at: string;
  updated_at: string;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  /** Null means the model has no defensible versioned price estimate. */
  estimated_cost_usd: number | null;
  is_archived?: boolean;
}

export interface Step {
  id: string;
  session_id: string;
  device_name: string;
  user_email?: string;
  account_type?: 'work' | 'personal' | string;
  step_index: number;
  source: 'user' | 'assistant' | 'tool' | 'system' | string;
  action_type: string;
  status?: string;
  is_interrupted?: boolean;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  preview_text: string;
  timestamp: string;
}

export interface DailyStat {
  date: string;       // YYYY-MM-DD
  month: string;      // YYYY-MM
  year: string;       // YYYY
  device_name: string;
  user_email?: string;
  account_type?: string;
  agent_type: string;
  model_name: string;
  session_count: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
}

export interface MonthlyStat {
  month: string;      // YYYY-MM
  year: string;       // YYYY
  device_name: string;
  user_email?: string;
  account_type?: string;
  agent_type: string;
  session_count: number;
  total_tokens: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cost_usd: number;
}

export interface YearlyStat {
  year: string;       // YYYY
  device_name: string;
  user_email?: string;
  account_type?: string;
  agent_type: string;
  session_count: number;
  total_tokens: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cost_usd: number;
}
