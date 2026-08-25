CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  title TEXT,
  first_user_message TEXT,
  source TEXT NOT NULL,
  tokens_used INTEGER NOT NULL,
  model TEXT,
  created_at INTEGER,
  agent_nickname TEXT,
  agent_role TEXT,
  rollout_path TEXT
);
INSERT INTO threads VALUES ('codex-root-1', 'Implement parser', 'Implement the parser contract.', '{}', 100, 'gpt-test', 1767225600, NULL, NULL, NULL);
INSERT INTO threads VALUES ('codex-child-1', 'Review edge cases', 'Review malformed and truncation cases.', '{"subagent":{"thread_spawn":{"parent_thread_id":"codex-root-1","agent_nickname":"reviewer","agent_path":"/root/reviewer","depth":1}}}', 50, 'gpt-test', 1767225660, 'reviewer', 'review', NULL);
