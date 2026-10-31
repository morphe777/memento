/** Business rule violation → HTTP 422 with a readable code (dossier de dev §5). */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/** State changed under the caller (API-08 PLAN_APPLY_CONFLICT) → HTTP 409; details carry the fresh state. */
export class ConflictError extends DomainError {}

export class NotFoundError extends Error {
  constructor(
    public readonly entity: string,
    public readonly id: string,
  ) {
    super(`${entity} ${id} not found`);
    this.name = 'NotFoundError';
  }
}

export function assertFound<T>(value: T | undefined | null, entity: string, id: string): T {
  if (value === undefined || value === null) throw new NotFoundError(entity, id);
  return value;
}
