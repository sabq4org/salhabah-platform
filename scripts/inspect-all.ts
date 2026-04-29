import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env", override: false });

async function run() {
  const { db, schema } = await import("../src/db/index");

  const counts = {
    students: (await db.select().from(schema.students)).length,
    teachers: (await db.select().from(schema.teachers)).length,
    admins: (await db.select().from(schema.admins)).length,
    users: (await db.select().from(schema.users)).length,
    classes: (await db.select().from(schema.classes)).length,
    subjects: (await db.select().from(schema.subjects)).length,
    scheduleEntries: (await db.select().from(schema.scheduleEntries)).length,
    attendanceRecords: (await db.select().from(schema.attendanceRecords)).length,
    assessments: (await db.select().from(schema.assessments)).length,
    studentGrades: (await db.select().from(schema.studentGrades)).length,
    announcements: (await db.select().from(schema.announcements)).length,
    messages: (await db.select().from(schema.messages)).length,
    auditLogs: (await db.select().from(schema.auditLogs)).length,
    loginAttempts: (await db.select().from(schema.loginAttempts)).length,
  };

  console.log("📊 إحصاء كامل لقاعدة البيانات:\n");
  for (const [k, v] of Object.entries(counts)) {
    console.log(`   ${k.padEnd(20)} ${v}`);
  }

  console.log("\n👤 الإداريات:");
  const admins = await db.select().from(schema.admins);
  for (const a of admins) {
    console.log(`   - ${a.nationalId.padEnd(12)} ${a.fullName} | ${a.jobTitle} | ${a.email ?? "-"}`);
  }

  console.log("\n🧑 المستخدمون:");
  const users = await db.select().from(schema.users);
  for (const u of users) {
    console.log(`   - ${u.username.padEnd(12)} ${u.fullName} | ${u.role}`);
  }

  console.log("\n🏫 الفصول:");
  const classes = await db.select().from(schema.classes);
  for (const c of classes) {
    console.log(`   - ${c.grade.padEnd(20)} ${c.section.padEnd(10)} ${c.academicYear}  room=${c.room ?? "-"}`);
  }

  console.log("\n📚 المواد:");
  const subjects = await db.select().from(schema.subjects);
  for (const s of subjects) {
    console.log(`   - [${s.code ?? "—"}] ${s.name.padEnd(20)} | ${s.grade.padEnd(20)} | ${s.weeklyPeriods} حصص/أسبوع`);
  }
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
