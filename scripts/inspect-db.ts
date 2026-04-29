import { config as loadEnv } from "dotenv";
import { sql, eq } from "drizzle-orm";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env", override: false });

async function run() {
  const { db, schema } = await import("../src/db/index");

  const students = await db.select().from(schema.students);
  console.log(`\n📊 إجمالي الطالبات: ${students.length}`);

  const byGrade = students.reduce<Record<string, Record<string, number>>>(
    (acc, s) => {
      acc[s.grade] = acc[s.grade] ?? {};
      acc[s.grade][s.section] = (acc[s.grade][s.section] ?? 0) + 1;
      return acc;
    },
    {},
  );

  console.log(`\n📋 التوزيع على الصفوف والفصول:`);
  for (const grade of Object.keys(byGrade).sort()) {
    const sections = byGrade[grade];
    const total = Object.values(sections).reduce((a, b) => a + b, 0);
    console.log(`   ${grade.padEnd(20)} (${total} طالب/ـة)`);
    for (const sec of Object.keys(sections).sort()) {
      const tag = sec.endsWith("-ب") ? "بنين" : "بنات";
      console.log(`      ${sec.padEnd(10)} ${tag}: ${sections[sec]}`);
    }
  }

  // Quick name + DOB sanity sample
  console.log(`\n👀 عينة من السجلات (أول 5 من كل صف):`);
  const grades = Array.from(new Set(students.map((s) => s.grade))).sort();
  for (const g of grades) {
    console.log(`   ${g}:`);
    students
      .filter((s) => s.grade === g)
      .slice(0, 3)
      .forEach((s) => {
        const tag = s.section.endsWith("-ب") ? "ذ" : "أ";
        console.log(
          `      [${tag}] ${s.fullName.padEnd(35)} | ${s.nationalId} | ${s.nationality ?? "-"} | DOB: ${s.dateOfBirth ?? "-"}`,
        );
      });
  }

  // Nationality breakdown
  const natCount: Record<string, number> = {};
  for (const s of students) {
    const n = s.nationality ?? "غير محدد";
    natCount[n] = (natCount[n] ?? 0) + 1;
  }
  console.log(`\n🌍 الجنسيات:`);
  for (const [n, c] of Object.entries(natCount).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${n.padEnd(15)} ${c}`);
  }

  // Gender count from notes
  const boys = students.filter((s) => s.notes?.includes("بنين")).length;
  const girls = students.filter((s) => s.notes?.includes("بنات")).length;
  console.log(`\n👫 التوزيع حسب الجنس:`);
  console.log(`   بنات: ${girls}`);
  console.log(`   بنين: ${boys}`);

  // Classes
  const classes = await db.select().from(schema.classes);
  console.log(`\n🏫 الفصول (${classes.length}):`);
  for (const c of classes) {
    console.log(`   ${c.grade.padEnd(20)} ${c.section.padEnd(10)} ${c.academicYear}`);
  }

  const teachers = await db.select().from(schema.teachers);
  const admins = await db.select().from(schema.admins);
  const users = await db.select().from(schema.users);
  console.log(`\n👤 أخرى: معلمات=${teachers.length} | إداريات=${admins.length} | مستخدمين=${users.length}`);
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
