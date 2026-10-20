# PROMPT 2 — Thế giới giả lập (Bước 2/5)

```text
# BỐI CẢNH
./simulator đã xong Bước 1 (domain, G1–G8, engine first-match-wins, cooldown, kho fact bitemporal).
Spec: docs/simulator/spec-v3.1.md. Roadmap và edge case: docs/simulator/00-roadmap-and-edge-cases.md
(đọc mục 3A và 3E).
Bước 2 xây "thế giới" sinh ra dữ liệu và một Amazon API giả có lỗi. VẪN CHƯA viết logic
rule (evaluate trả null) và CHƯA viết orchestrator chạy rule (Bước 5).
Chỉ sửa trong ./simulator. KHÔNG thêm dependency mới, kể cả devDependency.
TDD: viết test trước, rồi cài đặt.

# 1. PRNG TẤT ĐỊNH (src/market/rng.ts)
- Tự cài PRNG có seed (ví dụ mulberry32 hoặc xoshiro128**). Có fork(label) để tạo luồng con
  độc lập: thêm một target mới không được làm đổi số ngẫu nhiên của target khác.
- Helper: uniform, poisson, binomial, categorical, lognormal.
- Cấm Math.random và Date.now trong src/. Mở rộng test/offline.test.ts để chặn Math.random.

# 2. MÔ HÌNH THỊ TRƯỜNG (src/market/model.ts) — hàm thuần, chạy theo từng giờ marketplace
Input mỗi giờ: trạng thái hiển thị của entity (campaign status, dailyBudget, topOfSearchPct,
target status, bid gửi lên = base × hệ số giờ), "sự thật ngầm" của target, giờ marketplace,
chi tiêu đã dùng trong ngày.
Sự thật ngầm của target (khai báo trong scenario): trueCvr, ctr, clearingPrice (median giá thầu
đối thủ), priceSpread, baseImpressionsPerDay, hourlyTrafficCurve[24], topCvrMultiplier,
searchTerms[] { query, weight, cvrMultiplier }.
Quy tắc:
- Tỷ lệ thắng phiên = logistic((bid − clearingPrice) / priceSpread). Impression ~ Poisson(base ×
  curve[h] × winRate × seasonality). Kỳ vọng impression phải đơn điệu không giảm theo bid.
- Click ~ Binomial(impressions, ctr). CPC = bid × U(0.6, 0.95) theo kiểu đấu giá giá thứ hai.
  CPC không bao giờ vượt bid.
- Placement: tỷ lệ traffic TOP tăng theo topOfSearchPct (công thức đơn điệu, có trần). CVR của TOP
  bằng trueCvr × topCvrMultiplier.
- Đơn ~ Binomial(clicks, cvr). Doanh số = đơn × price (có thể có đơn $0 nếu scenario bật
  couponZeroSalesRate). Mỗi đơn có độ trễ attribution lấy từ phân phối của scenario.
- Search term: phân bổ click/đơn của target theo weight và cvrMultiplier.
- Budget cap: duyệt các giờ theo thứ tự trong ngày PT. Khi chi tiêu đạt budget × (1 +
  overspendTolerance, mặc định 0) thì các giờ còn lại có 0 impression và được gắn
  budgetCapped=true. Thêm field này vào MetricFact (optional).
- Campaign hoặc target PAUSED thì 0 traffic.

# 3. ATTRIBUTION & PHÁT HÀNH BÁO CÁO (src/market/reporting.ts)
- Báo cáo ngày D (daily facts theo entity, placement, search term) phát hành lần đầu lúc
  D+1 03:00 PT với các đơn đã "biết". Sau đó phát hành lại (restatement) mỗi ngày đến D+14,
  dùng knownAt tương ứng.
- Mỗi đơn có lagDays lấy từ scenario.attribution.lagDistribution
  (ví dụ {"0":0.6,"1":0.2,"2":0.1,"3":0.05,"5":0.03,"7":0.02}). Đơn được tính vào ngày click D,
  nhưng chỉ xuất hiện ở các version có knownAt ≥ D + lagDays.
- Trả hàng/hủy: tỷ lệ returnRate; đơn bị trừ ở version phát hành sau returnLagDays.
- Hourly stream (Marketing Stream) là nguồn riêng: phát hành ngay sau giờ đó 1h, có
  hourlyNoise (sai lệch % so với daily, mặc định 0) và CÙNG độ trễ attribution. Hourly fact bắt
  buộc có hourBucket UTC (theo Bước 1).
- Mọi fact ghi vào kho bitemporal của Bước 1 qua một FactSink (append-only).
- Bất biến: không fact nào có knownAt trước thời điểm kết thúc ngày/giờ mà nó mô tả.

# 4. SỰ KIỆN THEO THỜI GIAN (src/market/events.ts)
Scenario có thể khai báo timeline sự kiện:
- seasonality { from, to, multiplier } (ví dụ Prime Day ×3 traffic, lag ×2)
- priceChange { asin, at, priceUsd, breakEvenAcos? } (đổi G1 giữa chừng → paramsVersion mới)
- manualEdit { at, entityId, field: bid|budget|status|name, value } (người dùng sửa tay trên console)
- attributionStorm { from, to, lagDistribution } (ghi đè phân phối trễ trong khoảng)
- apiFault (xem mục 5)

# 5. AMAZON API GIẢ CÓ LỖI (src/api/faultyPort.ts)
FaultyFakePort implements AmazonAdsPort, bọc InMemoryFakePort. Lỗi tất định theo seed và
cấu hình apiFault trong scenario:
- rateLimit { probability | windows }: ném RateLimitError { retryAfterSeconds }.
- serverError { probability }: ném TransientServerError.
- partialBatch { probability }: batch update/create trả kết quả TỪNG phần tử
  ({id, ok, error?}); một số phần tử thất bại, phần còn lại đã ghi.
- staleReadMinutes: list* trả giá trị cũ trong N phút sau một lần ghi thành công.
- createSucceedsButInvisible: tạo keyword thành công nhưng list không thấy trong N phút
  (để tái hiện edge case E1 của R15).
- Ghi call log đầy đủ (time, op, idempotencyKey, outcome) để Bước 5 kiểm tra.
- Idempotency của Bước 1 vẫn đúng: retry cùng key sau lỗi transient không được ghi hai lần.
Thay đổi interface AmazonAdsPort để các hàm batch trả về kết quả từng phần tử thay vì void.
Cập nhật InMemoryFakePort và test cũ tương ứng.

# 6. SCENARIO DSL (src/scenario/schema.ts, scenarios/*.json)
- Định dạng JSON. Tự viết validator (không dùng zod), báo lỗi kèm đường dẫn field
  (ví dụ "campaigns[0].targets[2].trueCvr must be in (0,1]").
- Gồm: seed, marketplace, startDate, days, products (G1), campaigns (type, budget, ToS, targets
  với bid ban đầu và sự thật ngầm), attribution, returnRate, hourlyNoise, overspendTolerance,
  events[].
- Tạo sẵn 6 scenario:
  golden-winner.json (spec Phần 10, campaign thắng $30/BE 40%),
  zero-order.json (trueCvr = 0),
  attribution-storm.json (30% đơn trễ 3–7 ngày),
  budget-capped.json (budget hết trước 15h PT),
  dst-fallback.json (chạy qua 2026-11-01),
  api-chaos.json (rateLimit + partialBatch + createSucceedsButInvisible).

# 7. MARKET DRIVER & CLI (src/market/driver.ts, src/cli/sim.ts)
- MarketDriver.step(hourInstant, entityView) → { facts[], spendByCampaign } chạy 1 giờ.
  Đây là điểm nối cho orchestrator ở Bước 5. Driver KHÔNG đọc state rule, chỉ đọc entityView.
- Hiện tại CLI chạy scenario với bid/budget TĨNH (không có rule) và áp dụng manualEdit event:
  npm run sim -- scenarios/golden-winner.json --out out/golden
  → ghi facts.jsonl, port-calls.jsonl, summary.json (tổng thật và tổng "đã biết" theo từng asOf
  D+1, D+2, D+3, D+7, D+14).
- Build bằng tsc (thêm tsconfig.build.json), chạy bằng node trên dist. Không dùng tsx/ts-node.
  Thêm out/ vào .gitignore.

# TIÊU CHÍ NGHIỆM THU
1. Tất định: chạy cùng scenario và seed 2 lần cho hash facts.jsonl giống hệt; đổi seed thì khác.
   Thêm một target vào scenario không làm đổi facts của các target cũ (nhờ rng.fork).
2. Kỳ vọng impression đơn điệu theo bid (test trên hàm kỳ vọng, không dựa vào mẫu ngẫu nhiên).
   CPC ≤ bid ở mọi fact.
3. Budget: chi tiêu ngày ≤ budget × (1 + overspendTolerance). Trong budget-capped.json, các giờ
   sau thời điểm cạn có 0 click và budgetCapped=true.
4. Attribution: lagDistribution {"0":1} → version đầu tiên = version cuối. attribution-storm:
   số đơn thấy được ở asOf D+2 < ở asOf D+14. Tổng đơn ở D+14 = tổng đơn thật − đơn bị trả.
   Không fact nào có knownAt sớm hơn thời điểm kết thúc kỳ.
5. Trả hàng: có version với orders giảm; queryFacts(asOf) của Bước 1 trả đúng version mới nhất ≤ asOf.
6. hourlyNoise = 0 → tổng hourly = daily cho mọi ngày (kể cả ngày DST). Ngày 2026-11-01 có
   25 hourly bucket, ngày 2027-03-14 có 23.
7. Campaign hoặc target PAUSED → 0 traffic. manualEdit được phản ánh từ giờ kế tiếp.
8. FaultyFakePort: mỗi loại lỗi có test riêng. Retry cùng idempotencyKey sau 429 hoặc 5xx
   không ghi hai lần. partialBatch trả kết quả từng phần tử. staleRead và
   createSucceedsButInvisible hết hiệu lực đúng sau N phút.
9. Validator: scenario sai trả lỗi có đường dẫn field. Cả 6 scenario mẫu đều hợp lệ.
10. npm run typecheck, npm test, npm run sim -- scenarios/golden-winner.json --out out/golden
    đều chạy thành công. Test cũ vẫn pass, hoặc được sửa kèm giải thích.
11. README: thêm phần Bước 2 (sơ đồ luồng giờ → fact → kho bitemporal, cách viết scenario, bảng
    tham số sự thật ngầm, giới hạn của mô hình).
Kết thúc: liệt kê file mới/đã sửa, kết quả npm test, output summary.json của golden-winner,
và các chỗ // SPEC-AMBIGUITY: mới.
```
