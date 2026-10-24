import type { Context } from "hono";
import type { ZodType } from "zod";

export async function readJson<T>(c: Context, schema: ZodType<T>) {
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false as const, error: issue?.message ?? "Dados inválidos" };
  }
  return { ok: true as const, data: parsed.data };
}

export function isUniqueError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
