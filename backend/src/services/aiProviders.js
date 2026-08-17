const axios = require('axios');

const PROVIDERS = {
  google: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash'] },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o3-mini'] },
  anthropic: { label: 'Anthropic', baseUrl: 'https://api.anthropic.com', models: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest'] },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai', models: ['google/gemini-2.5-flash', 'anthropic/claude-3.5-haiku', 'openai/gpt-4o-mini'] },
};

/**
 * Send a chat prompt to the provider. Returns { text, latencyMs }.
 * Throws categorized errors: INVALID_KEY | QUOTA_EXCEEDED | RATE_LIMITED | MODEL_UNAVAILABLE | TIMEOUT | NETWORK | SERVER.
 */
async function chat({ provider, apiKey, model, system, user }) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw categorize(new Error(`Unsupported provider: ${provider}`), provider, null, 'SERVER');
  const started = Date.now();

  try {
    let text;
    if (provider === 'google') {
      const res = await axios.post(`${cfg.baseUrl}/v1beta/models/${model}:generateContent`, {
        contents: [
          { role: 'user', parts: [{ text: `${system}\n\n${user}` }] },
        ],
        generationConfig: { temperature: 0.4 },
      }, {
        params: { key: apiKey },
        timeout: 90_000,
      });
      text = res.data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    } else if (provider === 'anthropic') {
      const res = await axios.post(`${cfg.baseUrl}/v1/messages`, {
        model,
        max_tokens: 4096,
        system,
        messages: [{ role: 'user', content: user }],
      }, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        timeout: 90_000,
      });
      text = res.data?.content?.map((c) => c.text || '').join('') || '';
    } else {
      // openai + openrouter share the /chat/completions shape
      const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
      if (provider === 'openrouter') headers['HTTP-Referer'] = 'https://varuntej.app';
      const res = await axios.post(`${cfg.baseUrl}/v1/chat/completions`, {
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
  const msg = String(err?.response?.data?.error?.message || err?.message || '');
  const status = err?.response?.status;

  if (err.code === 'ECONNABORTED' || /timeout/i.test(msg)) return new CategorizedError('TIMEOUT', 'The provider did not respond in time.');
  if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ERR_NETWORK') {
    return new CategorizedError('NETWORK', 'Unable to reach the AI provider. Check internet / endpoint.');
  }
  if (status === 401 || status === 403) return new CategorizedError('INVALID_KEY', 'API key is invalid or rejected by the provider.');
  if (status === 429) {
    return new CategorizedError(/quota/i.test(msg) ? 'QUOTA_EXCEEDED' : 'RATE_LIMITED',
      /quota/i.test(msg) ? 'Provider quota exceeded.' : 'Provider rate limit reached.');
  }
  if (status === 404 && model) return new CategorizedError('MODEL_UNAVAILABLE', 'Selected model is not available for this key.');
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

module.exports = { PROVIDERS, chat, extractJson, safeCategory, CategorizedError };
