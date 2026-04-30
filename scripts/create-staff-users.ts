/**
 * Create login accounts (`users` rows) for every teacher and admin who
 * doesn't already have one.
 *
 * - username   = the staff member's national_id
 * - password   = last 4 digits of the national_id + "salhabah"
 *                (e.g. nat_id 1050025178 → "5178salhabah")
 * - role       = "teacher" for teachers, "staff" for admins
 *                (the existing principal account "admin" stays untouched)
 * - mustChangePassword = true (forces a password change on first login)
 *
 * The script prints a credentials table at the end so the operator can
 * hand initial passwords to each staff member; nothing is written to disk.
 */

import { config as loadEnv } from "dotenv";
import { eq, isNotNull, or } from "drizzle-orm";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env", override: false });

async function run() {
  const { db, schema } = await import("../src/db/index");
  const { hashPassword } = await import("../src/lib/auth");

  const teachers = await db
    .select({
      id: schema.teachers.id,
      fullName: schema.teachers.fullName,
      nationalId: schema.teachers.nationalId,
    })
    .from(schema.teachers);

  const admins = await db
    .select({
      id: schema.admins.id,
      fullName: schema.admins.fullName,
      nationalId: schema.admins.nationalId,
    })
    .from(schema.admins);

  // Find users that already point at one of these teachers/admins, OR have a
  // username that collides with a national_id we'd want to use, OR carry a
  // full name that matches one of these staff members (catches the case where
  // the seed `admin` user pre-existed for the principal but was not yet bound
  // to her admins row).
  const linked = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      fullName: schema.users.fullName,
      teacherId: schema.users.teacherId,
      adminId: schema.users.adminId,
    })
    .from(schema.users);
  const linkedTeacherIds = new Set(linked.map((u) => u.teacherId).filter(Boolean));
  const linkedAdminIds = new Set(linked.map((u) => u.adminId).filter(Boolean));
  const usedUsernames = new Set(linked.map((u) => u.username));
  const usedFullNames = new Set(linked.map((u) => u.fullName));

  type Plan = {
    fullName: string;
    nationalId: string;
    username: string;
    password: string;
    role: "teacher" | "staff";
    teacherId?: string;
    adminId?: string;
  };
  const plans: Plan[] = [];

  for (const t of teachers) {
    if (linkedTeacherIds.has(t.id)) continue;
    if (usedUsernames.has(t.nationalId)) continue;
    if (usedFullNames.has(t.fullName)) continue;
    plans.push({
      fullName: t.fullName,
      nationalId: t.nationalId,
      username: t.nationalId,
      password: `${t.nationalId.slice(-4)}salhabah`,
      role: "teacher",
      teacherId: t.id,
    });
  }
  for (const a of admins) {
    if (linkedAdminIds.has(a.id)) continue;
    if (usedUsernames.has(a.nationalId)) continue;
    if (usedFullNames.has(a.fullName)) continue;
    plans.push({
      fullName: a.fullName,
      nationalId: a.nationalId,
      username: a.nationalId,
      password: `${a.nationalId.slice(-4)}salhabah`,
      role: "staff",
      adminId: a.id,
    });
  }

  if (plans.length === 0) {
    console.log("✅ Every teacher and admin already has a user account — nothing to do.");
    return;
  }

  console.log(`📋 Planning to create ${plans.length} user account(s):`);
  console.log(`   teachers needing accounts: ${plans.filter((p) => p.role === "teacher").length}`);
  console.log(`   admins   needing accounts: ${plans.filter((p) => p.role === "staff").length}`);
  console.log();

  // Hash all passwords first (parallel-friendly), then insert in chunks.
  const inserts = await Promise.all(
    plans.map(async (p) => ({
      username: p.username,
      passwordHash: await hashPassword(p.password),
      fullName: p.fullName,
      role: p.role,
      teacherId: p.teacherId ?? null,
      adminId: p.adminId ?? null,
      status: "active" as const,
      mustChangePassword: true,
    })),
  );

  const CHUNK = 25;
  let done = 0;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const slice = inserts.slice(i, i + CHUNK);
    await db.insert(schema.users).values(slice);
    done += slice.length;
    process.stdout.write(`  created ${done}/${inserts.length}\r`);
  }
  process.stdout.write("\n");

  console.log("\n🔐 كلمات المرور الأولية (أبلغي كل موظفة بكلمتها — ستُجبر على تغييرها أول دخول):\n");
  console.log(
    "─".repeat(8) +
      " " +
      "─".repeat(40) +
      " " +
      "─".repeat(14) +
      " " +
      "─".repeat(20),
  );
  console.log(
    "الدور".padEnd(8) +
      " " +
      "الاسم".padEnd(40) +
      " " +
      "اسم الدخول".padEnd(14) +
      " " +
      "كلمة المرور",
  );
  console.log(
    "─".repeat(8) +
      " " +
      "─".repeat(40) +
      " " +
      "─".repeat(14) +
      " " +
      "─".repeat(20),
  );
  for (const p of plans) {
    console.log(
      `${p.role.padEnd(8)} ${p.fullName.padEnd(40)} ${p.username.padEnd(14)} ${p.password}`,
    );
  }
  console.log();
  console.log(
    `✅ Created ${plans.length} user account(s). All marked with mustChangePassword=true.`,
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
