-- ==========================================================
-- Agent Token Tracker - Supabase / PostgreSQL Database Schema
-- ==========================================================

-- 1. 대화 세션 테이블 (Level 3: 대화별)
CREATE TABLE IF NOT EXISTS public.sessions (
    id TEXT PRIMARY KEY,                             -- 세션/대화 고유 ID (UUID or agent session string)
    device_name TEXT NOT NULL DEFAULT 'Unknown Mac', -- 'MacBook-Pro-16', 'Work-Mac-Mini' 등
    user_email TEXT DEFAULT 'unknown',               -- 계정 이메일 (예: 'user@company.com', 'user@gmail.com')
    account_type TEXT DEFAULT 'personal',            -- 'work', 'personal', 'team'
    agent_type TEXT NOT NULL,                        -- 'antigravity', 'claude_code', 'codex', 'aider'
    model_name TEXT DEFAULT 'unknown',               -- 'gemini-3-flash', 'claude-3-7-sonnet', 'gpt-4o' 등
    title TEXT DEFAULT 'Untitled Session',           -- 대화명/작업 제목
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_prompt_tokens BIGINT DEFAULT 0,
    total_completion_tokens BIGINT DEFAULT 0,
    total_tokens BIGINT DEFAULT 0,
    estimated_cost_usd NUMERIC(10, 6) DEFAULT 0.0,
    is_archived BOOLEAN DEFAULT FALSE,               -- 로컬 삭제 시 아카이브 여부
    metadata JSONB DEFAULT '{}'::jsonb               -- 추가 메타데이터
);

-- 기존 테이블이 이미 존재하는 경우 컬럼 추가 마이그레이션
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='user_email') THEN
        ALTER TABLE public.sessions ADD COLUMN user_email TEXT DEFAULT 'unknown';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='account_type') THEN
        ALTER TABLE public.sessions ADD COLUMN account_type TEXT DEFAULT 'personal';
    END IF;
END $$;

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON public.sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON public.sessions (device_name);
CREATE INDEX IF NOT EXISTS idx_sessions_user_email ON public.sessions (user_email);
CREATE INDEX IF NOT EXISTS idx_sessions_account_type ON public.sessions (account_type);
CREATE INDEX IF NOT EXISTS idx_sessions_agent_type ON public.sessions (agent_type);
CREATE INDEX IF NOT EXISTS idx_sessions_model ON public.sessions (model_name);

-- 2. 세부 작업/스텝 테이블 (Level 4: 대화 내 세부 작업/턴별)
CREATE TABLE IF NOT EXISTS public.steps (
    id TEXT PRIMARY KEY,                             -- 스텝 고유 식별자 (session_id + '_' + step_index)
    session_id TEXT NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL DEFAULT 'Unknown Mac',
    user_email TEXT DEFAULT 'unknown',               -- 스텝 실행 시점의 계정 이메일
    account_type TEXT DEFAULT 'personal',            -- 'work', 'personal'
    step_index INT NOT NULL,                         -- 작업 순번 (0, 1, 2, ...)
    source TEXT NOT NULL DEFAULT 'assistant',        -- 'user', 'assistant', 'system', 'tool'
    action_type TEXT DEFAULT 'chat',                 -- 'chat', 'tool_call', 'code_edit', 'bash', 'thinking'
    prompt_tokens INT DEFAULT 0,
    completion_tokens INT DEFAULT 0,
    total_tokens INT DEFAULT 0,
    preview_text TEXT,                               -- 프롬프트/응답 미리보기 텍스트 (앞 300자)
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 기존 steps 테이블 컬럼 추가 마이그레이션
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='steps' AND column_name='user_email') THEN
        ALTER TABLE public.steps ADD COLUMN user_email TEXT DEFAULT 'unknown';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='steps' AND column_name='account_type') THEN
        ALTER TABLE public.steps ADD COLUMN account_type TEXT DEFAULT 'personal';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_steps_session_id ON public.steps (session_id, step_index ASC);
CREATE INDEX IF NOT EXISTS idx_steps_user_email ON public.steps (user_email);
CREATE INDEX IF NOT EXISTS idx_steps_timestamp ON public.steps (timestamp DESC);

-- 3. 일자별 통계 뷰 (Level 2: Daily View)
CREATE OR REPLACE VIEW public.v_daily_stats AS
SELECT 
    TO_CHAR(started_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS date,
    device_name,
    user_email,
    account_type,
    agent_type,
    model_name,
    COUNT(id) AS session_count,
    SUM(total_prompt_tokens) AS total_prompt_tokens,
    SUM(total_completion_tokens) AS total_completion_tokens,
    SUM(total_tokens) AS total_tokens,
    SUM(estimated_cost_usd) AS total_cost_usd
FROM public.sessions
WHERE is_archived = FALSE
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY date DESC;

-- 4. 월별 통계 뷰 (Level 1: Monthly View)
CREATE OR REPLACE VIEW public.v_monthly_stats AS
SELECT 
    TO_CHAR(started_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS month,
    device_name,
    user_email,
    account_type,
    agent_type,
    COUNT(id) AS session_count,
    SUM(total_tokens) AS total_tokens,
    SUM(estimated_cost_usd) AS total_cost_usd
FROM public.sessions
WHERE is_archived = FALSE
GROUP BY 1, 2, 3, 4, 5
ORDER BY month DESC;

-- 5. Row Level Security (RLS) 활성화 및 읽기/쓰기 허용 정책
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public all access on sessions" ON public.sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public all access on steps" ON public.steps FOR ALL USING (true) WITH CHECK (true);
