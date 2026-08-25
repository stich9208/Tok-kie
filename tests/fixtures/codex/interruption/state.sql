CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  title TEXT,
  first_user_message TEXT,
  source TEXT NOT NULL,
  tokens_used INTEGER NOT NULL,
  model TEXT,
  created_at INTEGER,
  status TEXT
);
INSERT INTO threads VALUES (
  'codex-interrupted-1', 'Interrupted run', 'Stop this run.', '{"status":"interrupted"}',
  20, 'gpt-5', 1767225600, 'completed'
);
