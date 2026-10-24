import { cors } from "hono/cors";
import { Hono } from "hono";
import { academicCalendar, announcements } from "./domain/content.js";
import { account } from "./routes/account.js";
import { academic } from "./routes/academic.js";

export const app = new Hono().basePath("/api");

app.use("*", cors());
app.get("/health", (c) => c.json({ ok: true }));
app.get("/academic-calendar", (c) => c.json(academicCalendar));
app.get("/announcements", (c) => c.json(announcements));
app.route("/", account);
app.route("/", academic);

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "Erro interno" }, 500);
});
