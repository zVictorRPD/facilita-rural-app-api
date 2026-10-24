import { createHash, randomBytes, randomInt } from "node:crypto";
import { compare, hash } from "bcryptjs";
import type { MiddlewareHandler } from "hono";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./db.js";

const ROUNDS = 9;
const ACCESS_TTL = "15m";
const REFRESH_DAYS = 30;

export type AppEnv = { Variables: { userId: number } };

function accessSecret() {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET ausente");
  return new TextEncoder().encode(secret);
}

export function numericCode() {
  return randomInt(10_000_000, 100_000_000).toString();
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string) {
  return hash(password, ROUNDS);
}

export async function checkPassword(password: string, passwordHash: string) {
  return compare(password, passwordHash);
}

export async function signAccess(user: { id: number; email: string; name: string }) {
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(accessSecret());
}

export async function saveRefresh(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });
  return token;
}

export async function rotateRefresh(token: string) {
  const saved = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!saved || saved.expiresAt.getTime() < Date.now()) return null;
  await prisma.refreshToken.delete({ where: { id: saved.id } });
  const accessToken = await signAccess(saved.user);
  const refreshToken = await saveRefresh(saved.userId);
  return {
    accessToken,
    refreshToken,
    user: publicUser(saved.user),
  };
}

export function publicUser(user: { id: number; name: string; email: string; avatar: string; emailVerified: boolean }) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    emailVerified: user.emailVerified,
  };
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) return c.json({ error: "Não autorizado" }, 401);
  try {
    const { payload } = await jwtVerify(header.slice(7), accessSecret());
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId)) return c.json({ error: "Não autorizado" }, 401);
    c.set("userId", userId);
    await next();
  } catch {
    return c.json({ error: "Sessão expirada" }, 401);
  }
};
