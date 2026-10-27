import { Prisma } from '@prisma/client';

// The `Model:column,column` key of a P2002 unique violation, or undefined for any other error.
// Prisma 6 reports the model and db column names, not the constraint name (D-04).
export function uniqueViolation(e: unknown): string | undefined {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return undefined;
  const { modelName, target } = (e.meta ?? {}) as { modelName?: string; target?: unknown };
  return `${modelName}:${Array.isArray(target) ? target.join(',') : target}`;
}
