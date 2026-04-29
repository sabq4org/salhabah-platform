import { config as loadEnv } from "dotenv";
import { eq, sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env", override: false });

async function run() {
  const { db, schema } = await import("../src/db/index");

  // 1. Total counts
  const total = await db.execute(sql.raw("SELECT COUNT(*) AS c FROM students"));
  const tn = Number((total as any).rows?.[0]?.c ?? (total as any)[0]?.c ?? 0);
  const cls = await db.execute(sql.raw("SELECT COUNT(*) AS c FROM classes"));
  const cn = Number((cls as any).rows?.[0]?.c ?? (cls as any)[0]?.c ?? 0);
  console.log(`📊 الإحصاءات النهائية:`);
  console.log(`   إجمالي الطالبات/الطلاب: ${tn}`);
  console.log(`   إجمالي الفصول: ${cn}`);

  // 2. Duplicates
  const dup = await db
    .select({ nationalId: schema.students.nationalId, count: sql<number>`count(*)::int`.as("c") })
    .from(schema.students)
    .groupBy(schema.students.nationalId)
    .having(sql`count(*) > 1`);
  console.log(`   تكرار رقم الهوية: ${dup.length} (يجب أن يكون 0)`);

  const dupName = await db
    .select({ fullName: schema.students.fullName, count: sql<number>`count(*)::int`.as("c") })
    .from(schema.students)
    .groupBy(schema.students.fullName)
    .having(sql`count(*) > 1`);
  console.log(`   تكرار الاسم الكامل: ${dupName.length} (يجب أن يكون 0)`);

  // 3. The originally-reported student
  const target = await db
    .select()
    .from(schema.students)
    .where(eq(schema.students.nationalId, "1191985561"));
  console.log(`\n🎯 الطالبة 1191985561:`);
  for (const r of target) {
    console.log(`   - ${r.fullName} | ${r.grade} ${r.section} | DOB=${r.dateOfBirth}`);
  }

  // 4. Make sure the 31 previously-missing IDs are now there
  const wasMissingExamples = ["14038497", "13428991", "16288381", "15934228", "16000259", "12835373", "08266058"];
  console.log(`\n🔎 الأرقام التي كانت مفقودة:`);
  for (const nid of wasMissingExamples) {
    const r = await db
      .select({ fullName: schema.students.fullName, grade: schema.students.grade, section: schema.students.section })
      .from(schema.students)
      .where(eq(schema.students.nationalId, nid));
    if (r.length === 0) console.log(`   ❌ ${nid}: غير موجود!`);
    else console.log(`   ✅ ${nid}: ${r[0].fullName} | ${r[0].grade} ${r[0].section}`);
  }

  // 5. Check that no garbage IDs remain (the 30 that were synthesized)
  const wasGarbage = ["0201072078", "9013428991", "4182291171", "4929358457", "4477356093", "0191076541"];
  console.log(`\n🗑️  الأرقام المُختَلَقة قديماً (يجب ألا تكون موجودة):`);
  for (const nid of wasGarbage) {
    const r = await db
      .select({ fullName: schema.students.fullName })
      .from(schema.students)
      .where(eq(schema.students.nationalId, nid));
    if (r.length === 0) console.log(`   ✅ ${nid}: مُحذوف`);
    else console.log(`   ⚠️  ${nid}: ما زال موجوداً → ${r[0].fullName}`);
  }

  // 6. Distribution
  const all = await db
    .select({ grade: schema.students.grade, section: schema.students.section, notes: schema.students.notes })
    .from(schema.students);
  const dist: Record<string, number> = {};
  let girls = 0, boys = 0;
  for (const r of all) {
    const k = `${r.grade} ${r.section}`;
    dist[k] = (dist[k] ?? 0) + 1;
    if (r.notes?.includes("بنات")) girls++;
    else if (r.notes?.includes("بنين")) boys++;
  }
  console.log(`\n📊 التوزيع حسب الجنس:`);
  console.log(`   بنات: ${girls}`);
  console.log(`   بنين: ${boys}`);
  console.log(`\n📊 التوزيع على الفصول:`);
  for (const [k, v] of Object.entries(dist).sort()) console.log(`   ${k}: ${v}`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
