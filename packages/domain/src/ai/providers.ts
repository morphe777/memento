// D-58 / D-66: « Proposer avec l'IA » — the AI provider is chosen in Configuration › IA (provider, URL, API key,
// model). The key is typed in the interface and stored in the database (one per provider, `secret.` rows of
// the setting table): never returned by the API, never exported, kept by an import. An environment variable
// of the container still works as a fallback. Anthropic goes through its SDK; every other provider speaks the
// OpenAI-compatible « chat completions » protocol (OpenAI, OpenRouter, Google Gemini, Ollama, any compatible server).
import Anthropic from '@anthropic-ai/sdk';
import { eq, schema } from '@memento/db';
import { audit, type Ctx, tx } from '../context.ts';
import { DomainError } from '../errors.ts';
import type { Settings } from '../settings.ts';
import { DEFAULT_AI_PROMPTS } from './prompts.ts';

export type AiProvider = Settings['ai.provider'];
type RealProvider = Exclude<AiProvider, 'none'>;

/** A single completion that must answer with one JSON object matching `schema`. */
export type Llm = (req: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
}) => Promise<{ text: string; model: string }>;

interface Preset {
  label: string;
  baseUrl: string;
  keyEnv: string | null; // fallback environment variable; null: no key needed (Ollama)
  keyRequired: boolean; // a local OpenAI-compatible server may need no key
  defaultModel: string | null;
}

// URLs checked against each provider's documentation on 27/10/2026.
export const AI_PROVIDERS: Record<RealProvider, Preset> = {
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

// ---------- Stored keys (D-66) ----------

/** Setting rows whose key starts with this prefix are secrets: not in getSettings, the export nor the import. */
export const SECRET_SETTING_PREFIX = 'secret.';
const keyRow = (p: RealProvider) => `${SECRET_SETTING_PREFIX}ai.key.${p}`;

export function getAiKey(ctx: Pick<Ctx, 'db'>, provider: AiProvider): string {
  if (provider === 'none') return '';
  const row = ctx.db
    .select()
    .from(schema.setting)
    .where(eq(schema.setting.key, keyRow(provider)))
    .get();
  return typeof row?.value === 'string' ? row.value : '';
}

/** Saves (or clears with an empty key) the API key of a provider. The journal records the change, not the key. */
export function setAiKey(ctx: Ctx, provider: AiProvider, key: string) {
  if (provider === 'none') throw new DomainError('INVALID_SETTINGS', 'Choisis d’abord un fournisseur.');
  const value = key.trim();
  if (/\s/.test(value)) throw new DomainError('INVALID_SETTINGS', 'La clé ne doit pas contenir d’espace.');
  tx(ctx, () => {
    const k = keyRow(provider);
    if (!value) ctx.db.delete(schema.setting).where(eq(schema.setting.key, k)).run();
    else
      ctx.db
        .insert(schema.setting)
        .values({ key: k, value })
        .onConflictDoUpdate({
          target: schema.setting.key,
          set: { value, updatedAt: new Date().toISOString() },
        })
        .run();
    audit(ctx, 'setting', 'settings', 'update', null, {
      [`ai.key.${provider}`]: value ? 'saisie' : 'effacée',
    });
  });
  return { ok: true as const };
}

const maskKey = (k: string) => (k.length > 8 ? `…${k.slice(-4)}` : '…');

// ---------- Resolution ----------

interface Conn {
  provider: RealProvider;
  preset: Preset;
  baseUrl: string;
  model: string;
  key: string;
}

function resolve(s: Settings, env: Env, storedKey: string) {
  const provider = s['ai.provider'];
  if (provider === 'none') return null;
  const preset = AI_PROVIDERS[provider];
  const baseUrl = (s['ai.base_url'] || preset.baseUrl).replace(/\/+$/, '');
  const model = s['ai.model'] || preset.defaultModel || '';
  // The key typed in Configuration › IA wins; then the provider's variable, then MEMENTO_AI_API_KEY.
  const envKey = (preset.keyEnv ? env[preset.keyEnv] : undefined) || env.MEMENTO_AI_API_KEY || '';
  const key = storedKey || envKey;
  const keySource = storedKey ? ('saisie' as const) : envKey ? ('env' as const) : null;
  return { provider, preset, baseUrl, model, key, keySource };
}

/** What Configuration › IA and the button show: is the AI usable, and if not, why. Never the key itself. */
export function aiStatus(s: Settings, env: Env, storedKey = '') {
  const r = resolve(s, env, storedKey);
  const missing = !r
    ? 'Aucun fournisseur choisi.'
    : !r.baseUrl
      ? 'URL du serveur non renseignée.'
      : r.preset.keyRequired && !r.key
        ? 'Clé d’API non renseignée.'
        : !r.model
          ? 'Modèle non choisi.'
          : null;
  return {
    configured: !missing,
    provider: s['ai.provider'],
    providerLabel: r?.preset.label ?? null,
    model: r?.model || null,
    baseUrl: r?.baseUrl || null,
    /** Where the key comes from: typed in the interface, an environment variable, or nowhere. */
    keySource: r?.keySource ?? null,
    keyHint: r?.key ? maskKey(r.key) : null,
    keyEnv: r?.preset.keyEnv ?? null,
    keyRequired: r?.preset.keyRequired ?? false,
    reason: missing,
    /** Default URL of each provider, shown and pre-filled in Configuration › IA. */
    defaultUrls: Object.fromEntries(Object.entries(AI_PROVIDERS).map(([k, p]) => [k, p.baseUrl])) as Record<
      RealProvider,
      string
    >,
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

export function makeLlm(s: Settings, env: Env, storedKey = ''): Llm {
  const r = resolve(s, env, storedKey);
  const status = aiStatus(s, env, storedKey);
  if (!r || !status.configured)
    throw new DomainError(
      'AI_NOT_CONFIGURED',
      `IA non configurée (Configuration › IA). ${status.reason ?? ''}`.trim(),
    );
  return r.provider === 'anthropic' ? anthropicLlm(r) : openAiCompatibleLlm(r);
}

function anthropicLlm(r: Conn): Llm {
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
      anthropicError(e);
    }
  };
}

function anthropicError(e: unknown): never {
  if (e instanceof DomainError) throw e;
  if (e instanceof Anthropic.AuthenticationError) providerError('clé Anthropic refusée.');
  if (e instanceof Anthropic.NotFoundError) providerError('modèle inconnu chez Anthropic.');
  if (e instanceof Anthropic.RateLimitError) providerError('limite de débit atteinte, réessaie plus tard.');
  if (e instanceof Anthropic.APIError) providerError(`Anthropic ${e.status ?? ''} ${e.message}`.trim());
  providerError(e instanceof Error ? e.message : String(e));
}

function headers(r: Pick<Conn, 'provider' | 'key'>) {
  return {
    'content-type': 'application/json',
    ...(r.key ? { authorization: `Bearer ${r.key}` } : {}),
    // OpenRouter app attribution (optional; X-Title is the older name, still accepted). ASCII only.
    ...(r.provider === 'openrouter' ? { 'X-OpenRouter-Title': 'Memento', 'X-Title': 'Memento' } : {}),
  };
}

type OpenAiJson = {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string; error?: { message?: string } }[];
  error?: { message?: string } | string;
  data?: unknown;
} | null;

async function getJson(url: string, init: RequestInit, timeout = TIMEOUT_MS) {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    providerError(`serveur injoignable (${new URL(url).origin}) : ${e instanceof Error ? e.message : e}`);
  }
  const json = (await res.json().catch(() => null)) as OpenAiJson;
  return { status: res.status, json };
}

/** Readable message for an HTTP error of an OpenAI-compatible server (OpenRouter codes: docs « Errors »). */
function httpError(r: Pick<Conn, 'preset'>, status: number, json: OpenAiJson): never {
  const label = r.preset.label;
  if (status === 401) providerError(`clé refusée par ${label}.`);
  if (status === 402) providerError(`crédits insuffisants sur le compte ${label}.`);
  if (status === 403) providerError(`accès refusé par ${label} (droits, modération ou garde-fou).`);
  if (status === 404) providerError(`modèle ou adresse inconnus chez ${label}.`);
  if (status === 429) providerError('limite de débit atteinte, réessaie plus tard.');
  if (status === 502 || status === 503)
    providerError(
      `le modèle est indisponible chez ${label} pour le moment, réessaie ou choisis-en un autre.`,
    );
  const err = json?.error;
  providerError(`${label} ${status} ${typeof err === 'string' ? err : (err?.message ?? '')}`.trim());
}

function openAiCompatibleLlm(r: Conn): Llm {
  const call = (body: Record<string, unknown>) =>
    getJson(`${r.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers(r),
      body: JSON.stringify(body),
    });
  return async ({ system, user, schema }) => {
    const base = {
      model: r.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    // Structured outputs, strict mode: the schema already has every field required and no extra property.
    const { $schema: _, ...jsonSchema } = schema;
    let out = await call({
      ...base,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'proposal', strict: true, schema: jsonSchema },
      },
    });
    // Not every model/server supports structured outputs: retry once in plain mode (the prompt asks for JSON).
    if (out.status === 400 || out.status === 422) out = await call(base);
    const choice = out.json?.choices?.[0];
    if (out.status >= 300 || !choice) httpError(r, out.status, out.json);
    if (choice.error?.message) providerError(`${r.preset.label} : ${choice.error.message}`);
    if (choice.finish_reason === 'length') providerError('réponse tronquée (trop longue).');
    return { text: choice.message?.content ?? '', model: out.json?.model ?? r.model };
  };
}

// ---------- Connection test and model list (Configuration › IA) ----------

export interface AiModel {
  id: string;
  label: string;
  hint?: string;
}

/** Values of the form, not yet saved: the key falls back to the stored one, then to the environment. */
export interface AiCheckInput {
  provider: AiProvider;
  baseUrl?: string;
  key?: string;
}

const perMillion = (perToken: string | undefined) => {
  const n = Number(perToken);
  return Number.isFinite(n) ? `${(n * 1e6).toFixed(2).replace(/\.00$/, '')} $` : '?';
};

/**
 * Checks the URL and key by listing the provider's models (GET /models), plus, for OpenRouter, the key's
 * credit (GET /key). OpenRouter models that cannot return structured JSON are listed last.
 */
export async function checkAi(input: AiCheckInput, env: Env, storedKey = '') {
  const s = { 'ai.provider': input.provider, 'ai.base_url': input.baseUrl ?? '', 'ai.model': '' } as Settings;
  const r = resolve(s, env, input.key?.trim() || storedKey);
  if (!r) throw new DomainError('AI_NOT_CONFIGURED', 'Choisis d’abord un fournisseur.');
  if (!r.baseUrl) throw new DomainError('AI_NOT_CONFIGURED', 'URL du serveur non renseignée.');
  if (r.preset.keyRequired && !r.key) throw new DomainError('AI_NOT_CONFIGURED', 'Clé d’API non renseignée.');
  const models = r.provider === 'anthropic' ? await anthropicModels(r) : await openAiModels(r);
  let info: string | null = null;
  if (r.provider === 'openrouter') {
    // GET /models is public on OpenRouter: only GET /key proves that the key is valid.
    const k = await getJson(`${r.baseUrl}/key`, { headers: headers(r) }, 20_000);
    if (k.status >= 300) httpError(r, k.status, k.json);
    const d = (k.json?.data ?? {}) as {
      limit_remaining?: number | null;
      usage?: number;
      is_free_tier?: boolean;
    };
    info =
      d.limit_remaining == null
        ? `Clé valide${d.is_free_tier ? ' (compte gratuit)' : ''}, sans plafond de dépense.`
        : `Clé valide, reste ${d.limit_remaining.toFixed(2)} $ sur son plafond.`;
  }
  return { ok: true as const, info, models };
}

async function anthropicModels(r: Conn): Promise<AiModel[]> {
  const client = new Anthropic({ apiKey: r.key, baseURL: r.baseUrl, timeout: 20_000, maxRetries: 1 });
  try {
    const out: AiModel[] = [];
    for await (const m of client.models.list()) out.push({ id: m.id, label: m.display_name, hint: m.id });
    return out;
  } catch (e) {
    anthropicError(e);
  }
}

async function openAiModels(r: Conn): Promise<AiModel[]> {
  const res = await getJson(`${r.baseUrl}/models`, { headers: headers(r) }, 20_000);
  if (res.status >= 300) httpError(r, res.status, res.json);
  const data = Array.isArray(res.json?.data) ? (res.json.data as Record<string, unknown>[]) : [];
  const models = data
    .filter((m) => typeof m.id === 'string')
    .map((m) => {
      const id = (m.id as string).replace(/^models\//, ''); // Gemini may prefix ids with « models/ »
      const params = Array.isArray(m.supported_parameters) ? (m.supported_parameters as string[]) : null;
      const pricing = m.pricing as { prompt?: string; completion?: string } | undefined;
      const structured = params ? params.includes('response_format') : true;
      const hint = [
        id,
        pricing ? `${perMillion(pricing.prompt)} / ${perMillion(pricing.completion)} par M jetons` : null,
        structured ? null : 'sans sortie JSON structurée',
      ]
        .filter(Boolean)
        .join(' · ');
      return { id, label: typeof m.name === 'string' ? m.name : id, hint, structured };
    });
  models.sort((a, b) => Number(b.structured) - Number(a.structured) || a.label.localeCompare(b.label));
  return models.map(({ structured: _, ...m }) => m);
}
