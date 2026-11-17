// D-156: every AI call writes one log line (which feature, how long, how many tokens, retries), never its content.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AiCallLog, DEFAULT_SETTINGS, makeLlm, type Settings } from '../src/index.ts';

const settings = {
  ...DEFAULT_SETTINGS,
  'ai.provider': 'openrouter',
  'ai.model': 'vendor/model',
} as Settings;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('D-156 AI call timing', () => {
  it('logs the feature, duration, calls, tokens (reasoning included) and the provider that answered', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply(400, { error: { message: 'response_format not supported' } }))
      .mockResolvedValueOnce(
        reply(200, {
          model: 'vendor/model',
          provider: 'SomeHost',
          choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 4100,
            completion_tokens: 2300,
            completion_tokens_details: { reasoning_tokens: 2100 },
          },
        }),
      );
    vi.stubGlobal('fetch', fetch);
    const lines: AiCallLog[] = [];
    const llm = makeLlm(settings, {}, 'sk-test', (l) => lines.push(l));
    const out = await llm({ task: 'fill-week', system: 'S', user: 'secret de l’utilisateur', schema: {} });
    expect(out.text).toBe('{"ok":true}');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      msg: 'ai call',
      task: 'fill-week',
      provider: 'openrouter',
      model: 'vendor/model',
      servedBy: 'SomeHost',
      ok: true,
      calls: 2,
      promptTokens: 4100,
      completionTokens: 2300,
      reasoningTokens: 2100,
      promptChars: 'S'.length + 'secret de l’utilisateur'.length,
    });
    expect(lines[0].ms).toEqual(expect.any(Number));
    expect(JSON.stringify(lines[0])).not.toContain('secret');
  });

  it('logs a failed call too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(429, { error: { message: 'slow down' } })));
    const lines: AiCallLog[] = [];
    const llm = makeLlm(settings, {}, 'sk-test', (l) => lines.push(l));
    await expect(llm({ task: 'propose-week', system: 'S', user: 'U', schema: {} })).rejects.toThrow(/débit/);
    expect(lines).toEqual([expect.objectContaining({ task: 'propose-week', ok: false, calls: 1 })]);
  });
});
