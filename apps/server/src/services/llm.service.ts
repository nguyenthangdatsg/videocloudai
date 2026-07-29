import { getSettings } from './settings.service';

export interface LlmRequest {
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
}

type Provider = 'gemini' | 'groq' | 'anthropic' | 'openrouter' | 'cerebras' | 'grok' | 'openai';

const PROVIDER_KEY: Record<Provider, string> = {
  gemini: 'gemini_api_key',
  groq: 'groq_api_key',
  anthropic: 'anthropic_api_key',
  openrouter: 'openrouter_api_key',
  cerebras: 'cerebras_api_key',
  grok: 'grok_api_key',
  openai: 'openai_api_key',
};

const PROVIDER_FN: Record<Provider, (req: LlmRequest, s: ReturnType<typeof getSettings>) => Promise<string>> = {
  gemini: geminiComplete,
  groq: groqComplete,
  anthropic: anthropicComplete,
  openrouter: openrouterComplete,
  cerebras: cerebrasComplete,
  grok: grokComplete,
  openai: openaiComplete,
};

let _lastUsedModel = '';
/** Returns the provider:model string from the most recent llmComplete call. */
export function getLastUsedModel(): string { return _lastUsedModel; }

const MODEL_KEY: Record<Provider, string> = {
  gemini: 'gemini_model', groq: 'groq_model', anthropic: 'anthropic_model',
  openrouter: 'openrouter_model', cerebras: 'cerebras_model', grok: 'grok_model', openai: 'openai_model',
};
const MODEL_DEFAULT: Record<Provider, string> = {
  gemini: 'gemini-2.5-flash', groq: 'llama-3.3-70b-versatile', anthropic: 'claude-sonnet-4-6',
  openrouter: 'meta-llama/llama-3.3-70b-instruct:free', cerebras: 'llama-3.3-70b',
  grok: 'grok-3-mini', openai: 'gpt-4o-mini',
};
/** Fallback models to try within a provider when configured model hits quota/rate limit */
const MODEL_FALLBACKS: Record<Provider, string[]> = {
  gemini:     ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite'],
  groq:       ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  anthropic:  ['claude-haiku-4-5-20251001', 'claude-3-5-haiku-20241022'],
  openrouter: ['google/gemma-3-27b-it:free', 'mistralai/mistral-7b-instruct:free'],
  cerebras:   ['llama-3.1-70b'],
  grok:       ['grok-3-mini-fast'],
  openai:     ['gpt-3.5-turbo'],
};

/**
 * Unified LLM completion — dispatches to configured provider.
 * Falls back to other models within the same provider on quota errors,
 * then falls back to other providers on persistent failures.
 */
export async function llmComplete(req: LlmRequest): Promise<string> {
  const s = getSettings();
  const preferred = (s.get('llm_provider') || 'gemini') as Provider;

  // Build ordered fallback chain: preferred first, then others with keys
  const all: Provider[] = ['gemini', 'groq', 'grok', 'openai', 'anthropic', 'openrouter', 'cerebras'];
  const chain = [preferred, ...all.filter(p => p !== preferred)].filter(p => s.get(PROVIDER_KEY[p]));

  if (chain.length === 0) {
    throw new Error('No LLM provider configured. Add an API key in Settings.');
  }

  const isQuotaError = (msg: string) =>
    msg.includes('429') || msg.includes('rate_limit') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');

  let lastError: Error | null = null;
  const failedProviders: string[] = [];

  for (const provider of chain) {
    // Build model list: configured model first, then fallbacks (deduplicated)
    const configuredModel = s.get(MODEL_KEY[provider]) || MODEL_DEFAULT[provider];
    const fallbacks = MODEL_FALLBACKS[provider].filter(m => m !== configuredModel);
    const modelsToTry = [configuredModel, ...fallbacks];

    let providerSucceeded = false;
    for (const model of modelsToTry) {
      try {
        // Create a settings view that returns the override model for this provider's model key
        const overrideSettings = Object.create(s) as ReturnType<typeof getSettings>;
        overrideSettings.get = (key: string) => key === MODEL_KEY[provider] ? model : s.get(key);
        const result = await PROVIDER_FN[provider](req, overrideSettings);
        _lastUsedModel = `${provider}/${model}`;
        if (model !== configuredModel) {
          console.info(`[LLM] ${provider} fell back to model ${model} (configured: ${configuredModel})`);
        }
        providerSucceeded = true;
        return result;
      } catch (err) {
        lastError = err as Error;
        if (isQuotaError(lastError.message) && model !== modelsToTry[modelsToTry.length - 1]) {
          console.warn(`[LLM] ${provider}/${model} quota exceeded, trying ${modelsToTry[modelsToTry.indexOf(model) + 1]}...`);
          continue;
        }
        break; // non-quota error or last model — move to next provider
      }
    }

    if (!providerSucceeded) {
      const isRateLimit = isQuotaError(lastError?.message || '');
      const isServerError = lastError?.message.includes('503') || lastError?.message.includes('500');
      const reason = isRateLimit ? 'quota exceeded' : isServerError ? 'server error' : 'failed';
      failedProviders.push(`${provider} (${reason})`);
      console.warn(`[LLM] ${provider} exhausted all models: ${lastError?.message}${chain.indexOf(provider) < chain.length - 1 ? ', trying next provider...' : ''}`);
    }
  }

  // Build a clear, user-friendly error message
  const allRateLimited = failedProviders.every(p => p.includes('quota exceeded'));
  if (allRateLimited) {
    throw new Error(`All AI providers are quota-exceeded (${failedProviders.map(p => p.split(' (')[0]).join(', ')}). Please wait a few minutes and try again.`);
  }
  const allServerError = failedProviders.every(p => p.includes('server error'));
  if (allServerError) {
    throw new Error(`All AI providers returned server errors (${failedProviders.map(p => p.split(' (')[0]).join(', ')}). Please try again later.`);
  }
  throw new Error(`All AI providers failed: ${failedProviders.join(', ')}. Check your API keys in Settings.`);
}

// ── Gemini (Google AI) ──

async function geminiComplete(req: LlmRequest, s: ReturnType<typeof getSettings>): Promise<string> {
  const apiKey = s.get('gemini_api_key');
  const model = s.get('gemini_model') || 'gemini-2.5-flash';
  if (!apiKey) throw new Error('Gemini API key not configured');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: req.userMessage }] }],
        generationConfig: {
          temperature: req.temperature ?? 0.8,
          maxOutputTokens: req.maxTokens ?? 1024,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    const short = extractApiErrorMessage(err, 'Gemini', res.status);
    throw new Error(short);
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}

// ── Groq (OpenAI-compatible) ──

function groqComplete(req: LlmRequest, s: ReturnType<typeof getSettings>): Promise<string> {
  const apiKey = s.get('groq_api_key');
  const model = s.get('groq_model') || 'openai/gpt-oss-120b';
  if (!apiKey) throw new Error('Groq API key not configured');

  return openaiCompatible({
    url: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey,
    model,
    ...req,
  });
}

// ── Anthropic (Claude) ──

async function anthropicComplete(req: LlmRequest, s: ReturnType<typeof getSettings>): Promise<string> {
  const apiKey = s.get('anthropic_api_key');
  const model = s.get('anthropic_model') || 'claude-sonnet-4-6';
  if (!apiKey) throw new Error('Anthropic API key not configured');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 1024,
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.userMessage }],
      temperature: req.temperature ?? 0.8,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    const short = extractApiErrorMessage(err, 'Anthropic', res.status);
    throw new Error(short);
  }

  const data = await res.json() as {
    content: Array<{ type: string; text: string }>;
  };
  const text = data.content?.find((c) => c.type === 'text')?.text?.trim();
  if (!text) throw new Error('Empty response from Anthropic');
  return text;
}

// ── OpenRouter (free models available) ──

function openrouterComplete(req: LlmRequest, s: ReturnType<typeof getSettings>): Promise<string> {
  const apiKey = s.get('openrouter_api_key');
  const model = s.get('openrouter_model') || 'meta-llama/llama-3.3-70b-instruct:free';
  if (!apiKey) throw new Error('OpenRouter API key not configured');

  return openaiCompatible({
    url: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey,
    model,
    ...req,
  });
}

// ── Cerebras (ultra-fast inference) ──

function cerebrasComplete(req: LlmRequest, s: ReturnType<typeof getSettings>): Promise<string> {
  const apiKey = s.get('cerebras_api_key');
  const model = s.get('cerebras_model') || 'gpt-oss-120b';
  if (!apiKey) throw new Error('Cerebras API key not configured');

  return openaiCompatible({
    url: 'https://api.cerebras.ai/v1/chat/completions',
    apiKey,
    model,
    ...req,
  });
}

// ── Grok (xAI, OpenAI-compatible) ──

function grokComplete(req: LlmRequest, s: ReturnType<typeof getSettings>): Promise<string> {
  const apiKey = s.get('grok_api_key');
  const model = s.get('grok_model') || 'grok-3-mini';
  if (!apiKey) throw new Error('Grok API key not configured');

  return openaiCompatible({
    url: 'https://api.x.ai/v1/chat/completions',
    apiKey,
    model,
    ...req,
  });
}

// ── OpenAI (ChatGPT) ──

function openaiComplete(req: LlmRequest, s: ReturnType<typeof getSettings>): Promise<string> {
  const apiKey = s.get('openai_api_key');
  const model = s.get('openai_model') || 'gpt-4o-mini';
  if (!apiKey) throw new Error('OpenAI API key not configured');

  return openaiCompatible({
    url: 'https://api.openai.com/v1/chat/completions',
    apiKey,
    model,
    ...req,
  });
}

// ── OpenAI-compatible helper ──

async function openaiCompatible(opts: {
  url: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const res = await fetch(opts.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: opts.userMessage },
      ],
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.maxTokens ?? 800,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    const provider = opts.url.includes('groq') ? 'Groq' : opts.url.includes('cerebras') ? 'Cerebras' : opts.url.includes('openrouter') ? 'OpenRouter' : opts.url.includes('x.ai') ? 'Grok' : opts.url.includes('openai.com') ? 'OpenAI' : 'LLM';
    const short = extractApiErrorMessage(err, provider, res.status);
    throw new Error(short);
  }

  const data = await res.json() as { choices: Array<{ message: { content?: string; reasoning?: string } }> };
  const msg = data.choices?.[0]?.message;
  const text = (msg?.content || msg?.reasoning)?.trim();
  if (!text) throw new Error('Empty response from LLM');
  return text;
}

/** Extract a short, user-readable error message from an API error response */
function extractApiErrorMessage(raw: string, provider: string, status: number): string {
  // Try to parse JSON and extract the message field
  try {
    const json = JSON.parse(raw);
    const msg = json?.error?.message || json?.message || json?.error || '';
    if (typeof msg === 'string' && msg.length > 0) {
      // Extract retry time if present
      const retryMatch = msg.match(/retry in ([\d.]+[a-z]+)/i) || msg.match(/Please try again in ([\w\d.]+)/i);
      const retry = retryMatch ? ` Retry in ${retryMatch[1]}.` : '';
      if (status === 429 || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('quota')) {
        return `${provider} rate limited (429).${retry}`;
      }
      if (status === 503) {
        return `${provider} temporarily unavailable (503).${retry}`;
      }
      // Truncate long messages
      const short = msg.length > 120 ? msg.substring(0, 120) + '...' : msg;
      return `${provider} error ${status}: ${short}`;
    }
  } catch { /* not JSON */ }
  // Fallback: truncate raw text
  const truncated = raw.length > 100 ? raw.substring(0, 100) + '...' : raw;
  return `${provider} error ${status}: ${truncated}`;
}
