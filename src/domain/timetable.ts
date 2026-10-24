export const COLOR_TOKENS = [
  "blackAlpha.900",
  "red.500",
  "red.700",
  "orange.500",
  "green.500",
  "blue.500",
  "blue.800",
  "cyan.600",
  "purple.500",
  "pink.500",
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

export const COLOR_HEX: Record<ColorToken, string> = {
  "blackAlpha.900": "#1A202C",
  "red.500": "#E53E3E",
  "red.700": "#C53030",
  "orange.500": "#DD6B20",
  "green.500": "#38A169",
  "blue.500": "#3182CE",
  "blue.800": "#2A4365",
  "cyan.600": "#00A3C4",
  "purple.500": "#805AD5",
  "pink.500": "#D53F8C",
};

export const DAY_KEYS = ["2", "3", "4", "5", "6", "7"] as const;
export const TURN_KEYS = ["m", "t", "n"] as const;
export const SLOT_KEYS = ["1", "2", "3", "4", "5"] as const;

export const DAY_LABELS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export const SLOT_HOURS: Record<string, string> = {
  "m-1": "07:00–08:00",
  "m-2": "08:00–09:00",
  "m-3": "09:00–10:00",
  "m-4": "10:00–11:00",
  "m-5": "11:00–12:00",
  "t-1": "12:00–13:00",
  "t-2": "13:00–14:00",
  "t-3": "14:00–15:00",
  "t-4": "15:00–16:00",
  "t-5": "16:00–17:00",
  "n-1": "17:00–18:00",
  "n-2": "18:00–19:00",
  "n-3": "19:00–20:00",
  "n-4": "20:00–21:00",
  "n-5": "21:00–22:00",
};

const SLOT_START: Record<string, number> = {
  "m-1": 7,
  "m-2": 8,
  "m-3": 9,
  "m-4": 10,
  "m-5": 11,
  "t-1": 12,
  "t-2": 13,
  "t-3": 14,
  "t-4": 15,
  "t-5": 16,
  "n-1": 17,
  "n-2": 18,
  "n-3": 19,
  "n-4": 20,
  "n-5": 21,
};

export type TimetableCell = "" | { id: string; bgColor: ColorToken };

export type Timetable = Record<string, Record<string, Record<string, TimetableCell>>>;

export type ScheduleCode = {
  days: string[];
  turn: "m" | "t" | "n";
  slots: string[];
  normalized: string;
};

export function emptyTimetable(): Timetable {
  const timetable: Timetable = {};
  for (const day of DAY_KEYS) {
    timetable[day] = { m: {}, t: {}, n: {} };
    for (const turn of TURN_KEYS) {
      for (const slot of SLOT_KEYS) timetable[day][turn][slot] = "";
    }
  }
  return timetable;
}

export function isColorToken(value: string): value is ColorToken {
  return (COLOR_TOKENS as readonly string[]).includes(value);
}

export function decodeScheduleCode(raw: string): { ok: true; value: ScheduleCode } | { ok: false; error: string } {
  const time = raw.trim().toUpperCase();
  const letters = time.match(/[A-Z]/g) ?? [];
  if (letters.length !== 1 || !/[MTN]/.test(time)) {
    return { ok: false, error: "O horário precisa ter um turno: M, T ou N." };
  }
  const turnLetter = letters[0];
  const turn = turnLetter.toLowerCase() as "m" | "t" | "n";
  const [weekdays, hours] = time.split(turnLetter);
  if (!weekdays || !hours) {
    return { ok: false, error: "Informe os dias e os tempos ao redor do turno. Exemplo: 246M12." };
  }
  if ([...weekdays].some((char) => Number.isNaN(Number.parseInt(char, 10)))) {
    return { ok: false, error: "Os dias da semana são números." };
  }
  if ([...hours].some((char) => Number.isNaN(Number.parseInt(char, 10)))) {
    return { ok: false, error: "Os tempos são números." };
  }
  if ([...weekdays].some((char) => Number.parseInt(char, 10) < 2 || Number.parseInt(char, 10) > 7)) {
    return { ok: false, error: "Os dias vão de 2 (segunda) a 7 (sábado)." };
  }
  if ([...hours].some((char) => Number.parseInt(char, 10) < 1 || Number.parseInt(char, 10) > 5)) {
    return { ok: false, error: "Os tempos vão de 1 a 5." };
  }
  if (new Set(weekdays).size !== weekdays.length) {
    return { ok: false, error: "Não repita o dia da semana." };
  }
  if (new Set(hours).size !== hours.length) {
    return { ok: false, error: "Não repita o tempo." };
  }
  const days = [...weekdays].sort().join("");
  const slots = [...hours].sort().join("");
  return {
    ok: true,
    value: { days: [...days], turn, slots: [...slots], normalized: `${days}${turnLetter}${slots}` },
  };
}

export function placeSubject(
  timetable: Timetable,
  subjectId: string,
  color: ColorToken,
  code: string,
): { ok: true; timetable: Timetable } | { ok: false; error: string } {
  const decoded = decodeScheduleCode(code);
  if (!decoded.ok) return decoded;
  const next = structuredClone(timetable);
  for (const day of decoded.value.days) {
    for (const slot of decoded.value.slots) {
      if (next[day][decoded.value.turn][slot] !== "") {
        return { ok: false, error: "Já existe uma matéria nesse horário." };
      }
    }
  }
  for (const day of decoded.value.days) {
    for (const slot of decoded.value.slots) {
      next[day][decoded.value.turn][slot] = { id: subjectId, bgColor: color };
    }
  }
  return { ok: true, timetable: next };
}

export function removeSubject(timetable: Timetable, subjectId: string): Timetable {
  const next = structuredClone(timetable);
  for (const day of DAY_KEYS) {
    for (const turn of TURN_KEYS) {
      for (const slot of SLOT_KEYS) {
        const cell = next[day][turn][slot];
        if (cell !== "" && cell.id === subjectId) next[day][turn][slot] = "";
      }
    }
  }
  return next;
}

export function parseTimetable(raw: unknown): Timetable | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Timetable;
  for (const day of DAY_KEYS) {
    if (!value[day]) return null;
    for (const turn of TURN_KEYS) {
      if (!value[day][turn]) return null;
      for (const slot of SLOT_KEYS) {
        const cell = value[day][turn][slot];
        if (cell === "") continue;
        if (!cell || typeof cell !== "object") return null;
        if (typeof cell.id !== "string" || !isColorToken(cell.bgColor)) return null;
      }
    }
  }
  return value;
}

export type NextClass = {
  dayKey: string;
  day: string;
  turn: string;
  slot: string;
  hour: string;
  subjectId: string;
};

export function getNextClass(timetable: Timetable, now = new Date()): NextClass | null {
  const classes: NextClass[] = [];
  DAY_KEYS.forEach((dayKey, index) => {
    for (const turn of TURN_KEYS) {
      for (const slot of SLOT_KEYS) {
        const cell = timetable[dayKey][turn][slot];
        if (cell === "") continue;
        classes.push({
          dayKey,
          day: DAY_LABELS[index],
          turn,
          slot,
          hour: SLOT_HOURS[`${turn}-${slot}`],
          subjectId: cell.id,
        });
      }
    }
  });
  if (classes.length === 0) return null;

  const weekday = now.getDay();
  const hour = now.getHours();
  const upcoming = classes.find((item) => {
    const itemDay = Number.parseInt(item.dayKey, 10) - 1;
    const start = SLOT_START[`${item.turn}-${item.slot}`];
    if (weekday === 0) return true;
    if (itemDay > weekday) return true;
    if (itemDay === weekday && start > hour) return true;
    return false;
  });
  return upcoming ?? classes[0];
}

export function timetableRows(timetable: Timetable, names: Record<string, string>) {
  return SLOT_KEYS.flatMap((slot) =>
    TURN_KEYS.map((turn) => {
      const row: Record<string, string> = { Horário: SLOT_HOURS[`${turn}-${slot}`] };
      DAY_KEYS.forEach((day, index) => {
        const cell = timetable[day][turn][slot];
        row[DAY_LABELS[index]] = cell === "" ? "" : names[cell.id] ?? "";
      });
      return row;
    }),
  );
}
