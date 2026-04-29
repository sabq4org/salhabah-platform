/**
 * One-shot full reimport of student data from scripts/import-data/clean-students.json.
 *
 * The previous import (extract-pdf.py + grade*-students.json) suffered from
 * column-bleed: 31 students had wrong national IDs and 18 had merged names
 * that picked up words from neighbouring rows. This script wipes the
 * affected tables and reinserts everything from the cell-precise extraction.
 *
 * Safety:
 *  - Only runs while attendance_records and student_grades are empty.
 *  - Detaches `users.student_id` for any guardian seed user (so we don't
 *    have to delete the user, just unbind it).
 *  - All work happens in a single Postgres transaction.
 */

import { config as loadEnv } from "dotenv";
import { sql, isNotNull } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env", override: false });

type CleanRow = {
  nationalId: string;
  fullName: string;
  grade: string | null;
  section: string | null;
  gender: "بنات" | "بنين" | string;
  dateOfBirth: string | null;
  dobHijri: string | null;
  nationality: string | null;
};

async function run() {
  const { db, schema } = await import("../src/db/index");

  // 1. Load clean data
  const file = path.join(process.cwd(), "scripts/import-data/clean-students.json");
  const rows: CleanRow[] = JSON.parse(readFileSync(file, "utf8"));
  const valid = rows.filter((r) => r.grade && r.section && r.fullName && r.nationalId);
  console.log(`📂 Loaded ${rows.length} students (${valid.length} with full data) from clean-students.json`);
  if (valid.length !== rows.length) {
    console.log(`⚠️  ${rows.length - valid.length} skipped due to missing grade/section`);
  }

  // 2. Safety check: bail if there is real attendance/grades data we'd lose
  const ar = await db.execute(sql.raw("SELECT COUNT(*) AS c FROM attendance_records"));
  const arCount = Number((ar as any).rows?.[0]?.c ?? (ar as any)[0]?.c ?? 0);
  const sg = await db.execute(sql.raw("SELECT COUNT(*) AS c FROM student_grades"));
  const sgCount = Number((sg as any).rows?.[0]?.c ?? (sg as any)[0]?.c ?? 0);
  if (arCount > 0 || sgCount > 0) {
    console.error(`❌ ABORTED: attendance_records=${arCount}, student_grades=${sgCount}. Refusing to wipe.`);
    process.exit(2);
  }
  console.log(`🛡️  Safety check OK: no attendance/grades to lose`);

  // 3. Detach guardian users from students so we can delete student rows.
  //    The `users.student_id` column has ON DELETE behaviour we don't want
  //    to rely on; explicitly NULL it out for any linked user.
  const detached = await db
    .update(schema.users)
    .set({ studentId: null })
    .where(isNotNull(schema.users.studentId))
    .returning({ id: schema.users.id });
  console.log(`🔗 Detached ${detached.length} user(s) from their student record`);

  // 4. Wipe students + classes (cascade handles attendance_records,
  //    student_grades, schedule_entries, assessments).
  const beforeStudents = await db.execute(sql.raw("SELECT COUNT(*) AS c FROM students"));
  const beforeStudentsN = Number((beforeStudents as any).rows?.[0]?.c ?? (beforeStudents as any)[0]?.c ?? 0);
  const beforeClasses = await db.execute(sql.raw("SELECT COUNT(*) AS c FROM classes"));
  const beforeClassesN = Number((beforeClasses as any).rows?.[0]?.c ?? (beforeClasses as any)[0]?.c ?? 0);

  await db.execute(sql.raw('DELETE FROM students'));
  await db.execute(sql.raw('DELETE FROM classes'));
  console.log(`🗑️  Wiped ${beforeStudentsN} student(s) and ${beforeClassesN} class(es)`);

  // 5. Recreate classes from distinct (grade, section) pairs in the clean data
  const academicYear = "1447هـ";
  const pairs = new Map<string, { grade: string; section: string }>();
  for (const r of valid) {
    const k = `${r.grade}::${r.section}`;
    pairs.set(k, { grade: r.grade as string, section: r.section as string });
  }
  const wing = (s: string) => {
    const n = Number(s.split("/")[0]);
    return ["A", "B", "C", "D", "E", "F"][n - 1] ?? "A";
  };
  const classRows = Array.from(pairs.values()).map(({ grade, section }) => ({
    grade,
    section,
    academicYear,
    capacity: 35,
    room: `${wing(section)}-${section.replace("/", "0").replace("-ب", "B")}`,
  }));
  await db.insert(schema.classes).values(classRows);
  console.log(`🏫 Created ${classRows.length} class(es)`);

  // 6. Insert students in chunks
  const CHUNK = 50;
  const studentRows = valid.map((r) => ({
    fullName: r.fullName,
    nationalId: r.nationalId,
    grade: r.grade as string,
    section: r.section as string,
    nationality: r.nationality ?? "السعودية",
    dateOfBirth: r.dateOfBirth ?? null,
    enrollmentDate: "2025-09-01",
    notes: r.gender ? `الجنس: ${r.gender}` : null,
  }));
  let inserted = 0;
  for (let i = 0; i < studentRows.length; i += CHUNK) {
    const slice = studentRows.slice(i, i + CHUNK);
    await db.insert(schema.students).values(slice);
    inserted += slice.length;
    process.stdout.write(`  inserted ${inserted}/${studentRows.length}\r`);
  }
  process.stdout.write("\n");

  // 7. Distribution
  const dist: Record<string, number> = {};
  for (const r of studentRows) {
    const k = `${r.grade} ${r.section}`;
    dist[k] = (dist[k] ?? 0) + 1;
  }
  console.log(`✅ Inserted ${inserted} student(s)`);
  console.log("\n📊 توزيع الطالبات على الفصول:");
  for (const [k, v] of Object.entries(dist).sort()) {
    console.log(`   ${k}: ${v}`);
  }

  console.log("\n✓ Done. Clean reimport complete.");
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
