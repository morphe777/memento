// H-13: what the OpenAPI document says beyond the inputs: the error body, the two ways to authenticate, and for
// each operation who may call it (x-token-access: read, write or none = the interface only) and its errors.
import { tokenAccess } from './access.ts';

export const PUBLIC_ROUTES = new Set(['/api/v1/auth/login', '/api/v1/health', '/api/v1/openapi.json']);

const ERRORS: Record<string, string> = {
  '400': 'VALIDATION_ERROR : requête mal formée (details liste les champs).',
  '401': 'UNAUTHENTICATED : connexion ou jeton requis.',
  '403': 'USER_ONLY (interface seule) ou READ_ONLY_TOKEN (jeton lecture).',
  '404': 'NOT_FOUND : élément inconnu.',
  '409': 'Conflit : PLAN_APPLY_CONFLICT, ALREADY_EXISTS.',
  '422': 'Règle métier refusée : code propre, message en français à montrer tel quel.',
  '429': 'Trop de requêtes.',
  '500': 'INTERNAL : erreur inattendue.',
};

const errorSchema = {
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: { type: 'string', description: 'Code stable, à tester par le client.' },
    message: { type: 'string', description: 'Message en français.' },
    details: { description: 'Précisions (champs invalides, conflits…).' },
  },
};

type Operation = { security?: unknown; responses?: Record<string, unknown>; [k: string]: unknown };
type Doc = {
  components?: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
  paths?: Record<string, Record<string, Operation>>;
};

export function withContract<T>(input: T): T {
  const doc = input as Doc;
  doc.components = {
    ...doc.components,
    schemas: { ...doc.components?.schemas, Error: errorSchema },
    securitySchemes: {
      ...doc.components?.securitySchemes,
      cookie: { type: 'apiKey', in: 'cookie', name: 'memento_session' },
    },
  };
  for (const [path, ops] of Object.entries(doc.paths ?? {})) {
    const route = path.replace(/\{([^}]+)\}/g, ':$1');
    for (const [method, op] of Object.entries(ops)) {
      const isPublic = PUBLIC_ROUTES.has(route);
      const access: string = isPublic ? 'public' : (tokenAccess(method.toUpperCase(), route) ?? 'none');
      op['x-token-access'] = access;
      op.security = isPublic ? [] : access === 'none' ? [{ cookie: [] }] : [{ bearer: [] }, { cookie: [] }];
      const errors = Object.entries(ERRORS).filter(([code]) => !isPublic || !['401', '403'].includes(code));
      op.responses = {
        ...op.responses,
        ...Object.fromEntries(
          errors.map(([code, description]) => [
            code,
            {
              description,
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          ]),
        ),
      };
    }
  }
  return input;
}
