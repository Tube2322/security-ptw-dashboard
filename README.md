# CCTV Security Data PTW

ระบบบันทึกและสรุปข้อมูลงานรักษาความปลอดภัยประจำวัน ประกอบด้วยหน้ากรอกข้อมูลสำหรับเจ้าหน้าที่ที่เข้าผ่าน QR Code
โดยไม่ต้องเข้าสู่ระบบ และ Admin Console สำหรับดูแดชบอร์ด จัดการแบบฟอร์ม แก้ไขข้อมูลย้อนหลัง และออกรายงาน PDF

> **สถานะปัจจุบัน:** prototype ที่ใช้งานได้เต็มรูปแบบ แต่ยังเก็บข้อมูลใน `localStorage` ของเบราว์เซอร์แต่ละเครื่อง
> และ **ยังไม่มีระบบ Authentication** — อ่านหัวข้อ [Known limitations](#known-limitations) ก่อนนำไปใช้งานจริง

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
| Storage | `localStorage` (คีย์ `soc.core.v2`) |
| PDF | `html2canvas` + `jsPDF` (อยู่ใน `vendor/`) |
| QR | `qrcodejs` สร้างในเบราว์เซอร์ (อยู่ใน `vendor/`) |
| Fonts | Google Fonts — IBM Plex Sans Thai / IBM Plex Mono (มี fallback ถ้าโหลดไม่ได้) |

ไม่มี build step และไม่มี npm dependency — เป็น static site ล้วน เสิร์ฟไฟล์ตรงได้เลย

## Project structure

```
.
├── vercel.json                          # static config + rewrite /admin, /entry
├── .env.example                         # ตัวแปรสำหรับตอนต่อ Supabase
└── Prototype integration complete/
    ├── index.html                       # หน้าเลือก Admin / Entry
    ├── SOC Admin Console v2.dc.html     # Admin Console
    ├── User Entry Portal v2.dc.html     # หน้ากรอกข้อมูล
    ├── soc-core.js                      # data layer + form registry + aggregation
    ├── support.js                       # runtime ของ .dc.html (generated — ห้ามแก้)
    ├── vendor/                          # html2canvas, jsPDF, qrcode
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

**ก่อนเปิดใช้งานจริง:** เข้า Admin Console → ตั้งค่า → กด "ลบข้อมูลตัวอย่าง" เพื่อล้างข้อมูลจำลอง 30 รายการที่ระบบสร้างไว้ตอนเปิดครั้งแรก

## Environment variables

ยังไม่ได้ใช้ในเวอร์ชันปัจจุบัน — เตรียมไว้สำหรับตอนต่อ Supabase (ดู `.env.example`)

| ตัวแปร | ใช้ทำอะไร |
| --- | --- |
| `VITE_SUPABASE_URL` | URL ของโปรเจกต์ Supabase |
| `VITE_SUPABASE_ANON_KEY` | anon key ซึ่งออกแบบมาให้เปิดเผยได้ ตัวที่ป้องกันข้อมูลจริงคือ Row Level Security |

ห้ามใส่ `service_role` key ลงในไฟล์ใด ๆ ใน repository นี้

## Supabase migration (planned)

ทุกหน้าอ่านและเขียนข้อมูลผ่าน `SOCCore` เท่านั้น ไม่มีจุดใดเรียก `localStorage` โดยตรงนอก `soc-core.js`
การย้ายไป Supabase จึงเป็นการเปลี่ยนไส้ในของไฟล์เดียว โดยเปลี่ยนฟังก์ชันจาก synchronous เป็น Promise
แล้วให้หน้าจอรอผลผ่าน `subscribe()` ที่มีอยู่แล้ว

โครงตารางที่วางไว้:

- `records` — `id`, `module`, `form_id`, `form_version`, `report_date`, `submitted_at`, `updated_at`, `submitted_by`, `inspector`, `data jsonb`
- `form_fields` — `module`, `field_id`, `label`, `type`, `required`, `active`, `order`, `options jsonb`, `group`, `system`
- `portal_settings` — แถวเดียว เก็บชื่อ Portal, slug, สถานะเปิด/ปิด และเวอร์ชัน QR

## Known limitations

- **ยังไม่มี Authentication** — ใครเปิดลิงก์ Admin Console ก็เข้าถึงข้อมูลทั้งหมด แก้ไข ลบ และรีเซ็ตระบบได้ ต้องเพิ่ม Supabase Auth + Row Level Security ก่อนใช้งานจริง
- **ข้อมูลอยู่ในเครื่องผู้ใช้** — `localStorage` ไม่แชร์ข้ามเครื่องและข้ามเบราว์เซอร์ ล้างข้อมูลเบราว์เซอร์แล้วข้อมูลหาย
- **KPI และกราฟผูกกับ Field ID ในโค้ด** — คำถามที่เพิ่มใหม่จาก Form Builder จะเก็บข้อมูลและแสดงในตารางได้ แต่ไม่ขึ้นกราฟเองอัตโนมัติ คำถามที่กราฟใช้คำนวณถูกล็อกไว้ (แสดงสัญลักษณ์ 🔒) จึงปิดหรือลบไม่ได้
- **การเลื่อนลำดับคำถามทำได้ภายในกลุ่มเดียวกัน** — เพราะฟอร์มจริงจัดกลุ่มก่อนเรียงลำดับ หากต้องการย้ายข้ามกลุ่มให้แก้ชื่อกลุ่มคำถามแทน
