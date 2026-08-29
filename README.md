# CCTV Security Data PTW

ระบบบันทึกและสรุปข้อมูลงานรักษาความปลอดภัยประจำวัน ประกอบด้วยหน้ากรอกข้อมูลสำหรับเจ้าหน้าที่ที่เข้าผ่าน QR Code
โดยไม่ต้องเข้าสู่ระบบ และ Admin Console สำหรับดูแดชบอร์ด จัดการแบบฟอร์ม แก้ไขข้อมูลย้อนหลัง และออกรายงาน PDF

> **สถานะปัจจุบัน:** ใช้งานจริงบน production (Vercel) เชื่อมต่อฐานข้อมูลกลาง Supabase (Postgres + Row Level Security)
> และมีระบบ Authentication สำหรับ Admin Console แล้ว — อ่านหัวข้อ [Known limitations](#known-limitations) ก่อนใช้งาน

## Main features

**หน้ากรอกข้อมูล (User Entry Portal)** — ไม่ต้องล็อกอิน
- 3 แบบฟอร์ม: รถเข้า-ออก (Traffic), รถกอล์ฟ (Golf Fleet), ผู้มาเยือน (Visitors)
- ตรวจความถูกต้องก่อนบันทึก: ช่องบังคับ, ตัวเลขติดลบ, ค่า `OFF` สำหรับรถกอล์ฟที่ไม่ได้ให้บริการ
- ป้องกันการกดส่งซ้ำ และแยก "วันที่ของข้อมูล" ออกจาก "เวลาที่ส่ง"
- เข้าถึงผ่าน QR Code ที่ผู้ดูแลสร้างและยกเลิกได้จากหน้า Settings

**Admin Console**
- แดชบอร์ดแยกตามโมดูล พร้อม KPI และกราฟที่เลือกชนิดได้ (Bar / Line / Area / Donut / Pie)
- เลือกดูรายวันหรือรายเดือน พร้อมประวัติย้อนหลัง 12 เดือน (แสดงผลเป็น พ.ศ.)
- Form & Field Builder: เพิ่ม แก้ไข เรียงลำดับ และปิดใช้งานคำถามได้เอง โดยไม่กระทบข้อมูลเดิม
- แก้ไขและลบข้อมูลย้อนหลัง พร้อมหน้าต่างยืนยันก่อนลบ
- ส่งออกรายงาน PDF เลือกโมดูล ช่วงเวลา เนื้อหา และธีมได้ 7 แบบ

## Tech stack

| ส่วน | ใช้อะไร |
| --- | --- |
| UI | ไฟล์ `.dc.html` (Claude Design artboard) คอมไพล์โดย `support.js` ตอนรันในเบราว์เซอร์ |
| Data layer | `soc-core.js` — แหล่งข้อมูลกลางแหล่งเดียวของทั้งระบบ |
| Storage | Supabase (Postgres) — ตาราง `records`, `form_fields`, `portal_settings` พร้อม Row Level Security |
| Auth | Supabase Auth (email/password) — คุมเฉพาะหน้า Admin Console, หน้ากรอกข้อมูลไม่ต้องล็อกอิน |
| Realtime | Supabase Realtime — ซิงก์ข้อมูลข้ามแท็บ/เครื่องแบบสด แทน `storage` event ของ localStorage เดิม |
| PDF | `html2canvas` + `jsPDF` (อยู่ใน `vendor/`) |
| QR | `qrcodejs` สร้างในเบราว์เซอร์ (อยู่ใน `vendor/`) |
| Fonts | Google Fonts — IBM Plex Sans Thai / IBM Plex Mono (มี fallback ถ้าโหลดไม่ได้) |

ไม่มี build step และไม่มี npm dependency — เป็น static site ล้วน เสิร์ฟไฟล์ตรงได้เลย ค่าเชื่อมต่อ Supabase (URL + anon key)
อยู่ในไฟล์ `soc-config.js` ที่ commit เข้า repo ตรง ๆ (ไม่ใช่ secret — ดูหัวข้อ [Environment variables](#environment-variables))

## Project structure

```
.
├── vercel.json                          # static config + rewrite /admin, /entry
├── .env.example                         # ตัวแปรสำหรับตอนต่อ Supabase
└── Prototype integration complete/
    ├── index.html                       # หน้าเลือก Admin / Entry
    ├── SOC Admin Console v2.dc.html     # Admin Console
    ├── User Entry Portal v2.dc.html     # หน้ากรอกข้อมูล
    ├── soc-core.js                      # data layer (Supabase) + form registry + aggregation
    ├── soc-config.js                    # Supabase URL + anon key (ไม่ใช่ secret)
    ├── support.js                       # runtime ของ .dc.html (generated — ห้ามแก้)
    ├── vendor/                          # html2canvas, jsPDF, qrcode, supabase-js
    └── _legacy/                         # prototype รุ่นแรก ไม่ได้ใช้แล้ว (ไม่ถูก commit)
```

> ชื่อไฟล์ `.dc.html` มีเว้นวรรคเพราะยังแก้ผ่าน Claude Design canvas อยู่ `vercel.json` จึงทำ rewrite
> ให้เข้าผ่าน `/admin` และ `/entry` แทน หากเลิกใช้ canvas แล้วค่อยเปลี่ยนชื่อไฟล์ได้ (มีจุดที่ต้องแก้ตาม 3 จุด
> ดู `portalUrl()` ใน `soc-core.js` และลิงก์ 2 จุดใน Admin Console)

## Development

ต้องเสิร์ฟผ่าน HTTP — เปิดไฟล์ตรง ๆ ด้วย `file://` จะใช้งานไม่ได้

```bash
cd "Prototype integration complete"
python -m http.server 4173
```

แล้วเปิด http://localhost:4173

หรือถ้าใช้ Claude Code จะมี `.claude/launch.json` ตั้งค่าไว้ให้แล้ว

## Build

ไม่มีขั้นตอน build — ไฟล์ที่อยู่ใน repository คือไฟล์ที่ deploy ได้เลย

โปรเจกต์นี้ตั้งใจไม่มี `package.json` เพราะไม่มี dependency ที่ต้องติดตั้งและไม่มีอะไรต้องคอมไพล์
การเพิ่ม `package.json` เปล่าจะทำให้ Vercel เข้าใจว่าเป็นโปรเจกต์ Node แล้วไปมองหา build command ที่ไม่มีอยู่

## Deployment (Vercel)

1. Import repository เข้า Vercel
2. Framework Preset เลือก **Other**
3. ปล่อย Build Command ว่างไว้ — `vercel.json` กำหนด `outputDirectory` ให้แล้ว
4. Deploy

หลัง deploy จะเข้าได้ที่ `/` (หน้าเลือก), `/admin` และ `/entry`

**Production:** https://security-ptw-web.vercel.app (Vercel project ภายใต้ team "Shonsey's projects")

**สร้างบัญชี Admin ครั้งแรก:** Supabase Dashboard ของโปรเจกต์ → Authentication → Users → Add user
(ติ๊ก Auto Confirm User) แล้วใช้อีเมล/รหัสผ่านนั้นล็อกอินที่ `/admin` — ไม่มีทางสร้างบัญชีผ่านหน้าเว็บเอง (ตั้งใจ)

## Environment variables

โปรเจกต์นี้ไม่มี build step จึงไม่มีการ inject ตัวแปรสภาพแวดล้อมตอน build — ค่าเชื่อมต่อ Supabase
(URL + anon key) ฝังตรงในไฟล์ `soc-config.js` ที่ commit เข้า repo แทน `.env.example` ด้านล่างเป็นเอกสารอ้างอิง
สำหรับกรณีย้ายไปสถาปัตยกรรมที่มี build step ในอนาคตเท่านั้น ปัจจุบันไม่มีผลต่อการรันจริง

| ตัวแปร | ใช้ทำอะไร |
| --- | --- |
| `VITE_SUPABASE_URL` | URL ของโปรเจกต์ Supabase |
| `VITE_SUPABASE_ANON_KEY` | anon key ซึ่งออกแบบมาให้เปิดเผยได้ ตัวที่ป้องกันข้อมูลจริงคือ Row Level Security |

ห้ามใส่ `service_role` key ลงในไฟล์ใด ๆ ใน repository นี้

## Supabase schema

ทุกหน้าอ่านและเขียนข้อมูลผ่าน `SOCCore` เท่านั้น (`soc-core.js`) — ไม่มีจุดใดในสองไฟล์ `.dc.html` เรียก
Supabase client ตรง ๆ ทุกฟังก์ชันอ่านข้อมูลยังเป็น synchronous เหมือนเดิม (อ่านจาก in-memory cache ที่โหลด
มาตอนเปิดหน้าและอัปเดตผ่าน Realtime) ส่วนฟังก์ชันเขียนข้อมูลอัปเดต cache ทันทีแล้วค่อยยิง request ไป Supabase
เบื้องหลัง (optimistic write) — ถ้าล้มเหลวจะแจ้งผ่าน toast

ตาราง:

- `records` — `id` (uuid), `module`, `form_id`, `form_version`, `report_date`, `submitted_at`, `updated_at`
  (สองคอลัมน์นี้เป็น `timestamp` ไม่มี timezone โดยตั้งใจ — ดูคอมเมนต์ `nowIso()` ใน `soc-core.js`),
  `submitted_by`, `inspector`, `is_test`, `data jsonb`
- `form_fields` — `module`, `field_id`, `label`, `type`, `required`, `active`, `"order"`, `options jsonb`,
  `placeholder`, `helper`, `"group"`, `unit`, `allow_off`, `allow_custom`, `system`
- `portal_settings` — แถวเดียว (`id = true`) เก็บชื่อ Portal, ข้อความต้อนรับ, slug, สถานะเปิด/ปิด, เวอร์ชัน QR

RLS: guest (anon) `INSERT` ได้อย่างเดียวบน `records`, `SELECT` เฉพาะ `form_fields` ที่ `active = true` และ
`portal_settings` ทั้งแถว ส่วน admin (authenticated) ทำได้ทุกอย่างทุกตาราง ฟังก์ชัน `record_count(module)`
เป็น `SECURITY DEFINER` แบบตั้งใจ — คืนแค่ตัวเลขนับ ไม่คืนข้อมูลจริง ให้หน้ากรอกข้อมูลโชว์ "บันทึกแล้ว N รายการ"
ได้โดยไม่ต้องมีสิทธิ์ `SELECT` บน `records`

## Known limitations

- **KPI และกราฟผูกกับ Field ID ในโค้ด** — คำถามที่เพิ่มใหม่จาก Form Builder จะเก็บข้อมูลและแสดงในตารางได้ แต่ไม่ขึ้นกราฟเองอัตโนมัติ คำถามที่กราฟใช้คำนวณถูกล็อกไว้ (แสดงสัญลักษณ์ 🔒) จึงปิดหรือลบไม่ได้
- **การเลื่อนลำดับคำถามทำได้ภายในกลุ่มเดียวกัน** — เพราะฟอร์มจริงจัดกลุ่มก่อนเรียงลำดับ หากต้องการย้ายข้ามกลุ่มให้แก้ชื่อกลุ่มคำถามแทน
- **หน้ากรอกข้อมูลไม่แจ้งเตือนถ้าบันทึกไม่สำเร็จ** — การส่งฟอร์มเป็นแบบ optimistic (แสดงหน้า "สำเร็จ" ทันทีก่อนรอผลจาก Supabase) ถ้าอินเทอร์เน็ตหลุดตอนนั้นพอดี ข้อมูลจะไม่ถูกบันทึกจริงแต่ผู้กรอกไม่เห็นข้อความเตือน (มี log ไว้ใน console เท่านั้น) — เป็นข้อจำกัดที่รู้อยู่ ยังไม่ได้แก้
