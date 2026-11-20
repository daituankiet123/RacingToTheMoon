# 📋 KẾ HOẠCH NÂNG CẤP — Nitro Drift World

> Tài liệu kế hoạch cho giai đoạn tiếp theo, commit kèm cấu trúc thư mục đã được sắp xếp lại
> (`src/game`, `src/net`, `src/components`, `src/hooks`, `public/assets`).

---

## 1. Mục tiêu

| # | Mục tiêu | Tiêu chí hoàn thành |
|---|----------|---------------------|
| G1 | **Visual model đặc trưng thành phố** — cảnh vật & con người mang đúng nét văn hóa từng map | Mỗi city có bộ landmark + NPC/mẫu người riêng, nhận ra được ngay khi vào map |
| G2 | **Đường đua dài hơn** — từ ~1 km hiện tại lên **≥ 3.5 km/lap** | Chu vi track (đo bằng spline) ≥ 3500 m cho cả 10 thành phố |
| G3 | **Thời gian đua tối thiểu 15 phút** | Race mặc định đạt ~15 phút (lap time thực tế ~2:30–3:00 × số vòng, hoặc chế độ Time Trial đếm 15:00) |
| G4 | **Chướng ngại vật ngẫu nhiên** | Hệ thống obstacle spawn theo seed/random, có tương tác vật lý (chậm xe / né / mất tốc), đa dạng theo chủ đề thành phố |
| G5 | **Pipeline Blender → GLB tối ưu** | Model dựng bằng Blender (headless Python scripting), export GLB qua `gltf-transform` optimize (Draco/KTX2), load động trong game |

---

## 2. Hiện trạng (đã khảo sát)

- **Track**: `physics.ts` dùng Catmull-Rom khép kín từ `waypoints` trong `cities.ts`; mỗi city chỉ có ~8–12 waypoints, bán kính nhỏ ⇒ chu vi ~900–1100 m. Lap timekart top-speed ~64 m/s ≈ 35–45 s ⇒ race 3 vòng chỉ ~2 phút. ❌ chưa đạt G2/G3.
- **Landmark**: `models.ts` (~3.2k dòng) dựng procedural theo `landmarkType` (tower/dome/pyramid…); hình khối còn đơn giản, chưa có chi tiết kiến trúc đặc trưng; **NPC/con người** mới chỉ có driver trên kart, không có crowd ven đường. ❌ chưa đạt G1.
- **Obstacles**: chỉ có boost pads; **chưa tồn tại** hệ thống chướng ngại vật. ❌ chưa đạt G4.
- **Asset pipeline**: Garage đã hỗ trợ nạp `.glb/.gltf` (GLTFLoader có sẵn) ⇒ nền tảng tốt để nhận model Blender xuất ra. ✅
- **Blender**: bản 4.2 LTS đã cài đặt; có thể chạy headless `blender -b -P script.py` để dựng & export hàng loạt.

---

## 3. Thiết kế chi tiết

### 3.1. G1 — Model cảnh vật & con người đặc trưng từng thành phố

**A. Landmark chủ đạo (mỗi city 1 icon chính + 2–3 phụ):**

| Thành phố | Icon chính | Công trình phụ | Crowd / NPC đặc trưng |
|-----------|-----------|----------------|----------------------|
| Tokyo | Tháp Tokyo + cổng Torii đỏ | Skytree, biển neon Kanji, máy bán hàng tự động | Salaryman vest, nữ sinh thủy thủ服, cosplayer |
| Paris | Eiffel Tower (giàn thép lattice) | Arc de Triomphe, quán café mái dù | Người dạo phố mũ beret, nghệ sĩ vẽ tranh |
| London | Big Ben + cầu tháp | Bưu điện đỏ, cabin phone booth, đồng hồ double-decker | Quý ông mũ cao cà vạt, guard mũ gấu đen |
| New York | Statue of Liberty + Empire State | Taxi vàng, biển quảng cáo Times Square | Doanh nhân, skater, du khách camera |
| Hà Nội | Khuê Văn Các + cầu Long Biên | Nhà ống phố cổ mái ngói, đèn lồng Hội An, xích lô | Áo dài, nón lá, cụ ông cờ vỉa hè |
| Dubai | Burj Khalifa | Buồm Arab (Burj Al Arab form), sa mạc + lạc đà | Abaya/kandura, xe địa cát |
| Sydney | Opera House (vỏ sò) | Harbour Bridge, bãi surf | Surfer board, áo泳 ngắn tay hoa |
| Cairo | Kim tự thức Giza + Sphinx | Đền cột Karnak, chợ lều vải | Galabeya, lạc đà thồ hàng |
| Rio | Chúa cứu thế Cristo | Sugarloaf, lễ hội samba feather | Vũ công samba, bóng chuyền bãi biển |
| Rome | Đấu trường Colosseum (vòm vỡ) | Đài phun nước, cột La Mã | toga, đấu sĩ gladiator mini |

**B. Kỹ thuật dựng:**
- Dựng bằng **Blender headless** (`blender -b -P tools/blender/build_landmarks.py`) — script tham số hóa theo `cityId`, mỗi family một hàm `build_<type>()`, đặt origin tâm đáy, scale chuẩn 1 unit = 1 m.
- Export **GLB** qua pipeline: `apply modifiers` → `gltf-transform optimize --compress draco --texture-compress ktx2` → đặt tại `public/models/<city>/<name>.glb`.
- Trong game: `models.ts` thêm `loadCityProps(cityId)` dùng `GLTFLoader` + `DRACOLoader` + `KTX2Loader`; fallback về procedural hiện có nếu file chưa tải kịp (giữ offline-first).
- **Crowd/NPC**: instancing (`InstancedMesh`) các humanoid low-poly (≤600 tris) dọc vỉa hè, đứng sau guardrail; animation dao động nhẹ bằng shader offset (không cần skeleton) + vài mẫu "đi bộ" bằng vị trí loop. Mỗi city chọn palette trang phục theo bảng trên.
- Nâng cấp chất liệu: texture facade/cột/trần theo bộ `textures.ts` hiện có, thêm atlas per-city (neon Kanji, đá vôi Rome, cát Dubai…).

### 3.2. G2 — Mở rộng đường đua ≥ 3.5 km

- Tăng waypoints mỗi city từ ~10 → **~28–36 điểm**, bố trí theo "loop tham quan": rời trung tâm → vòng qua landmark → khu ngoại ô → quay về. Lưu trong `cities.ts` (field `waypoints` mở rộng + field mới `poi[]` vị trí đặt prop).
- Thêm loại đoạn đường mới trong spline builder: `hairpin`, `esses`, `long back-straight`, `banked corner` — bằng cách phân bố khoảng cách waypoint (thẳng dài vs cluster gắt).
- Tự động kiểm chứng bằng test: `physics.test.ts` thêm assert `trackLength(city) >= 3500` cho cả 10 map.
- Chỉnh `roadWidth` và tường chắn/barrier mesh跟上 chiều dài mới; minimap HUD scale động theo bounding box track.

### 3.3. G3 — Thời gian đua tối thiểu 15 phút

- **Lap time kỳ vọng**: 3.5 km @ tốc độ trung bình ~50 m/s ≈ **70–85 s/vòng**.
- Chế độ mặc định mới: **`laps: 12`** (≈ 14–17 phút solo; AI grid 6 xe cạnh tranh sát nút).
- Thêm **Race Director** (`raceDirector.ts`):
  - Nếu sau 12 lap < 13 phút → ép thêm sự kiện (obstacle wave, safety car) kéo dài;
  - Nếu > 17 phút → giảm số lap động.
  - Multiplayer: server broadcast `targetLaps` thống nhất trong phòng.
- Tùy chọn trong garage/menu: Sprint (5 lap ≈ 7'), Chuẩn (12 lap ≈ 15'+), Endurance (20 lap). Mặc định = Chuẩn.

### 3.4. G4 — Chướng ngại vật ngẫu nhiên

Module mới **`src/game/obstacles.ts`**:

- **Loại obstacle (theo chủ đề city)**:
  - Chung: cone giao thông, vũng dầu (trượt), rào chắn giảm tốc, mảnh vỡ.
  - Tokyo: thùng hàng izakaya ven đường; Paris: xe delivery dừng; London: taxi vượt; HN: xích lô + ổ gà; Dubai: lạc đoàn băng ngang (di chuyển chậm cắt đường); Rio: pháo giấy/confetti đống; Cairo: đụn cát drift phủ mặt đường (giảm grip vùng); Rome: bia đá đổ; NY: nắp cống bật; Sydney: ván lướt rơi.
- **Spawn logic**: seeded RNG (`mulberry32(seed)` — seed từ room id hoặc Date), spawn phía trước người chơi 150–400 m, mật độ tăng dần theo lap (wave system), không spawn trong 2 s sau each other cùng lane; guarantee ít nhất 1 lane trống.
- **Tương tác**: AABB/circle-vs-kart trong `physics.step` — va chạm cone: giảm tốc 15%, rung camera; vũng dầu/ổ gà/cát: µ giảm 60% trong 1.2 s; rào: bắt buộc phanh (chạm = mất 40% tốc + stun 0.5 s). Phá được obstacle bằng nitro full-boost (hiệu ứng mảnh vụn).
- **Render**: InstancedMesh theo loại + pool reuse; avoidance hint cho AI (`aiInput` trừu tượng hóa "blocked lane" penalty).
- HUD: cảnh báo "⚠ Obstacle ahead" 1.5 s trước khi tới (mũi tên minimap).

### 3.5. G5 — Pipeline Blender → In-game

```
tools/blender/build_landmarks.py   (headless, tham số cityId/type)
        │  blender -b -P ... -- --out public/models/raw
        ▼
tools/export/optimize.sh           (npm i -D @gltf-transform/cli)
        │  gltf-transform optimize in.glb out.glb --compress draco --texture-compress ktx2
        ▼
public/models/<city>/*.glb  →  models.ts loadCityProps()  (fallback procedural)
```
- Budget hiệu năng: landmark ≤ 5k tris, NPC ≤ 600 tris, tổng props/map ≤ 150k tris, texture 1024 atlas KTX2.
- Script npm: `npm run assets:build` (gọi Blender + gltf-transform), tích hợp CI tùy chọn.

---

## 4. Kiến trúc file sau nâng cấp

```
src/
├── game/
│   ├── cities.ts          # waypoints mở rộng (28–36/city), poi[], theme
│   ├── physics.ts         # trackLength ≥3500m, obstacle collision hooks
│   ├── obstacles.ts       # ★ MỚI — spawn/interact/render chướng ngại
│   ├── raceDirector.ts    # ★ MỚI — điều chỉnh lap/event giữ race ≥15'
│   ├── crowd.ts           # ★ MỚI — InstancedMesh NPC theo city
│   ├── models.ts          # + loadCityProps(GLB) / fallback procedural
│   ├── engine.ts          # tích hợp obstacles/crowd/poi placement
│   └── textures.ts        # + per-city material atlas
├── net/  components/  hooks/  (giữ nguyên)
tools/
├── blender/build_landmarks.py   # ★ MỚI
└── export/optimize.sh           # ★ MỚI
public/models/<city>/*.glb       # ★ MỚI (Draco+KTX2)
```

---

## 5. Tiến độ thực hiện (checklist)

- [x] Khảo sát hiện trạng, cài Blender 4.2 LTS
- [ ] **Sprint 1**: Mở rộng waypoints 10 city + test chu vi ≥3.5km (G2)
- [ ] **Sprint 1**: `raceDirector.ts` + laps mặc định 12 + menu chế độ đua (G3)
- [ ] **Sprint 2**: `obstacles.ts` — spawn + vật lý + render + AI avoidance (G4)
- [ ] **Sprint 3**: Blender scripts landmark 10 city → GLB pipeline (G1, G5)
- [ ] **Sprint 3**: `crowd.ts` NPC đặc trưng + hookup `loadCityProps` (G1)
- [ ] **Sprint 4**: Cân bằng thời gian đua thực đo (bot laps), perf profile (draw call/fps), cập nhật multiplayer sync obstacle state (seed-based, chỉ gửi seed + lap)
- [ ] **Nghiệm thu**: `npm test` pass toàn bộ incl. track-length asserts; race thử nghiệm ≥15'; screenshots 10 city

## 6. Rủi ro & phương án dự phòng

| Rủi ro | Xử lý |
|---|---|
| GLB dung lượng lớn ảnh hưởng PWA offline | Draco + KTX2 + lazy-load theo city, cache giới hạn 2 city gần nhất |
| Máy không có GPU/Blender crash headless | Fallback: vẫn giữ path procedural hiện tại làm source-of-truth, GLB là enhancement |
| Race >15' gây nhàm | Race Director chèn event variation (weather đổi giữa race, obstacle wave) thay vì chỉ tăng lap |
| Multiplayer desync obstacle | Chỉ đồng bộ `seed` + `lapIndex`, client mô phỏng deterministic |
