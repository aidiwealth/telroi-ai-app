export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

// Full endpoint allowlist excludes private hosts and provider redirect/proxy paths.
const allowedBaseUrls = new Set([
  DEFAULT_OPENAI_BASE_URL,
  'https://api.deepseek.com',
  'https://api.deepseek.com/v1',
  'https://api.moonshot.ai/v1',
  'https://api.moonshot.cn/v1',
  'https://api.groq.com/openai/v1',
  'https://openrouter.ai/api/v1',
  'https://integrate.api.nvidia.com/v1',
  'https://api.mistral.ai/v1',
  'https://api.cerebras.ai/v1',
  'https://api.together.xyz/v1',
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  'https://dashscope-us.aliyuncs.com/compatible-mode/v1'
]);

// Use the current field on APIs that deprecate max_tokens (or document it as
// an alias); the remaining endpoints document max_tokens as their field.
const completionTokenBaseUrls = new Set([
  DEFAULT_OPENAI_BASE_URL,
  'https://api.moonshot.ai/v1',
  'https://api.moonshot.cn/v1',
  'https://api.groq.com/openai/v1',
  'https://openrouter.ai/api/v1',
  'https://api.cerebras.ai/v1'
]);

export function resolveOpenAiBaseUrl(value: unknown): string {
  if (value === undefined || value === null) return DEFAULT_OPENAI_BASE_URL;
  if (typeof value !== 'string') throw new Error('Invalid OpenAI-compatible base URL');
  if (!value.trim()) return DEFAULT_OPENAI_BASE_URL;
  const normalized = value.trim().replace(/\/+$/, '');
  if (!allowedBaseUrls.has(normalized)) {
    throw new Error('Unsupported OpenAI-compatible base URL: use an approved HTTPS provider endpoint');
  }
  return normalized;
}

export function openAiTokenLimitField(baseUrl: unknown): 'max_tokens' | 'max_completion_tokens' {
  return completionTokenBaseUrls.has(resolveOpenAiBaseUrl(baseUrl))
    ? 'max_completion_tokens'
    : 'max_tokens';
}
