/**
 * Import administrators from scripts/import-data/admins.json (or a custom path).
 *
 * Idempotent: a row whose national_id already exists in `admins` is skipped.
 * Mirrors import-teachers.ts so the operator can use the same workflow.
 */

import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env", override: false });

type AdminRow = {
  fullName: string;
  nationalId: string;
  jobTitle?: string | null;
  department?: string | null;
  responsibilities?: string | null;
  qualification?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
};

async function run() {
  const { db, schema } = await import("../src/db/index");

  const arg = process.argv[2] ?? "scripts/import-data/admins.json";
  const jsonPath = arg.startsWith("/") ? arg : resolve(process.cwd(), arg);
  const rows = JSON.parse(readFileSync(jsonPath, "utf-8")) as AdminRow[];
  console.log(`📂 Loaded ${rows.length} admins from ${jsonPath}`);

  const existing = await db
    .select({ nationalId: schema.admins.nationalId })
    .from(schema.admins);
  const existingIds = new Set(existing.map((a) => a.nationalId));

  const toInsert = rows
    .filter((r) => !existingIds.has(r.nationalId))
    .map((r) => ({
      fullName: r.fullName,
      nationalId: r.nationalId,
      jobTitle: r.jobTitle ?? "مساعد اداري",
      department: r.department ?? "الشؤون الإدارية",
      responsibilities: r.responsibilities ?? null,
      qualification: r.qualification ?? null,
      phone: r.phone ?? null,
      email: r.email ?? null,
      notes: r.notes ?? null,
    }));

  if (toInsert.length === 0) {
    console.log(`✅ Nothing to insert — all ${rows.length} already exist.`);
    return;
  }

  const CHUNK = 50;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const slice = toInsert.slice(i, i + CHUNK);
    await db.insert(schema.admins).values(slice);
    inserted += slice.length;
    process.stdout.write(`  inserted ${inserted}/${toInsert.length}\r`);
  }
  process.stdout.write("\n");

  const skipped = rows.length - toInsert.length;
  console.log(
    `✅ Inserted ${inserted} new admin(s); skipped ${skipped} already existing`,
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
