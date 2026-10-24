import { hash } from "bcryptjs";
import { Hono } from "hono";
import {
  checkPassword,
  hashPassword,
  hashToken,
  numericCode,
  publicUser,
  requireUser,
  rotateRefresh,
  saveRefresh,
  signAccess,
  type AppEnv,
} from "../auth.js";
import { prisma } from "../db.js";
import { isUniqueError, readJson } from "../http.js";
import { sendCode } from "../mail.js";
import { codeSchema, loginSchema, profileSchema, refreshSchema, resetSchema, signupSchema } from "../schemas.js";

export const account = new Hono<AppEnv>();

async function storeEmailCode(email: string, code: string) {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await prisma.emailVerification.deleteMany({ where: { email } });
  await prisma.emailVerification.create({
    data: { email, tokenHash: await hash(code, 9), expiresAt },
  });
}

account.post("/auth/signup", async (c) => {
  const body = await readJson(c, signupSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  try {
    const user = await prisma.user.create({
      data: {
        name: body.data.name.trim(),
        email: body.data.email.trim().toLowerCase(),
        password: await hashPassword(body.data.password),
        avatar: body.data.avatar ?? "",
      },
    });
    const code = numericCode();
    await storeEmailCode(user.email, code);
    await sendCode(user.email, "Confirme sua conta", "Use este código para confirmar o Facilita Rural:", code);
    return c.json({ message: "Enviamos um código de 8 dígitos para o seu e-mail." }, 201);
  } catch (error) {
    if (isUniqueError(error)) return c.json({ error: "Esse e-mail já está cadastrado" }, 409);
    throw error;
  }
});

account.post("/auth/verify-email", async (c) => {
  const body = await readJson(c, codeSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const email = body.data.email.trim().toLowerCase();
  const saved = await prisma.emailVerification.findFirst({
    where: { email },
    orderBy: { createdAt: "desc" },
  });
  if (!saved || saved.expiresAt.getTime() < Date.now()) {
    return c.json({ error: "Código expirado" }, 403);
  }
  const matches = await checkPassword(body.data.code, saved.tokenHash);
  if (!matches) return c.json({ error: "Código inválido" }, 404);
  await prisma.user.update({ where: { email }, data: { emailVerified: true } });
  await prisma.emailVerification.deleteMany({ where: { email } });
  return c.json({ message: "E-mail confirmado" });
});

account.post("/auth/resend-verification", async (c) => {
  const body = await readJson(c, loginSchema.pick({ email: true }));
  if (!body.ok) return c.json({ error: body.error }, 400);
  const email = body.data.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return c.json({ error: "Esse e-mail não está cadastrado" }, 404);
  if (user.emailVerified) return c.json({ message: "Esta conta já está confirmada" });
  const code = numericCode();
  await storeEmailCode(email, code);
  await sendCode(email, "Confirme sua conta", "Use este código para confirmar o Facilita Rural:", code);
  return c.json({ message: "Enviamos um novo código." });
});

account.post("/auth/login", async (c) => {
  const body = await readJson(c, loginSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const user = await prisma.user.findUnique({ where: { email: body.data.email.trim().toLowerCase() } });
  if (!user) return c.json({ error: "Esse e-mail não está cadastrado", type: "email" }, 401);
  const passwordOk = await checkPassword(body.data.password, user.password);
  if (!passwordOk) return c.json({ error: "Senha incorreta", type: "password" }, 401);
  if (!user.emailVerified) return c.json({ error: "E-mail não confirmado", type: "emailVerified" }, 401);
  return c.json({
    accessToken: await signAccess(user),
    refreshToken: await saveRefresh(user.id),
    user: publicUser(user),
  });
});

account.post("/auth/refresh", async (c) => {
  const body = await readJson(c, refreshSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const session = await rotateRefresh(body.data.refreshToken);
  if (!session) return c.json({ error: "Sessão expirada" }, 401);
  return c.json(session);
});

account.post("/auth/logout", requireUser, async (c) => {
  const body = await readJson(c, refreshSchema);
  if (body.ok) {
    await prisma.refreshToken.deleteMany({
      where: { userId: c.get("userId"), tokenHash: hashToken(body.data.refreshToken) },
    });
  }
  return c.json({ message: "Sessão encerrada" });
});

account.post("/auth/forgot-password", async (c) => {
  const body = await readJson(c, loginSchema.pick({ email: true }));
  if (!body.ok) return c.json({ error: body.error }, 400);
  const email = body.data.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return c.json({ error: "Esse e-mail não está cadastrado" }, 404);
  const code = numericCode();
  await prisma.recoverPassword.deleteMany({ where: { userEmail: email } });
  await prisma.recoverPassword.create({
    data: { userEmail: email, token: await hash(code, 9) },
  });
  await sendCode(email, "Recuperação de senha", "Use este código para criar uma senha nova:", code);
  return c.json({ message: "Enviamos um código de 8 dígitos." });
});

account.post("/auth/reset-password", async (c) => {
  const body = await readJson(c, resetSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const email = body.data.email.trim().toLowerCase();
  const saved = await prisma.recoverPassword.findFirst({ where: { userEmail: email } });
  if (!saved) return c.json({ error: "Esse código não existe" }, 404);
  const ageHours = (Date.now() - saved.createdAt.getTime()) / 1000 / 60 / 60;
  if (ageHours >= 1) return c.json({ error: "Código expirado" }, 403);
  const matches = await checkPassword(body.data.code, saved.token);
  if (!matches) return c.json({ error: "Código inválido" }, 404);
  await prisma.user.update({ where: { email }, data: { password: await hashPassword(body.data.password) } });
  await prisma.recoverPassword.deleteMany({ where: { userEmail: email } });
  return c.json({ message: "Senha atualizada" });
});

account.get("/me", requireUser, async (c) => {
  const user = await prisma.user.findUnique({ where: { id: c.get("userId") } });
  if (!user) return c.json({ error: "Não autorizado" }, 401);
  return c.json(publicUser(user));
});

account.patch("/me", requireUser, async (c) => {
  const body = await readJson(c, profileSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const data: { name?: string; avatar?: string; password?: string } = {};
  if (body.data.name) data.name = body.data.name.trim();
  if (body.data.avatar !== undefined) data.avatar = body.data.avatar;
  if (body.data.password) data.password = await hashPassword(body.data.password);
  const user = await prisma.user.update({ where: { id: c.get("userId") }, data });
  return c.json(publicUser(user));
});

account.delete("/me/curriculum", requireUser, async (c) => {
  const userId = c.get("userId");
  const curriculum = await prisma.curriculum.findUnique({ where: { userId } });
  if (!curriculum) return c.json({ error: "Você não tem grade" }, 404);
  await prisma.$transaction([
    prisma.userSubjects.deleteMany({ where: { userId } }),
    prisma.curriculumPeriods.deleteMany({ where: { curriculumId: curriculum.id } }),
    prisma.curriculum.delete({ where: { userId } }),
    prisma.user.update({ where: { id: userId }, data: { hasCurriculum: false, timetable: null } }),
  ]);
  return c.json({ message: "Grade excluída" });
});
