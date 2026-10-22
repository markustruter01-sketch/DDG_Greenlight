import { pgTable, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const greenlightProjects = pgTable("greenlight_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  source: text("source").notNull(),
  ownerId: text("owner_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export const greenlightRuns = pgTable("greenlight_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => greenlightProjects.id).notNull(),
  result: jsonb("result").notNull(),
  evidence: jsonb("evidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("greenlight_runs_project_idx").on(t.projectId)]);
export const greenlightReports = pgTable("greenlight_reports", {
  id: text("id").primaryKey(),
  runId: text("run_id").references(() => greenlightRuns.id).notNull(),
  kind: text("kind").notNull(),
  format: text("format").notNull(),
  objectPath: text("object_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const greenlightFixes = pgTable("greenlight_fixes", {
  id: text("id").primaryKey(),
  runId: text("run_id").references(() => greenlightRuns.id).notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const insertGreenlightProjectSchema = createInsertSchema(greenlightProjects);
export const insertGreenlightRunSchema = createInsertSchema(greenlightRuns);
