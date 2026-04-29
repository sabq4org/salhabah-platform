# AGENTS.md — دليل المساعد الذكي لمشروع منصة صلهبه

> هذا الملف يُقرأ تلقائياً من قِبل وكلاء الذكاء الاصطناعي (Cursor / Claude Code) عند
> فتح المشروع. أبقيه محدّثاً كلما حصلت تغييرات تشغيلية مهمة.

## هوية المشروع

| المفتاح | القيمة |
|---|---|
| الاسم الرسمي | ابتدائية صلهبه الأولى وروضة صبيا الثالثة — صبيا |
| الاسم التقني | `salhabah-platform` |
| المديرة | مها عبدالفتاح (`maha@salhabah.edu.sa`) |
| المرحلة | روضة (KG1/KG2/KG3) + ابتدائي (الأول → السادس) |
| لوحة الألوان | أخضر زمردي `#2f8a5b` + ذهبي دافئ `#d4a52b` |
| الـ Stack | Next.js 16 (App Router) + TypeScript + Drizzle ORM + Neon Postgres |
| Cookies | `sal_session` / `sal_csrf` / `sal_inquiry` |
| Dev port الموصى به | 3001 (للسماح بتشغيل منصات أخرى على 3000) |
| الـ Repo | يُربط بـ GitHub لاحقاً (مقترح: `sabq4org/salhabah-platform`) |

## أصل المشروع

استُنسخ هذا المشروع من `umm-habiba-platform` (وهي بدورها من `school-158-platform`)
ثم تكيّفت كل التفاصيل لمدرسة صلهبه. يعني الكود يحتوي ميزات ناضجة بما فيها:

- نظام صلاحيات (`src/lib/permissions.ts`) بأدوار: `admin / staff / teacher / guardian`
- نسخ احتياطي و استعادة كامل (`/settings/backup` + `src/lib/backup.ts`)
- تصدير قاعدة البيانات (`npm run db:export`)
- استيراد طالبات/معلمات من JSON (مولّدة من Excel)
- صفحة استعلام علني لأولياء الأمور (`/inquiry`)
- شهادات قابلة للطباعة (`/grades/.../certificate`)

## التشغيل المحلي

```bash
# 1. ضعي قاعدة البيانات + سرّ التوقيع في .env.local (موجود محلياً، خارج Git)
#    DATABASE_URL=postgresql://...neon...
#    AUTH_SECRET=<48-byte hex string>

# 2. طبّقي السكيما على Neon (مرة واحدة لكل قاعدة جديدة)
npx drizzle-kit push --force

# 3. ابذري بيانات تجريبية (اختياري؛ يتخطّى ما هو موجود فعلاً)
npm run db:seed

# 4. شغّلي خادم التطوير على بورت 3001 لتفادي تعارض المنصات الأخرى
npm run dev -- -p 3001
```

## حسابات الدخول التجريبية (افتراضية بعد `db:seed`)

| اسم المستخدم | كلمة المرور | الدور | ملاحظة |
|---|---|---|---|
| `admin` | `admin1234` | المديرة (مها عبدالفتاح) | الوحيد القادر على النسخ الاحتياطي |
| `staff` | `staff1234` | وكيلة المدرسة | كل صلاحيات الإدارة عدا backup |
| `teacher` | `teacher1234` | معلمة (نورة السبيعي) | حضور + درجات لفصلها |
| `guardian` | `guardian1234` | ولي أمر | عرض ابنته فقط |

> غيّري كل كلمات المرور في الإنتاج. النظام يجبر تغيير كلمة المرور عند أول دخول
> لو ضبطنا `mustChangePassword=true`.

## أوامر `npm` المهمة

```bash
npm run dev              # خادم تطوير (مرّري -p 3001 للبورت)
npm run build            # بناء production
npm run start            # تشغيل production build
npm run lint             # ESLint

npm run db:push          # تطبيق سكيما drizzle على القاعدة
npm run db:studio        # واجهة استكشاف القاعدة
npm run db:seed          # بذر بيانات تجريبية (idempotent)
npm run db:export        # تصدير كل الجداول إلى database-export/ (JSON+CSV+SQL)

# سكربتات الاستيراد (تحتاج ملفات JSON في scripts/import-data/ خارج Git)
npm run db:import-students -- scripts/import-data/<filename>.json
npm run db:import-teachers
npm run db:purge-fake    # يحذف بيانات seed التجريبية ويُبقي الحقيقية
```

## مواقع الكود الأساسية

| الميزة | الموقع |
|---|---|
| Schema قاعدة البيانات | `src/db/schema.ts` |
| اتصال DB | `src/db/index.ts` |
| بيانات seed | `src/db/seed.ts` |
| المصادقة و الجلسات | `src/lib/auth.ts` |
| الصلاحيات + الأدوار | `src/lib/permissions.ts` + `src/lib/roles.ts` |
| النسخ الاحتياطي | `src/lib/backup.ts` + `/settings/backup` page |
| Middleware (الجلسة + CSRF) | `src/middleware.ts` |
| الباليت + كل الأنماط | `src/app/globals.css` |
| سكربتات أوفلاين | `scripts/*.ts` |

## بيانات حسّاسة — لا تُرفع لـ GitHub

`.gitignore` يستثني الآتي وهي أماكن تخزين البيانات الحقيقية:

- `.env*.local` — يحتوي `DATABASE_URL` و `AUTH_SECRET`.
- `database-export/` — مخرجات `npm run db:export` (تحتوي PII + هاشات كلمات سر).
- `scripts/import-data/` — ملفات JSON المولّدة من Excel (أسماء + أرقام هويات حقيقية).

## استيراد بيانات حقيقية من Excel (آلية تم اختبارها سابقاً)

1. ضعي ملف Excel في مكان مؤقت (مثلاً `~/Downloads/students.xlsx`).
2. شغّلي سكربت Python محلي لاستخراج الأعمدة المطلوبة إلى JSON
   (الأعمدة المطلوبة: الاسم في عمود `name`، رقم الهوية في `nationalId`،
   رقم الصف، رقم الفصل، الترقيم).
3. احفظي الـ JSON في `scripts/import-data/grade<N>-students.json`.
4. شغّلي:
   ```bash
   npm run db:import-students -- scripts/import-data/grade1-students.json
   ```
5. السكربت idempotent — يتخطّى أي رقم هوية موجود مسبقاً، ويُنشئ الفصول
   الناقصة تلقائياً.

نفس الفكرة لـ `db:import-teachers` (يقرأ `scripts/import-data/teachers.json`).

## بعد إدخال بيانات حقيقية → تنظيف الـ seed

```bash
npm run db:purge-fake
```

السكربت يحدّد الـ seed بناءً على الإيميلات الافتراضية (`maha@salhabah.edu.sa`
يُحفظ كمديرة) ويحذف باقي الحسابات + بيانات التشغيل التجريبية.

## النشر (مرجع — لم يُنفّذ بعد)

- `vercel.json` يثبّت Framework Preset على `nextjs` لتفادي خطأ
  "Output Directory `public`".
- `.do/app.yaml` جاهز لـ DigitalOcean App Platform.
- في كلا الحالتين تحتاج المتغيرات: `DATABASE_URL` + `AUTH_SECRET`.

## نقاط حذر للوكيل الذكي

1. **لا تُغيّري** `SNAPSHOT_PLATFORM` في `src/lib/backup.ts` — يجب أن يبقى
   `"salhabah-platform"` وإلا تفشل استعادة النسخ الاحتياطية.
2. **لا تُسمّي** الكوكيز `umh_*` (هذه لمنصة أم حبيبة) ولا `sch158_*`. الكوكيز
   هنا كلها `sal_*`.
3. **لا تُضيفي** بيانات حقيقية في seed.ts — البيانات التجريبية فقط هناك.
4. عند تعديل `globals.css`، أبقي على باليت الأخضر الزمردي + الذهبي الدافئ
   (متغيرات CSS في `:root` و `[data-theme="dark"]`).
5. عند تعديل `seed.ts`، الصفوف يجب أن تظل مرحلة ابتدائية أو روضة (لا متوسطة
   ولا ثانوية).
