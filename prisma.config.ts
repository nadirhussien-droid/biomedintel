// Prisma CLI configuration (migrations, seeding, Prisma Studio).
// The CLI always connects as the OWNER role (DATABASE_URL_ADMIN), because it
// creates tables, policies and grants. The web app never uses this URL.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL_ADMIN"),
  },
});
