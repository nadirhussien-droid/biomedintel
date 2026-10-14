import type { z } from "zod";
import { ValidationError } from "./authz/errors";

/** Parses untrusted input or throws a ValidationError with per-field messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw new ValidationError("Please correct the highlighted fields.", fieldErrors);
  }
  return result.data;
}

/** True when a database error is a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    code?: string;
    cause?: { code?: string };
    meta?: { driverAdapterError?: { cause?: { originalCode?: string } } };
  };
  return (
    e.code === "P2002" ||
    e.code === "23505" ||
    e.cause?.code === "23505" ||
    e.meta?.driverAdapterError?.cause?.originalCode === "23505"
  );
}
