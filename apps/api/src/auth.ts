// Authentication: web users by session cookie (actor 'me'), AI / robots by bearer secret token (actor 'ai:<name>').
// Passwords hashed with argon2id; session ids and tokens stored as SHA-256 hashes only (dossier de dev §12).
import { createHash, randomBytes } from 'node:crypto';
import { type Db, eq, schema } from '@memento/db';
import { type Actor, DomainError, newId } from '@memento/domain';
import { hash, verify } from '@node-rs/argon2';

export const SESSION_COOKIE = 'memento_session';
export const SESSION_DAYS = 30;
export const TOKEN_PREFIX = 'mem_';

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const secret = () => randomBytes(32).toString('base64url');

/** argon2id is the library default (Algorithm.Argon2id). */
export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (hashed: string, password: string) =>
  verify(hashed, password).catch(() => false);

export function assertPasswordPolicy(password: string) {
  if (password.length < 12)
    throw new DomainError('PASSWORD_TOO_SHORT', 'Mot de passe : 12 caractères minimum.');
}

export async function setUserPassword(db: Db, login: string, password: string) {
  assertPasswordPolicy(password);
  const passwordHash = await hashPassword(password);
  const existing = db.select().from(schema.appUser).where(eq(schema.appUser.login, login)).get();
  if (existing) {
    db.update(schema.appUser)
      .set({ passwordHash, updatedAt: new Date().toISOString() })
      .where(eq(schema.appUser.id, existing.id))
      .run();
    // Changing a password revokes every open session of that user.
    db.delete(schema.session).where(eq(schema.session.userId, existing.id)).run();
    return { created: false };
  }
  db.insert(schema.appUser).values({ id: newId(), login, passwordHash }).run();
  return { created: true };
}

// Constant-time-ish failure path: always run a verify even for unknown logins.
const DUMMY_HASH = hashPassword('memento-dummy-password-for-timing');

export async function login(db: Db, loginName: string, password: string) {
  const user = db.select().from(schema.appUser).where(eq(schema.appUser.login, loginName)).get();
  const ok = await verifyPassword(user?.passwordHash ?? (await DUMMY_HASH), password);
  if (!user || !ok) return null;
  const raw = secret();
  const now = new Date();
  db.insert(schema.session)
    .values({
      id: sha256(raw),
      userId: user.id,
      expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString(),
      previousSeenAt: user.lastSeenAt,
    })
    .run();
  db.update(schema.appUser)
    .set({ lastSeenAt: now.toISOString() })
    .where(eq(schema.appUser.id, user.id))
    .run();
  return { raw, user: { id: user.id, login: user.login } };
}

export function logout(db: Db, raw: string) {
  db.delete(schema.session)
    .where(eq(schema.session.id, sha256(raw)))
    .run();
}

export interface Principal {
  kind: 'user' | 'token';
  actor: Actor;
  userId?: string;
  login?: string;
  previousSeenAt?: string | null;
  canWrite: boolean;
}

export function sessionPrincipal(db: Db, raw: string | undefined): Principal | null {
  if (!raw) return null;
  const row = db
    .select({ s: schema.session, u: schema.appUser })
    .from(schema.session)
    .innerJoin(schema.appUser, eq(schema.appUser.id, schema.session.userId))
    .where(eq(schema.session.id, sha256(raw)))
    .get();
  if (!row) return null;
  if (row.s.expiresAt < new Date().toISOString()) {
    db.delete(schema.session).where(eq(schema.session.id, row.s.id)).run();
    return null;
  }
  return {
    kind: 'user',
    actor: 'me',
    userId: row.u.id,
    login: row.u.login,
    previousSeenAt: row.s.previousSeenAt,
    canWrite: true,
  };
}

export function tokenPrincipal(db: Db, raw: string | undefined): Principal | null {
  if (!raw?.startsWith(TOKEN_PREFIX)) return null;
  const t = db
    .select()
    .from(schema.apiToken)
    .where(eq(schema.apiToken.tokenHash, sha256(raw)))
    .get();
  if (!t || t.revokedAt) return null;
  db.update(schema.apiToken)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(schema.apiToken.id, t.id))
    .run();
  return { kind: 'token', actor: `ai:${t.name}`, canWrite: t.scopes === 'read_write' };
}

// ---------- API tokens (Configuration › Accès) ----------

export function createToken(db: Db, name: string, scopes: 'read' | 'read_write', createdBy = 'me') {
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/i.test(name)) {
    throw new DomainError(
      'INVALID_TOKEN_NAME',
      'Nom de jeton : lettres, chiffres, - ou _ (2 à 40 caractères).',
    );
  }
  if (db.select().from(schema.apiToken).where(eq(schema.apiToken.name, name)).get()) {
    throw new DomainError('TOKEN_NAME_TAKEN', 'Un jeton porte déjà ce nom.');
  }
  const raw = `${TOKEN_PREFIX}${secret()}`;
  const id = newId();
  db.insert(schema.apiToken)
    .values({ id, name, scopes, tokenHash: sha256(raw), createdBy })
    .run();
  return { id, name, scopes, token: raw }; // shown once, never stored in clear
}

export const listTokens = (db: Db) =>
  db
    .select({
      id: schema.apiToken.id,
      name: schema.apiToken.name,
      scopes: schema.apiToken.scopes,
      createdAt: schema.apiToken.createdAt,
      lastUsedAt: schema.apiToken.lastUsedAt,
      revokedAt: schema.apiToken.revokedAt,
    })
    .from(schema.apiToken)
    .all();

export function revokeToken(db: Db, id: string) {
  db.update(schema.apiToken)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(schema.apiToken.id, id))
    .run();
}
