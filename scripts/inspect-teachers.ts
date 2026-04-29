import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env", override: false });

async function run() {
  const { db, schema } = await import("../src/db/index");
  const teachers = await db.select().from(schema.teachers);
  console.log(`📊 إجمالي المعلمات: ${teachers.length}\n`);
  for (const t of teachers) {
    console.log(
      `  ${t.nationalId.padEnd(12)} ${t.fullName.padEnd(40)} | ${(t.phone ?? "-").padEnd(11)} | ${t.email ?? "-"}`,
    );
  }
}
run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
