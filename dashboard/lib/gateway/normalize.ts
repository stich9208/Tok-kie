import type { Session as DomainSession, Step as DomainStep } from '../../../shared/domain';
import type { Session, Step } from '../types';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function nullableCost(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizedCostUsd(row: UnknownRecord): number | null {
  if (row.estimated_cost_usd !== undefined) return nullableCost(row.estimated_cost_usd);
  const microusd = nullableCost(row.estimated_cost_microusd);
  return microusd === null ? null : microusd / 1_000_000;
}

export function normalizeSession(value: DomainSession | unknown): Session {
  const row = record(value);
  const tokens = record(row.tokens);
  const metadata = record(row.metadata);

  return {
    id: stringValue(row.id),
    device_name: stringValue(row.device_name, stringValue(metadata.device_name, 'This device')),
    user_email: stringValue(row.user_email, stringValue(metadata.user_email, 'unknown')),
    account_type: stringValue(row.account_type, stringValue(metadata.account_type, 'personal')),
    agent_type: stringValue(row.agent_type, 'unknown'),
    model_name: stringValue(row.model_name, 'unknown'),
    title: stringValue(row.title, 'Untitled Session'),
    status: stringValue(row.status, 'completed'),
    is_interrupted: Boolean(row.is_interrupted),
    started_at: stringValue(row.started_at, new Date(0).toISOString()),
    updated_at: stringValue(row.updated_at, stringValue(row.started_at, new Date(0).toISOString())),
    total_prompt_tokens: numberValue(row.total_prompt_tokens ?? row.prompt_tokens ?? tokens.prompt),
    total_completion_tokens: numberValue(row.total_completion_tokens ?? row.completion_tokens ?? tokens.completion),
    total_tokens: numberValue(row.total_tokens ?? tokens.total),
    estimated_cost_usd: normalizedCostUsd(row),
    is_archived: Boolean(row.is_archived),
  };
}

export function normalizeStep(value: DomainStep | unknown): Step {
  const row = record(value);
  const tokens = record(row.tokens);

  return {
    id: stringValue(row.id),
    session_id: stringValue(row.session_id),
    device_name: stringValue(row.device_name, 'This device'),
    user_email: stringValue(row.user_email, 'unknown'),
    account_type: stringValue(row.account_type, 'personal'),
    step_index: numberValue(row.step_index),
    source: stringValue(row.source, 'assistant'),
    action_type: stringValue(row.action_type, 'chat'),
    status: stringValue(row.status, 'completed'),
    is_interrupted: Boolean(row.is_interrupted),
    prompt_tokens: numberValue(row.prompt_tokens ?? tokens.prompt),
    completion_tokens: numberValue(row.completion_tokens ?? tokens.completion),
    total_tokens: numberValue(row.total_tokens ?? tokens.total),
    preview_text: stringValue(row.preview_text),
    timestamp: stringValue(row.timestamp, stringValue(row.occurred_at, new Date(0).toISOString())),
  };
}
