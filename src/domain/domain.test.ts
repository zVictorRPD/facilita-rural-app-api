import { describe, expect, it } from "vitest";
import { averageGrade, workloadProgress } from "./progress.js";
import { decodeScheduleCode, emptyTimetable, getNextClass, placeSubject } from "./timetable.js";

describe("código de horário", () => {
  it("aceita um código do SIGAA e ordena dias e tempos", () => {
    const decoded = decodeScheduleCode("62m21");
    expect(decoded.ok && decoded.value.normalized).toBe("26M12");
  });

  it("recusa turno repetido, dia inválido e tempo inválido", () => {
    expect(decodeScheduleCode("2MT1").ok).toBe(false);
    expect(decodeScheduleCode("1M1").ok).toBe(false);
    expect(decodeScheduleCode("2M6").ok).toBe(false);
    expect(decodeScheduleCode("22M1").ok).toBe(false);
  });

  it("recusa choque de célula", () => {
    const first = placeSubject(emptyTimetable(), "10", "blue.500", "2M12");
    if (!first.ok) throw new Error(first.error);
    const second = placeSubject(first.timetable, "11", "red.500", "2M2");
    expect(second.ok).toBe(false);
  });
});

describe("progresso", () => {
  const totals = { obrigatory: 100, optional: 40, complementary: 20 };
  const subjects = [
    { status: "done", isOptional: false, time: 60 },
    { status: "doing", isOptional: false, time: 30 },
    { status: "todo", isOptional: false, time: 90 },
    { status: "done", isOptional: true, time: 50 },
  ];

  it("soma só as aprovadas", () => {
    expect(workloadProgress(subjects, [30], false, totals)).toEqual({
      obrigatory: 60,
      optional: 40,
      complementary: 20,
      total: 120,
    });
  });

  it("inclui cursando sem contar pendente", () => {
    expect(workloadProgress(subjects, [0], true, totals).obrigatory).toBe(90);
  });

  it("média futura considera cursando", () => {
    const graded = [
      { status: "done", isOptional: false, time: 60, grade: 8 },
      { status: "doing", isOptional: false, time: 60, grade: 6 },
      { status: "todo", isOptional: false, time: 60, grade: 10 },
    ];
    expect(averageGrade(graded, false)).toBe(8);
    expect(averageGrade(graded, true)).toBe(7);
  });
});

describe("próxima aula", () => {
  it("pula o horário que já passou hoje", () => {
    const placed = placeSubject(emptyTimetable(), "4", "green.500", "2M12");
    if (!placed.ok) throw new Error(placed.error);
    const mondayMorning = new Date(2026, 9, 26, 7, 30);
    expect(mondayMorning.getDay()).toBe(1);
    const next = getNextClass(placed.timetable, mondayMorning);
    expect(next?.slot).toBe("2");
    expect(next?.subjectId).toBe("4");
  });
});
