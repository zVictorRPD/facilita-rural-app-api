import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.TURSO_DATABASE_URL ?? "file:./prisma/dev.db",
  },
});
