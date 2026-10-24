import { Hono } from "hono";
import type { AppEnv } from "../auth.js";
import { requireUser } from "../auth.js";
import { prisma } from "../db.js";
import { defaultFilter } from "../domain/progress.js";
import { DAY_KEYS, SLOT_KEYS, TURN_KEYS, parseTimetable } from "../domain/timetable.js";
import { readJson } from "../http.js";
import {
  bulkStatusSchema,
  complementarySchema,
  createCurriculumSchema,
  eventSchema,
  filterSchema,
  moveSubjectSchema,
  orderSchema,
  periodNameSchema,
  ratingSchema,
  subjectCreateSchema,
  subjectPatchSchema,
  timetableSchema,
  visibilitySchema,
} from "../schemas.js";

export const academic = new Hono<AppEnv>();
academic.use("*", requireUser);

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function shapeTeacher(teacher: {
  id: number;
  avatar: string;
  name: string;
  email: string;
  lattes: string;
  departament_code: string;
  departament_name: string;
} | null) {
  if (!teacher) return null;
  return teacher;
}

function shapeSubject(subject: {
  id: number;
  subjectCode: string;
  status: string;
  isOptional: boolean;
  note: string | null;
  links: string | null;
  grade: number | null;
  periodId: number;
  teacher: {
    id: number;
    avatar: string;
    name: string;
    email: string;
    lattes: string;
    departament_code: string;
    departament_name: string;
  } | null;
  subject: { code: string; name: string; time: number };
  period?: { name: string };
}) {
  return {
    id: String(subject.id),
    code: subject.subject.code,
    name: subject.subject.name,
    time: subject.subject.time,
    isOptional: subject.isOptional,
    status: subject.status,
    note: subject.note,
    links: parseJson<{ name: string; url: string }[]>(subject.links, []),
    grade: subject.grade,
    periodId: String(subject.periodId),
    periodName: subject.period?.name ?? "",
    teacher: shapeTeacher(subject.teacher),
  };
}

async function loadCurriculum(userId: number) {
  return prisma.curriculum.findUnique({
    where: { userId },
    include: {
      course: true,
      curriculumPeriods: {
        include: {
          subjects: { include: { subject: true, teacher: true, period: true } },
        },
      },
    },
  });
}

function presentCurriculum(curriculum: NonNullable<Awaited<ReturnType<typeof loadCurriculum>>>) {
  const order = parseJson<number[]>(curriculum.curriculumPeriodsOrder, []);
  const periods = [...curriculum.curriculumPeriods].sort((a, b) => {
    const left = order.indexOf(a.id);
    const right = order.indexOf(b.id);
    return (left === -1 ? 999 : left) - (right === -1 ? 999 : right);
  });
  const subjects: Record<string, ReturnType<typeof shapeSubject>> = {};
  const periodPayload = periods.map((period) => {
    const subjectOrder = parseJson<number[]>(period.subjectsOrder, []);
    for (const subject of period.subjects) subjects[String(subject.id)] = shapeSubject(subject);
    const known = new Set(period.subjects.map((subject) => subject.id));
    const subjectIds = subjectOrder.map(String).filter((id) => known.has(Number(id)));
    for (const subject of period.subjects) {
      if (!subjectIds.includes(String(subject.id))) subjectIds.push(String(subject.id));
    }
    return {
      id: String(period.id),
      name: period.name,
      visible: period.visible,
      subjectIds,
    };
  });
  return {
    hasCurriculum: true as const,
    course: curriculum.course,
    periods: periodPayload,
    subjects,
    filter: parseJson(curriculum.subjectsFilter, defaultFilter),
  };
}

async function ownedPeriod(userId: number, periodId: number) {
  return prisma.curriculumPeriods.findFirst({
    where: { id: periodId, curriculum: { userId } },
  });
}

academic.get("/curriculum", async (c) => {
  const userId = c.get("userId");
  const curriculum = await loadCurriculum(userId);
  const complementary = await prisma.userComplementary.findMany({ where: { userId }, orderBy: { id: "asc" } });
  if (!curriculum) {
    const courses = await prisma.course.findMany({
      select: { code: true, name: true, period_emergence: true },
      orderBy: { name: "asc" },
    });
    return c.json({ hasCurriculum: false, courses, complementary });
  }
  return c.json({ ...presentCurriculum(curriculum), complementary });
});

academic.post("/curriculum", async (c) => {
  const body = await readJson(c, createCurriculumSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const userId = c.get("userId");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.hasCurriculum) return c.json({ error: "Você já tem uma grade" }, 409);
  const course = await prisma.course.findUnique({ where: { code: body.data.courseCode } });
  if (!course) return c.json({ error: "Curso não encontrado" }, 404);

  await prisma.$transaction(async (tx) => {
    const defaultPeriods = await tx.period.findMany({
      where: { courseCode: course.code },
      include: { subjects: { select: { subjectCode: true } } },
      orderBy: { id: "asc" },
    });
    const curriculum = await tx.curriculum.create({
      data: { userId, courseCode: course.code },
    });
    const createdPeriods = [];
    for (const period of defaultPeriods) {
      createdPeriods.push({
        source: period,
        row: await tx.curriculumPeriods.create({
          data: { curriculumId: curriculum.id, name: period.name },
        }),
      });
    }
    await tx.curriculum.update({
      where: { id: curriculum.id },
      data: { curriculumPeriodsOrder: JSON.stringify(createdPeriods.map((period) => period.row.id)) },
    });
    for (const period of createdPeriods) {
      if (period.source.subjects.length === 0) {
        await tx.curriculumPeriods.update({
          where: { id: period.row.id },
          data: { subjectsOrder: "[]" },
        });
        continue;
      }
      await tx.userSubjects.createMany({
        data: period.source.subjects.map((subject) => ({
          subjectCode: subject.subjectCode,
          isOptional: period.source.name === "Optativas",
          periodId: period.row.id,
          userId,
        })),
      });
      const created = await tx.userSubjects.findMany({
        where: { periodId: period.row.id },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      await tx.curriculumPeriods.update({
        where: { id: period.row.id },
        data: { subjectsOrder: JSON.stringify(created.map((subject) => subject.id)) },
      });
    }
    await tx.user.update({ where: { id: userId }, data: { hasCurriculum: true } });
  });
  return c.json({ message: "Grade criada" }, 201);
});

academic.patch("/curriculum/filter", async (c) => {
  const body = await readJson(c, filterSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  await prisma.curriculum.update({
    where: { userId: c.get("userId") },
    data: { subjectsFilter: JSON.stringify(body.data) },
  });
  return c.json(body.data);
});

academic.post("/curriculum/periods", async (c) => {
  const body = await readJson(c, periodNameSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const curriculum = await prisma.curriculum.findUnique({ where: { userId: c.get("userId") } });
  if (!curriculum) return c.json({ error: "Você não tem grade" }, 404);
  const period = await prisma.curriculumPeriods.create({
    data: { curriculumId: curriculum.id, name: body.data.name, subjectsOrder: "[]" },
  });
  const order = parseJson<number[]>(curriculum.curriculumPeriodsOrder, []);
  await prisma.curriculum.update({
    where: { id: curriculum.id },
    data: { curriculumPeriodsOrder: JSON.stringify([...order, period.id]) },
  });
  return c.json({ id: String(period.id), name: period.name, visible: true, subjectIds: [] }, 201);
});

academic.patch("/curriculum/periods/:id", async (c) => {
  const body = await readJson(c, periodNameSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const period = await ownedPeriod(c.get("userId"), Number(c.req.param("id")));
  if (!period) return c.json({ error: "Período não encontrado" }, 404);
  await prisma.curriculumPeriods.update({ where: { id: period.id }, data: { name: body.data.name } });
  return c.json({ id: String(period.id), name: body.data.name });
});

academic.patch("/curriculum/periods/:id/visibility", async (c) => {
  const body = await readJson(c, visibilitySchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const period = await ownedPeriod(c.get("userId"), Number(c.req.param("id")));
  if (!period) return c.json({ error: "Período não encontrado" }, 404);
  await prisma.curriculumPeriods.update({ where: { id: period.id }, data: { visible: body.data.visible } });
  return c.json({ visible: body.data.visible });
});

academic.delete("/curriculum/periods/:id", async (c) => {
  const userId = c.get("userId");
  const period = await ownedPeriod(userId, Number(c.req.param("id")));
  if (!period) return c.json({ error: "Período não encontrado" }, 404);
  const curriculum = await prisma.curriculum.findUnique({ where: { userId } });
  await prisma.$transaction([
    prisma.userSubjects.deleteMany({ where: { userId, periodId: period.id } }),
    prisma.curriculumPeriods.delete({ where: { id: period.id } }),
    prisma.curriculum.update({
      where: { userId },
      data: {
        curriculumPeriodsOrder: JSON.stringify(
          parseJson<number[]>(curriculum?.curriculumPeriodsOrder, []).filter((id) => id !== period.id),
        ),
      },
    }),
  ]);
  return c.json({ message: "Período excluído" });
});

academic.put("/curriculum/periods/order", async (c) => {
  const body = await readJson(c, orderSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const curriculum = await prisma.curriculum.findUnique({
    where: { userId: c.get("userId") },
    include: { curriculumPeriods: { select: { id: true } } },
  });
  if (!curriculum) return c.json({ error: "Você não tem grade" }, 404);
  const known = new Set(curriculum.curriculumPeriods.map((period) => period.id));
  if (body.data.ids.length !== known.size || body.data.ids.some((id) => !known.has(id))) {
    return c.json({ error: "A ordem dos períodos está incompleta" }, 400);
  }
  await prisma.curriculum.update({
    where: { id: curriculum.id },
    data: { curriculumPeriodsOrder: JSON.stringify(body.data.ids) },
  });
  return c.json({ ids: body.data.ids.map(String) });
});

academic.put("/curriculum/periods/:id/subjects/order", async (c) => {
  const body = await readJson(c, orderSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const period = await ownedPeriod(c.get("userId"), Number(c.req.param("id")));
  if (!period) return c.json({ error: "Período não encontrado" }, 404);
  const subjects = await prisma.userSubjects.findMany({
    where: { periodId: period.id, userId: c.get("userId") },
    select: { id: true },
  });
  const known = new Set(subjects.map((subject) => subject.id));
  if (body.data.ids.length !== known.size || body.data.ids.some((id) => !known.has(id))) {
    return c.json({ error: "A ordem das matérias está incompleta" }, 400);
  }
  await prisma.curriculumPeriods.update({
    where: { id: period.id },
    data: { subjectsOrder: JSON.stringify(body.data.ids) },
  });
  return c.json({ ids: body.data.ids.map(String) });
});

academic.post("/curriculum/subjects", async (c) => {
  const body = await readJson(c, subjectCreateSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const userId = c.get("userId");
  const period = await ownedPeriod(userId, body.data.periodId);
  if (!period) return c.json({ error: "Período não encontrado" }, 404);
  const catalog = await prisma.subject.findUnique({ where: { code: body.data.subjectCode.toUpperCase() } });
  if (!catalog) return c.json({ error: "Essa matéria não existe" }, 404);
  const created = await prisma.userSubjects.create({
    data: {
      userId,
      periodId: period.id,
      subjectCode: catalog.code,
      isOptional: body.data.isOptional,
    },
    include: { subject: true, teacher: true, period: true },
  });
  const order = parseJson<number[]>(period.subjectsOrder, []);
  await prisma.curriculumPeriods.update({
    where: { id: period.id },
    data: { subjectsOrder: JSON.stringify([...order, created.id]) },
  });
  return c.json(shapeSubject(created), 201);
});

academic.patch("/curriculum/subjects/:id", async (c) => {
  const body = await readJson(c, subjectPatchSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const userId = c.get("userId");
  const current = await prisma.userSubjects.findFirst({
    where: { id: Number(c.req.param("id")), userId },
  });
  if (!current) return c.json({ error: "Matéria não encontrada" }, 404);
  if (body.data.teacherId) {
    const teacher = await prisma.teacher.findUnique({ where: { id: body.data.teacherId } });
    if (!teacher) return c.json({ error: "Professor não encontrado" }, 404);
  }
  const updated = await prisma.userSubjects.update({
    where: { id: current.id },
    data: {
      status: body.data.status,
      note: body.data.note,
      grade: body.data.grade,
      teacherId: body.data.teacherId,
      links: body.data.links ? JSON.stringify(body.data.links) : undefined,
    },
    include: { subject: true, teacher: true, period: true },
  });
  return c.json(shapeSubject(updated));
});

academic.patch("/curriculum/subjects/:id/period", async (c) => {
  const body = await readJson(c, moveSubjectSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const userId = c.get("userId");
  const subject = await prisma.userSubjects.findFirst({
    where: { id: Number(c.req.param("id")), userId },
  });
  const destination = await ownedPeriod(userId, body.data.periodId);
  if (!subject || !destination) return c.json({ error: "Não foi possível mover a matéria" }, 404);
  const origin = await ownedPeriod(userId, subject.periodId);
  if (!origin) return c.json({ error: "Período não encontrado" }, 404);
  await prisma.$transaction([
    prisma.userSubjects.update({ where: { id: subject.id }, data: { periodId: destination.id } }),
    prisma.curriculumPeriods.update({
      where: { id: origin.id },
      data: {
        subjectsOrder: JSON.stringify(parseJson<number[]>(origin.subjectsOrder, []).filter((id) => id !== subject.id)),
      },
    }),
    prisma.curriculumPeriods.update({
      where: { id: destination.id },
      data: { subjectsOrder: JSON.stringify([...parseJson<number[]>(destination.subjectsOrder, []), subject.id]) },
    }),
  ]);
  return c.json({ periodId: String(destination.id) });
});

academic.delete("/curriculum/subjects/:id", async (c) => {
  const userId = c.get("userId");
  const subject = await prisma.userSubjects.findFirst({
    where: { id: Number(c.req.param("id")), userId },
  });
  if (!subject) return c.json({ error: "Matéria não encontrada" }, 404);
  const period = await ownedPeriod(userId, subject.periodId);
  await prisma.$transaction([
    prisma.userSubjects.delete({ where: { id: subject.id } }),
    prisma.curriculumPeriods.update({
      where: { id: subject.periodId },
      data: {
        subjectsOrder: JSON.stringify(parseJson<number[]>(period?.subjectsOrder, []).filter((id) => id !== subject.id)),
      },
    }),
  ]);
  return c.json({ message: "Matéria removida" });
});

academic.patch("/curriculum/periods/:id/status", async (c) => {
  const body = await readJson(c, bulkStatusSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const period = await ownedPeriod(c.get("userId"), Number(c.req.param("id")));
  if (!period) return c.json({ error: "Período não encontrado" }, 404);
  await prisma.userSubjects.updateMany({
    where: { periodId: period.id, userId: c.get("userId") },
    data: { status: body.data.status },
  });
  return c.json({ status: body.data.status });
});

academic.post("/curriculum/complementary", async (c) => {
  const body = await readJson(c, complementarySchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const created = await prisma.userComplementary.create({
    data: { userId: c.get("userId"), name: body.data.name, time: body.data.time },
  });
  return c.json(created, 201);
});

academic.delete("/curriculum/complementary/:id", async (c) => {
  await prisma.userComplementary.deleteMany({
    where: { id: Number(c.req.param("id")), userId: c.get("userId") },
  });
  return c.json({ message: "Atividade removida" });
});

academic.get("/timetable", async (c) => {
  const user = await prisma.user.findUnique({ where: { id: c.get("userId") }, select: { timetable: true } });
  return c.json({ timetable: user?.timetable ? parseTimetable(JSON.parse(user.timetable)) : null });
});

academic.put("/timetable", async (c) => {
  const body = await readJson(c, timetableSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const timetable = parseTimetable(body.data.timetable);
  if (!timetable) return c.json({ error: "Grade horária inválida" }, 400);
  const ids = new Set<string>();
  for (const day of DAY_KEYS) {
    for (const turn of TURN_KEYS) {
      for (const slot of SLOT_KEYS) {
        const cell = timetable[day][turn][slot];
        if (cell !== "") ids.add(cell.id);
      }
    }
  }
  if (ids.size > 0) {
    const owned = await prisma.userSubjects.findMany({
      where: { userId: c.get("userId"), id: { in: [...ids].map(Number) } },
      select: { id: true },
    });
    if (owned.length !== ids.size) return c.json({ error: "Há uma matéria que não está na sua grade" }, 400);
  }
  await prisma.user.update({
    where: { id: c.get("userId") },
    data: { timetable: JSON.stringify(timetable) },
  });
  return c.json({ timetable });
});

academic.get("/events", async (c) => {
  const events = await prisma.calendarEvents.findMany({
    where: { userId: c.get("userId") },
    orderBy: { start: "asc" },
  });
  return c.json(events);
});

academic.post("/events", async (c) => {
  const body = await readJson(c, eventSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const event = await prisma.calendarEvents.create({
    data: {
      userId: c.get("userId"),
      title: body.data.title,
      start: new Date(body.data.start),
      end: new Date(body.data.end),
      description: body.data.description ?? "",
    },
  });
  return c.json(event, 201);
});

academic.patch("/events/:id", async (c) => {
  const body = await readJson(c, eventSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const current = await prisma.calendarEvents.findFirst({
    where: { id: Number(c.req.param("id")), userId: c.get("userId") },
  });
  if (!current) return c.json({ error: "Evento não encontrado" }, 404);
  const event = await prisma.calendarEvents.update({
    where: { id: current.id },
    data: {
      title: body.data.title,
      start: new Date(body.data.start),
      end: new Date(body.data.end),
      description: body.data.description ?? "",
    },
  });
  return c.json(event);
});

academic.delete("/events/:id", async (c) => {
  await prisma.calendarEvents.deleteMany({
    where: { id: Number(c.req.param("id")), userId: c.get("userId") },
  });
  return c.json({ message: "Evento excluído" });
});

academic.get("/dashboard", async (c) => {
  const userId = c.get("userId");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.hasCurriculum) return c.json({ hasCurriculum: false });
  const curriculum = await loadCurriculum(userId);
  if (!curriculum) return c.json({ hasCurriculum: false });
  const shaped = presentCurriculum(curriculum);
  const complementary = await prisma.userComplementary.findMany({ where: { userId } });
  const events = await prisma.calendarEvents.findMany({
    where: { userId, start: { gte: new Date() } },
    orderBy: { start: "asc" },
    take: 6,
  });
  return c.json({
    hasCurriculum: true,
    course: shaped.course,
    subjects: Object.values(shaped.subjects),
    complementary,
    timetable: user.timetable ? parseTimetable(JSON.parse(user.timetable)) : null,
    events,
  });
});

academic.get("/subjects", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const code = c.req.query("code") ?? "";
  const name = c.req.query("name") ?? "";
  const time = Number(c.req.query("time") ?? 0);
  const where = {
    ...(code ? { code: { contains: code } } : {}),
    ...(name ? { name: { contains: name } } : {}),
    ...(time > 0 ? { time } : {}),
  };
  const take = 20;
  const [subjects, total] = await Promise.all([
    prisma.subject.findMany({ where, orderBy: { name: "asc" }, skip: take * (page - 1), take }),
    prisma.subject.count({ where }),
  ]);
  return c.json({ subjects, total, page, totalPages: Math.ceil(total / take) });
});

academic.get("/subjects/:code/ratings", async (c) => {
  const subjectCode = c.req.param("code");
  const userId = c.get("userId");
  const ratings = await prisma.rating.findMany({
    where: { subjectCode },
    include: { user: { select: { name: true, avatar: true } } },
    orderBy: { createdAt: "desc" },
  });
  const mine = ratings.find((rating) => rating.userId === userId) ?? null;
  const average = ratings.length
    ? {
        complexity: ratings.reduce((sum, rating) => sum + rating.complexity, 0) / ratings.length,
        relevance: ratings.reduce((sum, rating) => sum + rating.relevance, 0) / ratings.length,
      }
    : { complexity: 0, relevance: 0 };
  return c.json({
    average,
    mine: mine ? { complexity: mine.complexity, relevance: mine.relevance, comment: mine.comment } : null,
    ratings: ratings.map((rating) => ({
      complexity: rating.complexity,
      relevance: rating.relevance,
      comment: rating.comment,
      createdAt: rating.createdAt,
      user: rating.user,
    })),
  });
});

academic.put("/subjects/:code/rating", async (c) => {
  const body = await readJson(c, ratingSchema);
  if (!body.ok) return c.json({ error: body.error }, 400);
  const subjectCode = c.req.param("code").toUpperCase();
  const subject = await prisma.subject.findUnique({ where: { code: subjectCode } });
  if (!subject) return c.json({ error: "Matéria não encontrada" }, 404);
  const userId = c.get("userId");
  const existing = await prisma.rating.findFirst({ where: { userId, subjectCode } });
  const data = {
    complexity: body.data.complexity,
    relevance: body.data.relevance,
    comment: body.data.comment ?? "",
  };
  if (existing) {
    await prisma.rating.update({ where: { id: existing.id }, data });
  } else {
    await prisma.rating.create({ data: { ...data, userId, subjectCode } });
  }
  return c.json({ message: "Avaliação salva" });
});

academic.get("/teachers", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const name = c.req.query("name") ?? "";
  const departament = c.req.query("departament") ?? "";
  const where = {
    ...(name ? { name: { contains: name } } : {}),
    ...(departament ? { departament_code: departament } : {}),
  };
  const take = 20;
  const [teachers, total] = await Promise.all([
    prisma.teacher.findMany({ where, orderBy: { name: "asc" }, skip: take * (page - 1), take }),
    prisma.teacher.count({ where }),
  ]);
  return c.json({ teachers, total, page, totalPages: Math.ceil(total / take) });
});

academic.get("/departments", async (c) => {
  const rows = await prisma.teacher.findMany({
    distinct: ["departament_code"],
    select: { departament_code: true, departament_name: true },
    orderBy: { departament_name: "asc" },
  });
  return c.json(rows);
});

academic.get("/ranking", async (c) => {
  const rows = await prisma.curriculum.findMany({ select: { course: { select: { name: true } } } });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = row.course.name.split("-")[0].trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const courses = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  return c.json({ total: rows.length, courses });
});
