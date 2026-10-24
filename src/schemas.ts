import { z } from "zod";
import { COLOR_TOKENS } from "./domain/timetable.js";

const name = z.string().regex(/^[a-zA-ZÀ-ÿ\s]{2,40}$/, "Nome inválido");
const email = z.string().regex(/\S+@\S+\.\S+/, "E-mail inválido");
const password = z.string().min(8, "A senha precisa ter no mínimo 8 caracteres");

export const signupSchema = z.object({
  name,
  email,
  password,
  avatar: z.string().max(1_500_000, "A foto passa de 1 MB").optional(),
});

export const loginSchema = z.object({ email, password });

export const codeSchema = z.object({
  email,
  code: z.string().regex(/^\d{8}$/, "O código tem 8 dígitos"),
});

export const resetSchema = codeSchema.extend({ password });

export const refreshSchema = z.object({ refreshToken: z.string().min(20) });

export const profileSchema = z.object({
  name: name.optional(),
  avatar: z.string().max(1_500_000, "A foto passa de 1 MB").optional(),
  password: password.optional(),
});

export const createCurriculumSchema = z.object({ courseCode: z.string().min(1) });

export const filterSchema = z.object({
  obligatory: z.boolean(),
  optional: z.boolean(),
  todo: z.boolean(),
  doing: z.boolean(),
  done: z.boolean(),
});

export const periodNameSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome ao período").max(40),
});

export const visibilitySchema = z.object({ visible: z.boolean() });

export const orderSchema = z.object({ ids: z.array(z.number().int()) });

export const subjectCreateSchema = z.object({
  periodId: z.number().int(),
  subjectCode: z.string().regex(/^[a-zA-Z]{2}[0-9]{3}$/, "O código tem duas letras e três números"),
  isOptional: z.boolean(),
});

export const subjectPatchSchema = z.object({
  status: z.enum(["todo", "doing", "done"]).optional(),
  note: z.string().max(5000).nullable().optional(),
  grade: z.number().min(0).max(10).nullable().optional(),
  links: z.array(z.object({ name: z.string().min(1).max(80), url: z.string().url() })).max(20).optional(),
  teacherId: z.number().int().nullable().optional(),
});

export const moveSubjectSchema = z.object({ periodId: z.number().int() });

export const bulkStatusSchema = z.object({ status: z.enum(["todo", "doing", "done"]) });

export const complementarySchema = z.object({
  name: z.string().trim().min(1).max(80),
  time: z.number().int().positive(),
});

export const timetableSchema = z.object({
  timetable: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.union([
    z.literal(""),
    z.object({ id: z.string(), bgColor: z.enum(COLOR_TOKENS) }),
  ])))),
});

export const eventSchema = z.object({
  title: z.string().trim().min(1).max(120),
  start: z.string().datetime(),
  end: z.string().datetime(),
  description: z.string().max(2000).optional(),
});

export const ratingSchema = z.object({
  complexity: z.number().min(0).max(10),
  relevance: z.number().min(0).max(10),
  comment: z.string().max(1000).optional(),
});
