# Security Data PTW — คู่มือสำหรับ AI ที่มาช่วยงาน

ระบบบันทึกข้อมูลงานรักษาความปลอดภัย: หน้ากรอก (ไม่ต้องล็อกอิน) + Admin Console อ่าน README.md สำหรับภาพรวม ไฟล์นี้คือกติกาและกับดักที่ต้องรู้ก่อนแก้

## รันและดู
- Dev server: `.claude/launch.json` ชื่อ `soc-prototype` (python http.server เสิร์ฟ `Prototype integration complete/`) เปิด `/SOC%20Admin%20Console%20v2.dc.html` หรือ `/User%20Entry%20Portal%20v2.dc.html`
- Production: https://security-ptw-dashboard.vercel.app (`/admin`, `/entry`) Vercel team "Shonsey's projects" deploy อัตโนมัติจาก `main`
- ไม่มี build step ไฟล์ใน repo คือไฟล์ที่ deploy

## ทดสอบ
- `npm test` (node:test + playwright-core + Chrome ที่ติดตั้งในเครื่อง) ไฟล์ `tests/smoke.test.js` ไม่เขียนฐานข้อมูลจริง (ดักคำขอเขียนทั้งหมด)
- GitHub Actions `test.yml` รันเองทุก push ไป v2/main **ต้องผ่านก่อนขึ้น main**
- ครอบคลุม: หน้า Admin/หน้ากรอกโหลดไม่พัง, คิวส่งซ้ำเมื่อเน็ตหลุด, แบ่งหน้าเกิน 1,000 แถว, ผู้ไม่ล็อกอินอ่านข้อมูลไม่ได้ · แก้ส่วนไหนสำคัญ ให้เพิ่มทดสอบส่วนนั้น

## Branch และการ deploy
- ทำงานบน `v2` เสมอ push v2 ได้ แต่ **merge เข้า `main` (= ขึ้นเว็บจริง) เฉพาะเมื่อผู้ใช้สั่ง "ขึ้น main"** ทุกครั้ง
- merge: `git checkout main && git pull && git merge --no-edit v2 && git push origin main && git checkout v2`
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## ไฟล์หลัก
- `Prototype integration complete/SOC Admin Console v2.dc.html` — Admin ทั้งหน้า (~8,500 บรรทัด, LF) logic class อยู่ท้ายไฟล์ ค่าที่ใช้ใน markup `{{ }}` ต้องคืนจาก `renderVals()`
- `User Entry Portal v2.dc.html` — หน้ากรอก
- `soc-core.js` — data layer เดียวของระบบ (Supabase, cache, realtime, คิวส่งซ้ำ) หน้าเว็บไม่เรียก Supabase ตรง
- `support.js` — runtime ของ .dc.html (generated ห้ามแก้)
- `vendor/` — exceljs, jspdf, html2canvas, qrcode, supabase-js, echarts 5.5.1
- `api/` — Vercel functions (ส่ง MS Forms แบบ headless, ใบแจ้งซ่อม) · `scripts/` — งาน GitHub Actions · `supabase/*.sql` — SQL ที่รันแล้ว (อ้างอิง)

## กติกาที่ต้องทำทุกครั้ง
- **แก้ `soc-core.js` ต้องเปลี่ยนเลขเวอร์ชัน** `soc-core.js?v=YYYYMMDDx` ในทั้งสองไฟล์ .dc.html ไม่งั้นเบราว์เซอร์ใช้ไฟล์เก่าในแคช
- **อ่านตาราง `records` แบบไม่จำกัดช่วงวัน ต้องแบ่งหน้าด้วย `.range()`** (ใช้ `selectAllRows`) PostgREST คืนสูงสุด 1,000 แถว/คำขอ เคยทำให้ข้อมูลหลัง 13 พ.ย. 2026 หายจากหน้าเว็บ
- **โควต้า Supabase (egress นับรวมทั้ง org):** ห้ามโพลตามเวลา ห้ามดึงทั้งตารางเมื่อมีการเปลี่ยน ใช้แถวจาก realtime payload (`applyRecordChange`) แท็บที่ซ่อนไม่ดึง ปกติใช้ ~7,500 คำขอ/วัน แถบเตือนขึ้นเมื่อเกิน 20,000
- ข้อความ UI เป็นภาษาไทย ใช้ได้บนมือถือ (375px)

## กับดักที่เจอแล้ว
- เขียนโค้ดผ่าน Python heredoc: `'\\n'` ใน string ถูกแปลงเป็นขึ้นบรรทัดจริง ทำให้ JS พัง ("logic class eval FAILED") ใช้ `String.fromCharCode(10)` หรือแก้ด้วย Edit แทน
- หลังแก้ ให้เช็ค console หา `[dc-runtime] logic class eval FAILED` ถ้ามี = syntax error ทั้งหน้าใช้ไม่ได้
- error `<circle> attribute cy: Expected length, "{{ p.cy }}"` ใน console เป็นของเดิมจาก runtime ไม่กระทบการใช้งาน
- หาตัว logic ในหน้าเพื่อทดสอบ: เดิน React fiber หา object ที่มี `.core` / `.go` (ดูตัวอย่างใน git log / เซสชันเก่า)

## Supabase
- โปรเจกต์ "Security Data PTW" (`mxlrxivnwtxtiloifksr`) เครื่องมือ Supabase MCP เข้าโปรเจกต์นี้ไม่ได้ รัน SQL ผ่าน Dashboard SQL Editor ในเบราว์เซอร์ (ผู้ใช้ต้องล็อกอิน account เจ้าของ)
- ตารางเสริม: `submit_failures` (บันทึกส่งล้มเหลว), `usage_snapshots` + cron `usage-snapshot`, ฟังก์ชัน `usage_status()`, `entry_existing()`, `is_admin()`, `record_count()`
- เปลี่ยน schema / ลบข้อมูลจริง ต้องถามผู้ใช้ก่อน

## การป้องกันข้อมูลหาย (มีแล้ว)
- ส่งไม่สำเร็จ: เก็บใน localStorage `soc_pending_records` ส่งซ้ำเองด้วย upsert (ไม่ซ้ำ) + บันทึก `submit_failures` ดูได้ที่หน้าตั้งค่า
- เตือนก่อนส่งวันที่ซ้ำ (traffic / traffic_tt / golf) · แถบ "ข้อมูลขาด" หน้าภาพรวม
- Backup: `.github/workflows/db-backup.yml` ทุกวันอาทิตย์ 03:30 เข้ารหัสด้วย secret `BACKUP_PASSPHRASE` (รหัสอยู่ใน `.backup-passphrase.txt` ในเครื่อง ไม่ขึ้น git) เก็บ 90 วัน

## ข้อมูลที่ควรรู้
- ข้อมูลวันที่ 10, 15, 16 พ.ย. 2026 (traffic/traffic_tt/golf) และกอล์ฟ 18 พ.ย. เป็นค่าประมาณจากวันใกล้เคียง ผู้ใช้จะแก้ด้วยข้อมูลจริงเอง
- หมวด `elevator` เลิกใช้แล้วแต่ยังมีข้อมูลเก่าในฐานข้อมูล ผู้ใช้สั่งให้ปล่อยไว้
- repo เป็น public ห้ามใส่ service_role key หรือข้อมูลส่วนบุคคลใน repo
