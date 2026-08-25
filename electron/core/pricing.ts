import type { CostEstimate, TokenUsage } from '../../shared/domain';

export const MODEL_PRICING_VERSION = 'standard-usd-per-mtok-2026-08-24-v1';

interface ModelPrice {
  readonly aliases: readonly RegExp[];
  readonly input: number;
  readonly output: number;
}

// Standard first-party API text-token prices, verified 2026-08-24 against:
// https://openai.com/api/pricing/
// https://platform.claude.com/docs/en/about-claude/pricing
// https://ai.google.dev/gemini-api/docs/pricing
// Cache, batch, regional, long-context, audio and marketplace adjustments are
// intentionally outside this estimate. Unknown/unmatched models remain unpriced.
const MODEL_PRICES: readonly ModelPrice[] = [
  { aliases: [/^gpt-5\.6-sol(?:-|$)/i], input: 5, output: 30 },
  { aliases: [/^gpt-5\.6-terra(?:-|$)/i], input: 2, output: 12 },
  { aliases: [/^gpt-5\.6-luna(?:-|$)/i], input: 0.2, output: 1.2 },
  { aliases: [/^gpt-5-mini(?:-|$)/i], input: 0.25, output: 2 },
  { aliases: [/^gpt-5-nano(?:-|$)/i], input: 0.05, output: 0.4 },
  { aliases: [/^gpt-5(?:-2025-08-07|-chat-latest)?$/i], input: 1.25, output: 10 },
  { aliases: [/^claude-sonnet-5(?:-|$)/i], input: 2, output: 10 },
  { aliases: [/^claude-(?:sonnet-4(?:-[56])?|4-[56]-sonnet)(?:-|$)/i], input: 3, output: 15 },
  { aliases: [/^claude-(?:opus-(?:5|4-[5678])|(?:5|4-[5678])-opus)(?:-|$)/i], input: 5, output: 25 },
  { aliases: [/^claude-haiku-4-5(?:-|$)/i], input: 1, output: 5 },
  { aliases: [/^gemini-3-flash(?:-preview)?$/i], input: 0.5, output: 3 },
];

export interface EstimatedModelCost {
  readonly usd: number | null;
  readonly estimate: CostEstimate;
}

export function estimateModelCost(modelName: string, tokens: TokenUsage): EstimatedModelCost {
  const price = MODEL_PRICES.find((candidate) => candidate.aliases.some((alias) => alias.test(modelName.trim())));
  if (!price) {
    return {
      usd: null,
      estimate: { status: 'unavailable', pricing_version: MODEL_PRICING_VERSION, reason: 'unknown_model' },
    };
  }
  const usd = (tokens.prompt * price.input + tokens.completion * price.output) / 1_000_000;
  return {
    usd,
    estimate: {
      status: 'estimated',
      pricing_version: MODEL_PRICING_VERSION,
      input_usd_per_million: price.input,
      output_usd_per_million: price.output,
    },
  };
}
