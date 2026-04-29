import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env", override: false });

type StudentRow = {
  fullName: string;
  nationalId: string;
  grade: string;
  section: string;
  dateOfBirth?: string | null;
  nationality?: string | null;
  gender?: "بنات" | "بنين" | string | null;
  seq?: number;
};

async function run() {
  const { db, schema } = await import("../src/db/index");

  // Accept the JSON file as a CLI arg; default to grade1 for back-compat.
  const arg = process.argv[2] ?? "scripts/import-data/grade1-students.json";
  const jsonPath = arg.startsWith("/") ? arg : resolve(process.cwd(), arg);
  const rows = JSON.parse(readFileSync(jsonPath, "utf-8")) as StudentRow[];
  console.log(`📂 Loaded ${rows.length} students from ${jsonPath}`);

  // Make sure every (grade, section) referenced by the import exists
  // as a class row, so timetables / attendance / grades pages can
  // render properly. We treat (grade, section, academicYear) as the
  // logical key — see classes.gradeSectionYearUnique.
  const academicYear = "1447هـ";

  // A single JSON file can carry rows from several grades (e.g. boys vs
  // girls of the same level both stored under the same grade label) and
  // multiple sections per grade. Collect all (grade, section) pairs so
  // the matching class rows are guaranteed to exist.
  const pairsKey = (g: string, s: string) => `${g}::${s}`;
  const allPairs = new Map<string, { grade: string; section: string }>();
  for (const r of rows) {
    allPairs.set(pairsKey(r.grade, r.section), {
      grade: r.grade,
      section: r.section,
    });
  }

  const distinctGrades = Array.from(new Set(rows.map((r) => r.grade)));
  const existingClasses = await db.select().from(schema.classes);
  const existingPairs = new Set(
    existingClasses.map((c) => pairsKey(c.grade, c.section)),
  );

  const missingPairs = Array.from(allPairs.values()).filter(
    (p) => !existingPairs.has(pairsKey(p.grade, p.section)),
  );

  if (missingPairs.length > 0) {
    const wing = (s: string) => {
      const n = Number(s.split("/")[0]);
      return ["A", "B", "C", "D", "E", "F"][n - 1] ?? "A";
    };
    await db.insert(schema.classes).values(
      missingPairs.map(({ grade, section }) => ({
        grade,
        section,
        academicYear,
        capacity: 35,
        room: `${wing(section)}-${section.replace("/", "0").replace("-ب", "B")}`,
      })),
    );
    console.log(
      `🏫 Created ${missingPairs.length} new class section(s): ${missingPairs
        .map((p) => `${p.grade} ${p.section}`)
        .join(", ")}`,
    );
  } else {
    console.log(`🏫 All ${allPairs.size} sections across ${distinctGrades.length} grade(s) already exist`);
  }

  // Insert students, skipping any whose national_id is already in DB.
  const existing = await db
    .select({ nationalId: schema.students.nationalId })
    .from(schema.students);
  const existingIds = new Set(existing.map((s) => s.nationalId));

  const toInsert = rows
    .filter((r) => !existingIds.has(r.nationalId))
    .map((r) => ({
      fullName: r.fullName,
      nationalId: r.nationalId,
      grade: r.grade,
      section: r.section,
      nationality: r.nationality ?? "سعودية",
      dateOfBirth: r.dateOfBirth ?? null,
      enrollmentDate: "2025-09-01",
      // Gender isn't a column in the schema — store it in `notes` so that
      // pages and exports can still distinguish بنين / بنات without a
      // schema migration.
      notes: r.gender ? `الجنس: ${r.gender}` : null,
    }));

  if (toInsert.length === 0) {
    console.log(`✅ Nothing to insert — all ${rows.length} already exist.`);
    return;
  }

  // Insert in chunks to keep payload reasonable on the HTTP driver.
  const CHUNK = 50;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const slice = toInsert.slice(i, i + CHUNK);
    await db.insert(schema.students).values(slice);
    inserted += slice.length;
    process.stdout.write(`  inserted ${inserted}/${toInsert.length}\r`);
  }
  process.stdout.write("\n");

  const skipped = rows.length - toInsert.length;
  console.log(
    `✅ Inserted ${inserted} new student(s); skipped ${skipped} already existing`,
  );

  // Per-section tally
  const byGradeSection: Record<string, number> = {};
  for (const r of toInsert) {
    const k = `${r.grade} ${r.section}`;
    byGradeSection[k] = (byGradeSection[k] ?? 0) + 1;
  }
  console.log("📊 Distribution:");
  for (const [k, v] of Object.entries(byGradeSection).sort()) {
    console.log(`    ${k}: ${v}`);
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
