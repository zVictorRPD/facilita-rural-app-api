export type SubjectStatus = "todo" | "doing" | "done";

export type ProgressSubject = {
  status: string;
  isOptional: boolean;
  time: number;
  grade?: number | null;
  teacherId?: number | null;
  teacherName?: string | null;
  note?: string | null;
  links?: unknown[];
};

export type WorkloadTotals = {
  obrigatory: number;
  optional: number;
  complementary: number;
};

export type WorkloadProgress = WorkloadTotals & { total: number };

export const defaultFilter = {
  obligatory: true,
  optional: true,
  todo: true,
  doing: true,
  done: true,
};

export function workloadProgress(
  subjects: ProgressSubject[],
  complementaryHours: number[],
  useDoing: boolean,
  totals: WorkloadTotals,
): WorkloadProgress {
  const counted = subjects.filter((subject) =>
    useDoing ? subject.status === "doing" || subject.status === "done" : subject.status === "done",
  );
  const sum = (items: ProgressSubject[]) => items.reduce((total, subject) => total + (subject.time || 0), 0);
  const complementary = Math.min(
    complementaryHours.reduce((total, hours) => total + (hours > 0 ? hours : 0), 0),
    totals.complementary,
  );
  const obrigatory = Math.min(sum(counted.filter((subject) => !subject.isOptional)), totals.obrigatory);
  const optional = Math.min(sum(counted.filter((subject) => subject.isOptional)), totals.optional);
  return {
    complementary,
    obrigatory,
    optional,
    total: complementary + obrigatory + optional,
  };
}

export function averageGrade(subjects: ProgressSubject[], includeDoing: boolean) {
  const graded = subjects.filter((subject) => {
    if (typeof subject.grade !== "number") return false;
    if (includeDoing) return subject.status === "done" || subject.status === "doing";
    return subject.status === "done";
  });
  if (graded.length === 0) return null;
  const total = graded.reduce((sum, subject) => sum + (subject.grade ?? 0), 0);
  return Math.round((total / graded.length) * 10) / 10;
}

export function topTeacher(subjects: ProgressSubject[]) {
  const counts = new Map<string, number>();
  for (const subject of subjects) {
    if (!subject.teacherName) continue;
    counts.set(subject.teacherName, (counts.get(subject.teacherName) ?? 0) + 1);
  }
  let name: string | null = null;
  let count = 0;
  for (const [teacher, value] of counts) {
    if (value > count) {
      name = teacher;
      count = value;
    }
  }
  return name;
}
