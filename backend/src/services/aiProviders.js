const axios = require('axios');

// provider flags:
//   openaiCompat  -> POST {base}/v1/chat/completions with Bearer auth
//   gemini        -> POST {base}/v1beta/models/{model}:generateContent?key=
//   anthropic     -> POST {base}/v1/messages with x-api-key
//   cohere        -> POST {base}/v1/chat with Bearer auth
//   noKey         -> API key optional (local models)
//   customEndpoint-> base URL must be supplied by the user
const PROVIDERS = {
  google: {
    label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com', gemini: true,
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'],
  },
  openai: {
    label: 'OpenAI', baseUrl: 'https://api.openai.com', openaiCompat: true,
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o3', 'o3-mini', 'o1', 'o1-mini'],
  },
  anthropic: {
    label: 'Anthropic', baseUrl: 'https://api.anthropic.com', anthropic: true,
    models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest', 'claude-3-haiku'],
  },
  openrouter: {
    label: 'OpenRouter', baseUrl: 'https://openrouter.ai', openaiCompat: true,
    models: ['google/gemini-2.5-flash', 'google/gemini-2.0-flash-001', 'anthropic/claude-3.5-sonnet', 'anthropic/claude-3.5-haiku', 'openai/gpt-4o-mini', 'openai/gpt-4o', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat'],
  },
  mistral: {
    label: 'Mistral AI', baseUrl: 'https://api.mistral.ai', openaiCompat: true,
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest', 'open-mistral-7b'],
  },
  groq: {
    label: 'Groq', baseUrl: 'https://api.groq.com/openai', openaiCompat: true,
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama3-70b-8192', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
  },
  deepseek: {
    label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', openaiCompat: true,
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  xai: {
    label: 'xAI (Grok)', baseUrl: 'https://api.x.ai', openaiCompat: true,
    models: ['grok-2-latest', 'grok-2-1212', 'grok-beta'],
  },
  cohere: {
    label: 'Cohere', baseUrl: 'https://api.cohere.com', cohere: true,
    models: ['command-r-plus', 'command-r', 'command-r7b-12-2024'],
  },
  together: {
    label: 'Together AI', baseUrl: 'https://api.together.xyz', openaiCompat: true,
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'meta-llama/Llama-3.1-8B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
  },
  perplexity: {
    label: 'Perplexity', baseUrl: 'https://api.perplexity.ai', openaiCompat: true,
    models: ['sonar-pro', 'sonar', 'llama-3.1-sonar-large-128k-online', 'llama-3.1-sonar-small-128k-online'],
  },
  ollama: {
    label: 'Ollama (Local)', baseUrl: 'http://localhost:11434', openaiCompat: true, noKey: true,
    models: ['llama3.1', 'llama3.2', 'llama3.2:1b', 'mistral', 'phi3', 'gemma2', 'qwen2.5', 'qwen2.5:7b', 'qwen3:4b', 'qwen3:8b', 'codellama', 'deepseek-r1:8b'],
  },
  lmstudio: {
    label: 'LM Studio (Local)', baseUrl: 'http://localhost:1234', openaiCompat: true, noKey: true, models: [],
  },
  custom: {
    label: 'Custom (OpenAI-compatible)', baseUrl: '', openaiCompat: true, customEndpoint: true, models: [],
  },
};

/**
 * Send a chat prompt to the provider. Returns { text, latencyMs }.
 * `endpoint` overrides the provider's default base URL (used for local/custom endpoints).
 * Throws categorized errors: INVALID_KEY | QUOTA_EXCEEDED | RATE_LIMITED | MODEL_UNAVAILABLE | TIMEOUT | NETWORK | SERVER.
 */
async function chat({ provider, apiKey, model, system, user, endpoint }) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw categorize(new Error(`Unsupported provider: ${provider}`), provider, null, 'SERVER');
  const base = String(endpoint || '').trim() || cfg.baseUrl;
  if (!base) throw new CategorizedError('NETWORK', 'A base endpoint is required for this provider.');
  const started = Date.now();

  try {
    let text;
    if (cfg.gemini) {
      const res = await axios.post(`${base}/v1beta/models/${model}:generateContent`, {
        contents: [{ role: 'user', parts: [{ text: `${system}\n\n${user}` }] }],
        generationConfig: { temperature: 0.4 },
      }, {
        params: { key: apiKey },
        timeout: 90_000,
      });
      text = res.data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    } else if (cfg.anthropic) {
      const res = await axios.post(`${base}/v1/messages`, {
        model,
        max_tokens: 4096,
        system,
        messages: [{ role: 'user', content: user }],
      }, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        timeout: 90_000,
      });
      text = res.data?.content?.map((c) => c.text || '').join('') || '';
    } else if (cfg.cohere) {
      const res = await axios.post(`${base}/v1/chat`, {
        model,
        message: `${system}\n\n${user}`,
        temperature: 0.4,
        max_tokens: 4096,
      }, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 90_000,
      });
      text = res.data?.text || '';
    } else {
      // OpenAI-compatible shape (openai, openrouter, mistral, groq, deepseek, xai,
      // together, perplexity, ollama, lmstudio, custom). Local providers need no key.
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      if (provider === 'openrouter') headers['HTTP-Referer'] = 'https://varuntej.app';
      const res = await axios.post(`${base}/v1/chat/completions`, {
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.4,
      }, { headers, timeout: 90_000 });
      text = res.data?.choices?.[0]?.message?.content || '';
    }

    return { text, latencyMs: Date.now() - started };
  } catch (e) {
    throw categorize(e, provider, model);
  }
}

function categorize(err, provider, model, fallback = 'SERVER') {
  const msg = String(err?.response?.data?.error?.message || err?.response?.data?.message || err?.message || '');
  const status = err?.response?.status;

  if (err.code === 'ECONNABORTED' || /timeout/i.test(msg)) return new CategorizedError('TIMEOUT', 'The provider did not respond in time.');
  if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ERR_NETWORK') {
    return new CategorizedError('NETWORK', 'Unable to reach the AI provider. Check internet / endpoint.');
  }
  // Some providers (e.g. Gemini) reject bad keys with HTTP 400 and a message.
  if (/api key not valid|invalid api key|api key.*invalid|invalid key|apikey.*invalid|unauthorized|authentication failed/i.test(msg)) {
    return new CategorizedError('INVALID_KEY', 'API key is invalid or rejected by the provider.');
  }
  if (status === 401 || status === 403) return new CategorizedError('INVALID_KEY', 'API key is invalid or rejected by the provider.');
  if (status === 429) {
    return new CategorizedError(/quota/i.test(msg) ? 'QUOTA_EXCEEDED' : 'RATE_LIMITED',
      /quota/i.test(msg) ? 'Provider quota exceeded.' : 'Provider rate limit reached.');
  }
  if (status === 404 && model) return new CategorizedError('MODEL_UNAVAILABLE', 'Selected model is not available for this key.');
  if (status === 404) return new CategorizedError('MODEL_UNAVAILABLE', 'Endpoint or model not found. Check the URL / model name.');
  if (status >= 500) return new CategorizedError('SERVER', 'The AI provider returned a temporary server error.');
  return new CategorizedError(fallback, msg.slice(0, 300) || 'Unknown provider error.');
}

class CategorizedError extends Error {
  constructor(category, message) {
    super(message);
    this.category = category;
  }
}

/** Sanitized categories only — never raw provider bodies. */
const safeCategory = (e) => e.category || 'SERVER';

/** Extract JSON (possibly inside markdown fences) from an LLM response. */
function extractJson(text) {
  let t = String(text || '');
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) t = fenced[1];
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in model response');
  return JSON.parse(t.slice(start, end + 1));
}

module.exports = { PROVIDERS, chat, categorize, extractJson, safeCategory, CategorizedError };
