// D-58: « Proposer avec l'IA » — the AI provider is chosen in Configuration › IA (provider, model, URL).
// API keys are never stored in the database nor exported: they come from environment variables of the
// API container. Anthropic goes through its SDK; every other provider speaks the OpenAI-compatible
// « chat completions » protocol (OpenAI, OpenRouter, Google Gemini, Ollama, any compatible server).
import Anthropic from '@anthropic-ai/sdk';
import { DomainError } from '../errors.ts';
import type { Settings } from '../settings.ts';
import { DEFAULT_AI_PROMPTS } from './prompts.ts';

export type AiProvider = Settings['ai.provider'];

/** A single completion that must answer with one JSON object matching `schema`. */
export type Llm = (req: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
}) => Promise<{ text: string; model: string }>;

interface Preset {
  label: string;
  baseUrl: string;
  keyEnv: string | null; // null: no key needed (Ollama)
  keyRequired: boolean; // a local OpenAI-compatible server may need no key
  defaultModel: string | null;
}

export const AI_PROVIDERS: Record<Exclude<AiProvider, 'none'>, Preset> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com',
    keyEnv: 'ANTHROPIC_API_KEY',
    keyRequired: true,
    defaultModel: 'claude-opus-5-5',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    keyRequired: true,
    defaultModel: null,
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    keyRequired: true,
    defaultModel: null,
  },
  google: {
    label: 'Google (Gemini)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    keyRequired: true,
    defaultModel: null,
  },
  ollama: {
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    keyEnv: null,
    keyRequired: false,
    defaultModel: null,
  },
  custom: {
    label: 'Autre (compatible OpenAI)',
    baseUrl: '',
    keyEnv: 'MEMENTO_AI_API_KEY',
    keyRequired: false,
    defaultModel: null,
  },
};

type Env = Record<string, string | undefined>;

function resolve(s: Settings, env: Env) {
  const provider = s['ai.provider'];
  if (provider === 'none') return null;
  const preset = AI_PROVIDERS[provider];
  const baseUrl = (s['ai.base_url'] || preset.baseUrl).replace(/\/+$/, '');
  const model = s['ai.model'] || preset.defaultModel || '';
  // MEMENTO_AI_API_KEY is also a fallback for every provider (one key, whatever the provider).
  const key = (preset.keyEnv ? env[preset.keyEnv] : undefined) || env.MEMENTO_AI_API_KEY || '';
  return { provider, preset, baseUrl, model, key };
}

/** What Configuration › IA and the button show: is the AI usable, and if not, why. */
export function aiStatus(s: Settings, env: Env) {
  const r = resolve(s, env);
  const missing = !r
    ? 'Aucun fournisseur choisi.'
    : !r.model
      ? 'Modèle non renseigné.'
      : !r.baseUrl
        ? 'URL du serveur non renseignée.'
        : r.preset.keyRequired && !r.key
          ? `Clé absente : variable d'environnement ${r.preset.keyEnv} (ou MEMENTO_AI_API_KEY) à définir dans le conteneur.`
          : null;
  return {
    configured: !missing,
    provider: s['ai.provider'],
    providerLabel: r?.preset.label ?? null,
    model: r?.model || null,
    keyEnv: r?.preset.keyEnv ?? null,
    keyPresent: !!r?.key,
    reason: missing,
    /** For « Rétablir le texte d'origine » in Configuration › IA. */
    defaultPrompts: DEFAULT_AI_PROMPTS,
  };
}
export type AiStatusView = ReturnType<typeof aiStatus>;

const TIMEOUT_MS = 180_000;
// Server-side refusal fallback (Anthropic): only these models accept `fallbacks: "default"`.
const FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);

function providerError(message: string): never {
  throw new DomainError('AI_PROVIDER_ERROR', `L'IA n'a pas pu répondre : ${message}`);
}

export function makeLlm(s: Settings, env: Env): Llm {
  const r = resolve(s, env);
  const status = aiStatus(s, env);
  if (!r || !status.configured)
    throw new DomainError(
      'AI_NOT_CONFIGURED',
      `IA non configurée (Configuration › IA). ${status.reason ?? ''}`.trim(),
    );
  return r.provider === 'anthropic' ? anthropicLlm(r) : openAiCompatibleLlm(r);
}

function anthropicLlm(r: NonNullable<ReturnType<typeof resolve>>): Llm {
  const client = new Anthropic({ apiKey: r.key, baseURL: r.baseUrl, timeout: TIMEOUT_MS, maxRetries: 1 });
  const fallback = FALLBACK_MODELS.has(r.model);
  return async ({ system, user, schema }) => {
    try {
      const res = await client.beta.messages.create({
        model: r.model,
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });
      if (res.stop_reason === 'refusal') providerError('le modèle a refusé la demande.');
      if (res.stop_reason === 'max_tokens') providerError('réponse tronquée (trop longue).');
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return { text, model: res.model };
    } catch (e) {
      if (e instanceof DomainError) throw e;
      if (e instanceof Anthropic.AuthenticationError) providerError('clé Anthropic refusée.');
      if (e instanceof Anthropic.RateLimitError)
        providerError('limite de débit atteinte, réessaie plus tard.');
      if (e instanceof Anthropic.APIError) providerError(`Anthropic ${e.status ?? ''} ${e.message}`.trim());
      providerError(e instanceof Error ? e.message : String(e));
    }
  };
}

function openAiCompatibleLlm(r: NonNullable<ReturnType<typeof resolve>>): Llm {
  const call = async (body: Record<string, unknown>) => {
    let res: Response;
    try {
      res = await fetch(`${r.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(r.key ? { authorization: `Bearer ${r.key}` } : {}),
          ...(r.provider === 'openrouter' ? { 'X-Title': 'Memento' } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      providerError(`serveur injoignable (${r.baseUrl}) : ${e instanceof Error ? e.message : e}`);
    }
    const json = (await res.json().catch(() => null)) as {
      model?: string;
      choices?: { message?: { content?: string | null }; finish_reason?: string }[];
      error?: { message?: string } | string;
    } | null;
    return { status: res.status, json };
  };
  return async ({ system, user, schema }) => {
    const base = {
      model: r.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    let out = await call({
      ...base,
      response_format: { type: 'json_schema', json_schema: { name: 'proposal', schema } },
    });
    // Not every model/server supports structured outputs: retry once in plain mode (the prompt asks for JSON).
    if (out.status === 400 || out.status === 422) out = await call(base);
    if (out.status === 401 || out.status === 403) providerError(`clé refusée par ${r.preset.label}.`);
    if (out.status === 429) providerError('limite de débit atteinte, réessaie plus tard.');
    const choice = out.json?.choices?.[0];
    if (out.status >= 300 || !choice) {
      const err = out.json?.error;
      providerError(
        `${r.preset.label} ${out.status} ${typeof err === 'string' ? err : (err?.message ?? '')}`.trim(),
      );
    }
    if (choice.finish_reason === 'length') providerError('réponse tronquée (trop longue).');
    return { text: choice.message?.content ?? '', model: out.json?.model ?? r.model };
  };
}
