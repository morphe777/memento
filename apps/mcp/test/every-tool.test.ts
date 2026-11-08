// Audit v1.0 Lot 2, H-14 (rest): every MCP tool, called with typical arguments, reaches routes that exist and that
// its token may call (a reading tool only `read` routes, any tool only routes open to tokens).
import { openDb, runMigrations } from '@memento/db';
import { describe, expect, it } from 'vitest';
import { tokenAccess } from '../../api/src/access.ts';
import { buildApp } from '../../api/src/app.ts';
import { buildServer, isReadTool } from '../src/index.ts';

process.env.MEMENTO_MCP_NO_LISTEN = '1';
const ID = '00000000-0000-4000-8000-000000000000';
const SAMPLES: Record<string, unknown> = {
  isoWeek: '2026-W45',
  month: '2026-11',
  quarter: '2026-Q4',
  periodKey: '2026-W45',
  kind: 'week',
  from: '2026-11-10',
  to: '2026-11-12',
  date: '2026-11-10',
  dueDate: '2026-11-20',
  deadline: '2026-12-31',
  durationMin: 15,
  projectId: ID,
  title: 'Essai',
  text: 'appeler le garage demain',
  q: 'garage',
  since: '7d',
  url: 'https://example.org',
  label: 'Lien',
  ownerType: 'project',
  scope: 'week',
  period: '2026-W45',
};

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
};
function sample(key: string, s: JsonSchema): unknown {
  if (key in SAMPLES) return SAMPLES[key];
  if (s.enum) return s.enum[0];
  if (s.anyOf) return sample(key, s.anyOf[0]);
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  if (type === 'array') return [sample(key.replace(/s$/, ''), s.items ?? {})];
  if (type === 'object') return args(s);
  if (type === 'number' || type === 'integer') return 1;
  if (type === 'boolean') return false;
  return /id$/i.test(key) ? ID : 'x';
}
// Required parameters, plus the optional ones with a known sample (e.g. kind + periodKey of get_report).
const args = (s: JsonSchema) =>
  Object.fromEntries(
    Object.keys(s.properties ?? {})
      .filter((k) => s.required?.includes(k) || (k in SAMPLES && k !== 'projectId'))
      .map((k) => [k, sample(k, s.properties?.[k] ?? {})]),
  );

describe('H-14 every MCP tool reaches an open route', async () => {
  const { db, sqlite } = openDb(':memory:');
  runMigrations(db);
  const app = await buildApp({ db, sqlite, cookieSecure: false, webDist: '/nonexistent' });
  await app.ready();
  const routes = app.apiRoutes.map((r) => {
    const [method, path] = r.split(' ');
    return { method, path, re: new RegExp(`^${path.replace(/:[^/]+/g, '[^/]+')}$`) };
  });
  const calls: { method: string; path: string }[] = [];
  const fake = async (method: string, path: string) => {
    calls.push({ method, path });
    return { id: ID, currentWeek: '2026-W45', today: '2026-11-10', items: [], canWrite: true };
  };
  const server = buildServer(fake) as unknown as {
    _registeredTools: Record<
      string,
      { inputSchema?: unknown; handler: (a: unknown, extra: unknown) => Promise<unknown> }
    >;
  };
  const { z } = await import('zod');
  const tools = Object.entries(server._registeredTools);

  it.each(tools.map(([name]) => name))('%s', async (name) => {
    const tool = server._registeredTools[name];
    const schema = tool.inputSchema
      ? (z.toJSONSchema(tool.inputSchema as never, { io: 'input' }) as JsonSchema)
      : {};
    calls.length = 0;
    const out = (await tool.handler(args(schema), {})) as { isError?: boolean; content: { text: string }[] };
    expect(out.isError, out.content?.[0]?.text).toBeFalsy();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      const path = `/api/v1${c.path.split('?')[0]}`;
      const route = routes.find((r) => r.method === c.method && r.re.test(path));
      expect(route, `${c.method} ${path}`).toBeDefined();
      const access = tokenAccess(c.method, route!.path);
      expect(access, `${c.method} ${route!.path} open to tokens`).toBeDefined();
      if (isReadTool(name)) expect(access, `${name}: ${c.method} ${route!.path}`).toBe('read');
    }
  });
});
