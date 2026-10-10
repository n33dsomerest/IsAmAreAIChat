# AIChat

แชท AI หลายโมเดลในที่เดียว — รวมจุดแข็งของ ChatGPT + Claude + Gemini
สลับผู้ให้บริการได้จากหน้าแอดมิน และเก็บเงินแบบ PromptPay ผ่าน SlipOK

## Stack

| Layer | เลือกใช้ |
|---|---|
| Framework | Next.js 16 (App Router) · React 19 |
| Language | TypeScript (strict) |
| UI | Tailwind CSS v4 · shadcn/ui (Radix, preset `nova`) |
| AI | Vercel AI SDK **v7** · `@ai-sdk/openai-compatible` |
| DB | Supabase (Postgres + Auth + Storage) |
| ORM | Drizzle ORM + postgres.js |
| i18n | next-intl *(เฟส 2)* |
| Deploy | Vercel |

> AI SDK 7 ต้องใช้ Node 22+ และ ESM `import` (ไม่ใช้ `require()`)

## Setup

```bash
npm install
cp .env.example .env.local     # แล้วเติมค่าจริง
npm run dev
```

### ตั้งค่า Supabase

1. สร้าง project ที่ [supabase.com](https://supabase.com)
2. **Settings (ไอคอนเฟือง) → Database → Connection string → แท็บ "Session pooler"**
   → copy ค่า `URI` มาใส่ `DATABASE_URL` (port **5432**)
3. **Settings → API** → ใส่ `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
4. สร้าง Storage bucket ชื่อ `attachments`

<details>
<summary>ทำไมใช้ Session pooler (5432) ไม่ใช่ Transaction pooler (6543)?</summary>

ทั้งคู่เข้าผ่าน IPv4 ได้ แต่ **Transaction pooler ไม่รองรับ prepared statements**
(ใช้ pgbouncer โหมด transaction) — โค้ด runtime ของเราตั้ง `prepare: false` ไว้แล้วจึงไม่มีปัญหา
แต่ `drizzle-kit migrate` เชื่อมต่อเองและอาจเปิด prepared statement → พัง

Session pooler (5432) ใช้ได้ทั้งสองทาง จึงเป็นค่าเริ่มต้นที่ปลอดภัยกว่า
ถ้าวันไหนโหลดหนักจน Session pooler รับไม่ไหว ค่อยย้าย runtime ไป 6543 แยกจากตัว migration

</details>

<details>
<summary>รูปแบบ URL ต่างกันตรงไหน</summary>

```
Direct        postgresql://postgres:PASSWORD@db.XXXXXXXX.supabase.co:5432/postgres
Session       postgresql://postgres.XXXXXXXX:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
Transaction   postgresql://postgres.XXXXXXXX:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres
```

จุดที่คนพลาดบ่อย:
- **user ของ pooler ใช้ `postgres.XXXXXXXX` (คั่นด้วยจุด)** ไม่ใช่ `postgres`
- **region ต้องตรงกับโปรเจกต์** — `aws-0-ap-southeast-1` ของโปรเจกต์ที่อยู่โซนนั้น
- **password ต้อง URL-encode** ถ้ามี `@ : / # ? &` ให้แทนด้วย `%40` `%3A` ฯลฯ
  (Supabase มีปุ่ม "Reset database password" ถ้าลืม)

</details>

### ⚠️ SlipOK ต้องตั้งค่าก่อนใช้เก็บเงิน

```bash
npm run slipok:check     # ทดสอบ key (endpoint /quota ไม่กินโควต้า)
```

1. **Rotate API key** — ค่าที่เคยส่งผ่านแชทถือว่ารั่วแล้ว ให้สร้างใหม่ที่ SlipOK แล้วใส่ `SLIPOK_API_KEY`
2. **ตั้งเลข PromptPay ใน LINE LIFF ของ SlipOK** — ถ้าไม่ตั้ง ทุกสลีปจะโดน error `1014`
3. **ดูวันหมดอายุแพ็กเกจ** — `npm run slipok:check` รายงาน `package ends` ถ้าเลยวันนั้นระบบชำระเงินจะหยุดทำงานทันที (error `1003`)

### ใช้งานฐานข้อมูล

```bash
npm run db:check         # ทดสอบเชื่อมต่อ + สรุปสถานะ (ไม่แก้ข้อมูล)
npm run db:migrate       # apply migration
npm run db:studio        # เปิด Drizzle Studio ดูข้อมูล
npm run db:test-credit   # ทดสอบ credit engine (18 เคส, rollback ทิ้งเสมอ)
```

## แพ็กเกจเครดิต

| Pack | ราคา | Requests | ต่อครั้ง |
|---|---|---|---|
| Starter | 29 บาท | 35 | 0.829 บาท |
| Standard | 59 บาท | 85 | 0.694 บาท |
| Pro | 99 บาท | 145 | 0.683 บาท |

**ผู้ใช้ใหม่:** เครดิตฟรี 10 ครั้ง · 3 วันแรกได้ 10 requests/วัน · หลังจากนั้น 5 requests/วัน
จนกว่าจะซื้อแพ็ก — **ซื้อครั้งแรกปลดล็อกโควต้าถาวร**

**การนับ 1 request:** 1 ข้อความผู้ใช้ = 1 · regenerate = +1 · เทียบ 4 โมเดล = 4
· tool ที่โมเดลเรียกเองไม่นับ · error ก่อนได้ token → refund อัตโนมัติ · กด Stop → ไม่ refund

## การล็อกอินด้วย username

ผู้ใช้กรอก **ชื่อผู้ใช้ + รหัสผ่าน** ไม่ใช่อีเมล แต่ Supabase Auth เข้าใจแค่อีเมล
ระบบจึงแปลงชื่อผู้ใช้เป็นอีเมลสมมติก่อนส่งให้ Supabase

```
bob       → bob@users.aichat.app      (สมัคร/เข้าสู่ระบบ)
bob       → bob@gmail.com            (ผู้ใช้ Google — เก็บอีเมลจริงไว้)
```

`_` ในชื่อผู้ใช้ถูกแปลงเป็น `-` ในส่วนของอีเมล เพราะตัวตรวจอีเมลของ Supabase
เข้มงวดกว่ามาตรฐาน RFC และอาจปฏิเสธ `_` (ชื่อผู้ใช้ห้ามมี `-` จึงไม่มีการชนกัน)

### ⚠️ ต้องตั้งค่า Supabase — ทำให้ครบก่อนใช้งาน

**1. Authentication → Sign In / Providers → Email → ปิด `Confirm email`**

บัญชีที่สมัครด้วย username มีอีเมลสมมติที่รับเมลไม่ได้จริง ถ้าเปิดยืนยันอีเมลไว้
ระบบจะส่งอีเมลไปที่ไม่มีอยู่ → ได้ `over_email_send_rate_limit` และสมัครไม่ได้

**2. Authentication → Sign In / Providers → Google → เปิดใช้**

กรอก `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` จาก console.cloud.google.com
(APIs & Services → Credentials → OAuth client ID)

> ⚠️ ใน **Google Console** ต้องเพิ่ม Authorized redirect URI เป็น
> `https://<project-ref>.supabase.co/auth/v1/callback`
> **ไม่ใช่** `/auth/callback` ของเว็บเรา — Google ไม่เคยเห็น URL ของเว็บเราเลย
> Supabase เป็นตัวรับ callback ก่อน แล้วค่อยส่งต่อมาที่เรา

**3. Authentication → URL Configuration → เพิ่ม Redirect URL**

```
http://localhost:3000/auth/callback          (ตอนพัฒนา)
https://<โดเมนของคุณ>/auth/callback          (ตอน production)
```

**4. ตั้ง `SYNTHETIC_EMAIL_DOMAIN` เป็นโดเมนที่คุณควบคุมจริง**

Supabase ตรวจ DNS ของโดเมน ถ้าโดเมนไม่มีอยู่จริงอาจได้ `email_address_invalid`
ค่าเริ่มต้น `users.aichat.app` ใช้ตอน dev ได้ แต่ควรเปลี่ยนเป็น
`id.โดเมนของคุณ` เมื่อพร้อม

### ทดสอบระบบล็อกอิน

```bash
npm run db:test-auth     # ทดสอบจริงผ่าน Supabase Auth API
npm run db:test-trigger  # ทดสอบ trigger (7 เคส)
npm run admin:promote -- alice    # ตั้งคนเป็น admin
npm run test:e2e        # ทดสอบผ่านเว็บจริง (ต้องรัน npm start ก่อน)
```

## โครงสร้าง

```
src/
├─ app/
│  ├─ layout.tsx           root layout + theme provider + ฟอนต์ (Geist + Noto Sans Thai)
│  ├─ page.tsx             หน้าแชกหลัก (placeholder รอเฟส 4)
│  ├─ pricing/page.tsx     หน้าราคา + QR PromptPay
│  └─ globals.css          theme tokens (shadcn neutral + dark)
├─ components/
│  ├─ ui/                  16 shadcn components
│  ├─ app-sidebar.tsx      sidebar (แชทใหม่ / เครดิต / ธีม / บัญชี)
│  ├─ theme-provider.tsx
│  └─ theme-toggle.tsx
├─ lib/
│  ├─ db/schema.ts         18 ตาราง
│  ├─ db/index.ts          drizzle client
│  ├─ site-config.ts       แพ็กเกจ + ค่า free tier (fallback ตอนยังไม่ต่อ DB)
│  └─ utils.ts
└─ app/…

drizzle/
├─ 0000_init.sql                       18 ตาราง
└─ 0001_rls_and_credit_functions.sql   RLS + credit engine + seed

scripts/crop-qr.mjs     crop QR จากภาพสกรีนช็อตเป็นสี่เหลี่ยม
QRCode/                 ภาพต้นฉบับ (1080×1709)
public/qr/              QR ที่ crop แล้ว (530×530 PNG)
```

## การจัดการเครดิต (สำคัญ)

การหักเครดิตทำเป็น **SQL function** ไม่ใช่โค้ดแอป เพื่อกัน race condition
(สอง request พร้อมกันทั้งคู่อ่านเครดิตใบสุดท้ายเห็นว่าพอ)

| Function | หน้าที่ |
|---|---|
| `consume_credit()` | ล็อกแถวผู้ใช้ → ตรวจ ban/โควตา/ยอด → หัก 1 → บันทึก usage + ledger |
| `refund_credit()` | คืนเครดิตเมื่อ generation error ก่อนได้ token แรก |
| `complete_usage()` | บันทึก token / latency / ต้นทุนจริงเมื่อสำเร็จ |
| `grant_order_credits()` | ให้เครดิตหลังยืนยันสลีป (idempotent — เรียกซ้ำไม่เพิ่ม) |
| `daily_quota_for()` | คำนวณโควตาต่อวัน (คืน NULL = ไม่จำกัด) |

RLS เปิดทุกตาราง · ผู้ใช้อ่านของตัวเองได้เท่านั้น · เขียน ledger ผ่าน function เท่านั้น
· trigger กันผู้ใช้แก้ `role` / `credits_balance` / `first_paid_at` ของตัวเอง

> ⚠️ การเชื่อมต่อ Drizzle ใช้สิทธิ์เจ้าของตาราง จึง **ข้าม RLS** — โค้ดฝั่ง server
> ต้องกรอง `userId` จาก session เสมอ ห้ามเชื่อค่าที่มาจาก client

### ทดสอบ credit engine

`scripts/test-credit-engine.mjs` เสียบเข้า `auth.users` ปลอม แล้วไล่ตรวจ 18 เคส
(trigger · หักเครดิต · ledger · quota · refund · การซื้อซ้ำซ้อน) ทั้งหมดอยู่ใน
transaction เดียวที่ **rollback เสมอ** — ทดสอบซ้ำได้ไม่ทิ้งข้อมูล

> `sql.begin()` ของ postgres.js **commit** เมื่อ callback จบปกติ ต้อง throw
> ออกมาเพื่อบังคับ rollback (สคริปต์ใช้ sentinel `ROLLBACK` ทำสิ่งนี้)

## QR Code

ภาพต้นฉบับเป็นสกรีนช็อตแนวตั้ง 1080×1709 (มีโลโก้ธนาคาร + ชื่อบัญชี + ยอดเงิน)
`scripts/crop-qr.mjs` จะ**หาขอบเขต QR จากพิกเซลจริง** (ไม่ hardcode) แล้ว crop เป็นสี่เหลี่ยม
พร้อม quiet zone ขาว 6%

```bash
node scripts/crop-qr.mjs
```
