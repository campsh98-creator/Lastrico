import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const roadReports = sqliteTable("road_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startLng: real("start_lng").notNull(),
  startLat: real("start_lat").notNull(),
  endLng: real("end_lng").notNull(),
  endLat: real("end_lat").notNull(),
  kind: text("kind", {
    enum: ["pave", "rough_cobblestone", "recently_asphalted", "wrong_data"],
  }).notNull(),
  severity: integer("severity").notNull().default(2),
  note: text("note").notNull().default(""),
  nickname: text("nickname").notNull().default(""),
  status: text("status", { enum: ["pending", "verified", "rejected"] })
    .notNull()
    .default("pending"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("road_reports_status_idx").on(table.status),
  index("road_reports_created_at_idx").on(table.createdAt),
]);
