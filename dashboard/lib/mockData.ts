import { Session, Step, DailyStat, MonthlyStat, YearlyStat } from './types';

export const MOCK_SESSIONS: Session[] = [
  {
    id: "33ca2b3d-ca0a-4ecf-8fe1-bbdba3741618",
    device_name: "Personal MacBook Pro",
    agent_type: "antigravity",
    model_name: "gemini-3-flash",
    title: "토큰 트래커 아키텍처 설계 및 대시보드 구축",
    started_at: "2026-08-18T10:00:00.000Z",
    updated_at: "2026-08-18T12:00:00.000Z",
    total_prompt_tokens: 42500,
    total_completion_tokens: 8300,
    total_tokens: 50800,
    estimated_cost_usd: 0.00757,
  },
  {
    id: "claude_sess_9a8b7c6d",
    device_name: "Office Mac Studio",
    agent_type: "claude_code",
    model_name: "claude-3-7-sonnet",
    title: "FastAPI 백엔드 인증 미들웨어 리팩토링",
    started_at: "2026-08-18T05:00:00.000Z",
    updated_at: "2026-08-18T06:00:00.000Z",
    total_prompt_tokens: 85200,
    total_completion_tokens: 14600,
    total_tokens: 99800,
    estimated_cost_usd: 0.4746,
  },
  {
    id: "codex_task_112233",
    device_name: "Personal MacBook Pro",
    agent_type: "codex",
    model_name: "gpt-4o",
    title: "Docker Compose 환경 배포 스크립트 작성",
    started_at: "2026-08-17T11:00:00.000Z",
    updated_at: "2026-08-17T12:00:00.000Z",
    total_prompt_tokens: 32000,
    total_completion_tokens: 5400,
    total_tokens: 37400,
    estimated_cost_usd: 0.134,
  },
  {
    id: "claude_sess_445566",
    device_name: "Home MacBook Air",
    agent_type: "claude_code",
    model_name: "claude-3-7-sonnet",
    title: "Next.js 14 App Router 마이그레이션",
    started_at: "2026-08-16T14:00:00.000Z",
    updated_at: "2026-08-16T15:00:00.000Z",
    total_prompt_tokens: 120500,
    total_completion_tokens: 22400,
    total_tokens: 142900,
    estimated_cost_usd: 0.6975,
  }
];

export const MOCK_STEPS: Record<string, Step[]> = {
  "33ca2b3d-ca0a-4ecf-8fe1-bbdba3741618": [
    {
      id: "step_0",
      session_id: "33ca2b3d-ca0a-4ecf-8fe1-bbdba3741618",
      device_name: "Personal MacBook Pro",
      step_index: 0,
      source: "user",
      action_type: "chat",
      prompt_tokens: 450,
      completion_tokens: 0,
      total_tokens: 450,
      preview_text: "안녕? 내가 ai를 사용할 때 작업당 토큰 사용량을 실시간으로 확인하고 싶어",
      timestamp: "2026-08-18T10:00:00.000Z",
    },
    {
      id: "step_1",
      session_id: "33ca2b3d-ca0a-4ecf-8fe1-bbdba3741618",
      device_name: "Personal MacBook Pro",
      step_index: 1,
      source: "assistant",
      action_type: "chat",
      prompt_tokens: 0,
      completion_tokens: 650,
      total_tokens: 650,
      preview_text: "AI 토큰 사용량을 추적하는 방법으로 LLM Observability, IDE 확장(Roo Code, Cline), 프록시 방식을 추천드립니다.",
      timestamp: "2026-08-18T10:00:15.000Z",
    },
    {
      id: "step_2",
      session_id: "33ca2b3d-ca0a-4ecf-8fe1-bbdba3741618",
      device_name: "Personal MacBook Pro",
      step_index: 2,
      source: "user",
      action_type: "chat",
      prompt_tokens: 1200,
      completion_tokens: 0,
      total_tokens: 1200,
      preview_text: "연간, 월별, 일자별, 대화별, 작업별로 추적하고 싶어. 구독제 계정이야.",
      timestamp: "2026-08-18T10:05:00.000Z",
    },
    {
      id: "step_3",
      session_id: "33ca2b3d-ca0a-4ecf-8fe1-bbdba3741618",
      device_name: "Personal MacBook Pro",
      step_index: 3,
      source: "assistant",
      action_type: "planning",
      prompt_tokens: 0,
      completion_tokens: 3200,
      total_tokens: 3200,
      preview_text: "구독제 환경을 위한 macOS FSEvents 로그 자동 수집 및 5단계 계층(연간/월별/일별/대화/스텝) 대시보드를 구축합니다.",
      timestamp: "2026-08-18T10:06:00.000Z",
    },
  ]
};

export const MOCK_YEARLY_STATS: YearlyStat[] = [
  { year: "2026", device_name: "All", agent_type: "All", session_count: 320, total_tokens: 12500000, total_prompt_tokens: 9800000, total_completion_tokens: 2700000, total_cost_usd: 54.80 },
  { year: "2025", device_name: "All", agent_type: "All", session_count: 163, total_tokens: 6200000, total_prompt_tokens: 4900000, total_completion_tokens: 1300000, total_cost_usd: 28.50 },
];

export const MOCK_MONTHLY_STATS: MonthlyStat[] = [
  { month: "2026-08", year: "2026", device_name: "All", agent_type: "All", session_count: 48, total_tokens: 1850000, total_prompt_tokens: 1450000, total_completion_tokens: 400000, total_cost_usd: 8.45 },
  { month: "2026-07", year: "2026", device_name: "All", agent_type: "All", session_count: 62, total_tokens: 2450000, total_prompt_tokens: 1950000, total_completion_tokens: 500000, total_cost_usd: 11.20 },
  { month: "2026-06", year: "2026", device_name: "All", agent_type: "All", session_count: 35, total_tokens: 1200000, total_prompt_tokens: 950000, total_completion_tokens: 250000, total_cost_usd: 5.60 },
];

export const MOCK_DAILY_STATS: DailyStat[] = [
  { date: "2026-08-18", month: "2026-08", year: "2026", device_name: "All", agent_type: "antigravity", model_name: "gemini-3-flash", session_count: 5, total_prompt_tokens: 95000, total_completion_tokens: 18000, total_tokens: 113000, total_cost_usd: 0.016 },
  { date: "2026-08-18", month: "2026-08", year: "2026", device_name: "All", agent_type: "claude_code", model_name: "claude-3-7-sonnet", session_count: 4, total_prompt_tokens: 140000, total_completion_tokens: 25000, total_tokens: 165000, total_cost_usd: 0.795 },
  { date: "2026-08-17", month: "2026-08", year: "2026", device_name: "All", agent_type: "claude_code", model_name: "claude-3-7-sonnet", session_count: 6, total_prompt_tokens: 210000, total_completion_tokens: 38000, total_tokens: 248000, total_cost_usd: 1.20 },
  { date: "2026-08-16", month: "2026-08", year: "2026", device_name: "All", agent_type: "codex", model_name: "gpt-4o", session_count: 3, total_prompt_tokens: 80000, total_completion_tokens: 15000, total_tokens: 95000, total_cost_usd: 0.35 },
  { date: "2026-08-15", month: "2026-08", year: "2026", device_name: "All", agent_type: "antigravity", model_name: "gemini-3-flash", session_count: 7, total_prompt_tokens: 130000, total_completion_tokens: 22000, total_tokens: 152000, total_cost_usd: 0.021 },
];
