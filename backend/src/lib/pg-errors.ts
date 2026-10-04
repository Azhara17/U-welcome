// Код ошибки Postgres и имя нарушенного ограничения; drizzle заворачивает ошибку pg в cause.
export function pgError(err: unknown): { code?: string; constraint?: string } {
  let e: unknown = err;
  while (e && typeof e === 'object') {
    const { code, constraint, cause } = e as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return { code, constraint: typeof constraint === 'string' ? constraint : undefined };
    }
    e = cause;
  }
  return {};
}

export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = pgError(err);
  return e.code === '23505' && e.constraint === constraint;
}
