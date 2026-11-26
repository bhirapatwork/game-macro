# FarmBoard — ติดตามการฟาร์ม Anime Adventures

macro ยิง webhook เมื่อจบแต่ละแมตช์ → เว็บนี้ parse ของที่ได้ แล้วเก็บลง DB → แสดงบน dashboard
(ประวัติการเล่น / ไอเท็มที่ได้รับ / กระเป๋า / ร้านค้า / ความคืบหน้างาน)

ไม่มี dependency เลย ใช้แค่ Node.js 22.13 ขึ้นไป (มี `node:sqlite` ในตัว)

## เริ่มใช้งาน

```bash
ADMIN_KEY=ตั้งรหัสยาวๆ npm start
```

ทดลองด้วยข้อมูลจำลอง (เปิดอีกหน้าต่าง):

```bash
ADMIN_KEY=รหัสเดียวกัน npm run simulate
```

เปิด http://localhost:3000

## สร้างงาน / บัญชี

```bash
curl -X POST http://localhost:3000/api/admin/accounts \
  -H "x-admin-key: $ADMIN_KEY" -H "content-type: application/json" \
  -d '{"roblox_name":"PlayerName","roblox_user_id":123456,"machine":"PC-1:1",
       "job_title":"Summer Hunt 2 วัน","job_type":"hours_won","job_target":48}'
```

จะได้ `dashboard_url` (ส่งให้ลูกค้าดู) และ `webhook_url` (เอาไปใส่ใน macro — **ห้ามเปิดเผย**)

`job_type` มีแบบนี้:
| ค่า | ความหมาย | ตัวอย่าง |
|---|---|---|
| `hours_won` | นับชั่วโมงเฉพาะแมตช์ที่ชนะ | `job_target: 24` |
| `item` | ฟาร์มไอเท็มให้ครบจำนวน | `job_item: "Summer Pearls", job_target: 1000000` |
| `matches` | ชนะให้ครบกี่แมตช์ | `job_target: 50` |
| `none` | ไม่มีเป้า (เปลี่ยน status เป็น `done` เองผ่าน PATCH) | |

เมื่อถึงเป้า status จะเปลี่ยนเป็น `done` ให้อัตโนมัติ
แก้งาน: `PATCH /api/admin/accounts/<id>` เช่น `{"status":"cancelled"}`

## ต่อกับ macro

### แบบที่ 1: macro ที่ส่ง Discord webhook อยู่แล้ว (ไม่ต้องแก้ macro)
เปลี่ยน URL webhook ใน macro จาก
`https://discord.com/api/webhooks/1234/xxxx` → `https://เว็บคุณ/api/webhooks/0/<token>`

ระบบจะอ่าน embed (title / description / fields) เอง แบบ heuristic รองรับรูปแบบ:
- field ชื่อ `Map`, `Mode`, `Difficulty`, `Tier`, `Wave`, `Time`, `Result`, `Rewards`, `Gems`, `Level` ฯลฯ
- หรือเขียนใน description เป็น `Map: Sky Island` แล้วตามด้วย `Rewards:` และรายการของทีละบรรทัด
- รายการของ: `SummerPearls x6,334`, `+6334 Summer Pearls`, `Gems: 1.2k`, `Sky Portal (1)`
- ผลแพ้/ชนะ: ดูจากคำว่า Victory/Win/Clear หรือ Defeat/Lose/Failed

> payload ดิบทุกอันถูกเก็บในตาราง `raw_events` — ถ้า macro ของคุณใช้รูปแบบที่ parse ไม่ออก (`parsed = 0`)
> ให้ดู body ในตารางนั้นแล้วเพิ่ม pattern ใน `src/parser.js` + เพิ่ม test ใน `test/parser.test.js`

ถ้าอยากให้ Discord ยังได้ข้อความด้วย ให้ macro ยิง 2 ที่ หรือเพิ่ม relay ใน `server.js`

### แบบที่ 2: Native JSON (แนะนำ ถ้าคุณเขียน macro เอง แม่นกว่า)
`POST https://เว็บคุณ/api/ingest/<token>`

```jsonc
// จบแมตช์
{ "type": "match_end",
  "player": { "name": "PlayerName", "user_id": 123456, "level": 235, "gems": 92600, "battlepass": 60 },
  "match": { "mode": "Portal", "map": "Sky Island", "difficulty": "Hard", "tier": 8, "wave": 20,
             "duration_sec": 1117, "result": "win", "modifier": "ดาวตก", "portal_owner": "self",
             "team": [{ "name": "Gojo", "level": 110 }] },
  "rewards": [{ "name": "Summer Pearls", "qty": 6334 }, { "name": "Curse Talisman II", "qty": 6 }],
  "inventory": [{ "name": "Summer Pearls", "qty": 5320000 }] }   // ไม่บังคับ: snapshot กระเป๋าทั้งหมด

// เริ่มแมตช์ (ทำให้หน้าเว็บขึ้น "อยู่ในแมตช์")
{ "type": "match_start", "match": { "mode": "Raid", "map": "Spirit World", "wave": 1, "team": [...] } }

// ซื้อของในร้าน
{ "type": "shop_purchase", "purchase": { "shop": "Travelling Merchant", "item": "Star Fruit (Rainbow)",
  "price": 300, "currency": "Gems", "qty": 20, "balance_after": 9400 } }

// สุ่มตู้
{ "type": "summon", "summon": { "banner": "Summer", "count": 10 } }

// heartbeat / อัปเดตกระเป๋า
{ "type": "status", "player": {...}, "inventory": [...] }
```

บัญชีจะขึ้น "กำลังฟาร์ม" ถ้ามี webhook เข้ามาภายใน 15 นาที (ปรับด้วย env `ONLINE_MINUTES`)

## โครงสร้าง

```
src/parser.js    แปลง payload (Discord embed / native) → event มาตรฐาน
src/service.js   บันทึกลง SQLite, คำนวณความคืบหน้า, query สำหรับหน้าเว็บ
src/server.js    HTTP server: webhook, public API, admin API, ไฟล์หน้าเว็บ
src/db.js        schema
public/          หน้าเว็บ (vanilla JS) — ใส่รูปไอเท็มได้ที่ public/items.js
scripts/simulate.js  จำลอง macro ยิงข้อมูล
```

## ENV
| ชื่อ | ค่าเริ่มต้น | |
|---|---|---|
| `PORT` | 3000 | |
| `ADMIN_KEY` | — | ต้องตั้ง ไม่งั้น admin API ใช้ไม่ได้ |
| `DB_PATH` | `data/tracker.db` | |
| `ONLINE_MINUTES` | 15 | |

## Deploy
รันบน VPS ได้เลย (`npm start` + pm2/systemd) แล้ววางหลัง Nginx/Caddy ที่มี HTTPS
หรือ Railway/Fly.io ที่มี persistent volume สำหรับไฟล์ DB

## สิ่งที่ยังไม่มี (ต่อยอดได้)
- หน้า admin UI (ตอนนี้สร้างงานผ่าน API)
- ระบบออเดอร์/ชำระเงิน/อันดับลูกค้า
- Rate limit ต่อ token
- relay ข้อความไป Discord ต่อ
