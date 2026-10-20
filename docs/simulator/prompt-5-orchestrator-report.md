# PROMPT 5 — Orchestrator, Edge-case suite, Monte Carlo, Báo cáo (Bước 5/5)

```text
# BỐI CẢNH
./simulator đã có đủ R01–R21B (Bước 1–4), runAccountLoop (src/runner/accountLoop.ts),
FaultyFakePort, market model, audit gọn.
Spec: docs/simulator/spec-v3.1.md. Edge case: docs/simulator/00-roadmap-and-edge-cases.md (mục 3).
Phát hiện đã có: simulator/README.md (các mục "phát hiện" Bước 3–4), simulator/docs/step-4-status.md.
Bước 5 là bước cuối:
(1) làm orchestrator chịu được lỗi API, sửa tay (drift) và crash;
(2) bộ scenario edge case tự động;
(3) Monte Carlo nhiều seed;
(4) báo cáo.
Chỉ sửa trong ./simulator. Không thêm dependency (node:worker_threads, node:fs được phép).
TDD. Project lead đã duyệt phạm vi này: triển khai trực tiếp, KHÔNG dừng ở cổng duyệt kế hoạch.
Không chỉnh rule để làm test pass. Rule chỉ được sửa khi có bug thật, và phải kèm regression test.
Mọi lựa chọn mơ hồ: thêm flag ambiguity và // SPEC-AMBIGUITY:.

# 1. EXECUTOR CHỊU LỖI (src/runner/executor.ts, tách khỏi accountLoop.apply)
Hiện tại: apply() gọi retry() và nếu lỗi vẫn còn sau retry thì exception thoát ra làm crash cả run.
Decision có nhiều lệnh API có thể ghi được một phần rồi mới lỗi. retryAfter bị bỏ qua.
Yêu cầu:
- Mỗi decision tạo một WritePlan gồm danh sách thao tác có thứ tự. Mỗi thao tác gắn với một
  entity: updateCampaign (gồm name/tag + budget + status, coi là nguyên tử), updatePlacement,
  updateTargets từng target, createKeywords, createNegatives.
- Retry: tối đa config.api.maxAttempts (mặc định 4) cho 429/5xx. Với 429, cộng retryAfterSeconds
  vào bộ đếm "thời gian chờ mô phỏng" (không đổi clock). partialBatch thì chỉ retry phần tử lỗi,
  dùng cùng idempotencyKey. Lỗi không phải transient thì không retry.
- Commit theo entity: chỉ những entity có thao tác được ack mới được commit vào EngineState.
  Entity lỗi giữ nguyên giá trị trước. Cooldown/window/flag của entity lỗi KHÔNG được stamp.
  Audit outcome 'PARTIAL_APPLY' (hoặc 'APPLY_FAILED' nếu không entity nào ack), notify
  API_WRITE_FAILED.
- Bất biến campaign và target vẫn phải đúng sau commit một phần. Ví dụ: tag trên name và
  memory.tag chỉ đổi cùng nhau khi updateCampaign ack.
- Không lỗi API nào được làm crash vòng lặp. Lỗi lập trình (invariant, TypeError) vẫn throw.
- Hourly R21B: batch lỗi thì target lỗi giữ bid đã gửi trước đó (sent map), và thử lại ở ranh giới
  kế tiếp.

# 2. ĐỐI SOÁT DRIFT (src/runner/reconcile.ts)
- Thêm thao tác đọc vào AmazonAdsPort và FaultyFakePort: getCampaigns(ids), listTargets(campaignId).
  Các thao tác này cũng chịu staleRead.
- Mỗi daily run, TRƯỚC khi chạy rule: đọc trạng thái Amazon và so với engine (budget, status,
  name/tag, ToS, bid đã gửi, status target).
  Chính sách ambiguity.driftPolicy = 'trust-amazon' (mặc định) | 'trust-engine':
  + trust-amazon: nhận giá trị Amazon vào engine.
    - Bid: base = bid Amazon / hệ số giờ hiện tại; anchor giữ nguyên.
    - Campaign đang PAUSED_AUTO mà Amazon báo ENABLED: coi là user xác nhận, gọi R01 (giữ đúng
      hành vi Bước 3).
    - Notify DRIFT_DETECTED kèm danh sách field. Window/cooldown KHÔNG reset vì drift.
  + trust-engine: ghi đè lại Amazon bằng giá trị engine, notify.
- Drift do ghi lỗi ở run trước cũng đi qua cơ chế này.
- Thay thế đường manualEdit đặc biệt hiện có (giả lập R10 trong accountLoop) bằng
  reconcile + manualEdit tác động lên InMemoryFakePort (đúng như user sửa trên console).
  Scenario manualEdit vẫn hoạt động.

# 3. CRASH VÀ CHẠY LẠI (E2)
- Tách runDaily(input) → output thuần về dữ liệu: nhận EngineState trước run, port, clock, facts;
  trả EngineState sau run. accountLoop gọi runDaily.
- CrashingPort wrapper: ném CrashError sau N lần ghi thành công.
- Test: với mỗi N ∈ {1, 2, 5, nửa số lần ghi, số lần ghi − 1} của một daily run có nhiều decision:
  crash → chạy lại runDaily từ snapshot EngineState trước run với CÙNG port (đã giữ các ghi trước
  crash) → EngineState và trạng thái Amazon giống hệt run không crash. Không thao tác nào được áp
  dụng hai lần (kiểm tra bằng idempotency log: R12 ×0.8 chỉ một lần).
  Nếu cần, runId phải tất định từ (ngày, giờ chạy) để key giống nhau khi chạy lại.

# 4. BỘ SCENARIO EDGE CASE (scenarios/edge/*.json, test/edge-suite.test.ts)
Mỗi case có loại:
- INVARIANT: phải đúng; test fail nếu sai.
- MEASURE: đo và ghi số liệu; test chỉ kiểm tra chạy được và số liệu nằm trong file kết quả.
Mỗi case ghi kết quả vào out/edge/<id>.json.
A1 (MEASURE) bão attribution: 30% đơn trễ 3–7 ngày + Prime Day lag ×2. Đo số pause/negative
   "sớm" (định nghĩa ở mục 5).
A2 (INVARIANT) đơn bị trả làm đơn biến mất: mọi quyết định ghi đúng paramsVersion và asOf;
   không đọc dữ liệu tương lai.
A3 (INVARIANT) DST 2026-11-01 và 2027-03-14: tổng hourly = daily; R21B mỗi instant ≤ 1 lệnh.
A4 (INVARIANT) runner đặt ở Asia/Ho_Chi_Minh: kết quả giống hệt khi đặt ở PT
   (giờ marketplace là nguồn sự thật).
A5 (MEASURE) budget cạn sớm: đếm số giờ thiếu dữ liệu. R20 có giảm bid giờ thiếu dữ liệu không.
A6 (MEASURE) hourlyNoise 10%: độ lệch hourly so với daily, ảnh hưởng tới R20/R21.
B1 (MEASURE) R05 so với R08 theo pha lịch: 3 pha, ghi ALERT/R06/ngày/preTagTier (đã có ở Bước 3,
   chuyển vào suite).
B2 (MEASURE) window bị reset liên tục khiến R07/R06 không chạy: chi tiêu 0 đơn tích lũy theo lịch
   so với Spend_zero tại thời điểm R06 (hoặc tới cuối nếu không có R06).
B3, B6 (INVARIANT) đã có: chuyển vào suite.
B4 (INVARIANT) mỗi target ≤ 1 lần ghi base/run, |Δ| ≤ 20%.
B5 (INVARIANT) target có cờ lãng phí không bao giờ bị tăng bid.
C1 (INVARIANT + MEASURE) bid gửi lên ≥ $0.20 mọi giờ; đo mức giảm tích lũy so với anchor.
C2 (MEASURE) target đứng im > 30 ngày (vòng xoáy chết): đếm và liệt kê.
C3 (INVARIANT) 5 chu kỳ MANAGE ↔ NORMAL: sai số khôi phục bid ≤ $0.01.
C4, C5, D3 (INVARIANT) đã có: chuyển vào suite.
D1 (MEASURE) dao động khi ít đơn: số lần đảo chiều budget và bid mỗi 30 ngày.
D2 (MEASURE) baseline chụp lúc gặp may: số lần R07 gắn tag mà 14 ngày sau ACoS thật < T_win.
E1 (INVARIANT) R15 không atomic dưới api-chaos.
E2 (INVARIANT) crash/chạy lại (mục 3).
E3 (INVARIANT) staleRead: engine không áp lại thay đổi vì đọc thấy giá trị cũ.
E4 (INVARIANT) sửa tay trên console: drift được phát hiện; PAUSED_AUTO không tự bật lại.
E5 (INVARIANT) không tag kép, không keyword/negative trùng.
E6 (MEASURE) harvest làm campaign nguồn mất đơn: đơn và spend của nguồn trước và sau harvest;
   có R06 không.
Thêm 1 scenario tổng hợp scenarios/edge/chaos-account.json: full-account + rateLimit 10% +
serverError 5% + partialBatch 10% + staleRead 30 phút + 2 manualEdit + 1 priceChange. Chạy 60 ngày,
không crash, mọi INVARIANT đúng.

# 5. MONTE CARLO (src/montecarlo/*.ts, CLI)
npm run mc -- <scenario.json> --seeds 100 --workers auto --out out/mc/<name>
- Mỗi seed chạy runAccountLoop với audit.level='matched'. Chạy song song bằng worker_threads.
  Kết quả tất định theo seed, không phụ thuộc số worker.
- Chỉ số mỗi run:
  + premature: với mỗi decision R06/R13/R12/R16/R17/R05B/R08, đánh giá lại ĐÚNG điều kiện của rule
    trên CÙNG cửa sổ nhưng với asOf = cuối mô phỏng + 15 ngày (dữ liệu đã chín hẳn). Nếu điều kiện
    không còn đúng thì tính là quyết định sớm. Tách theo rule. Đây là thước đo chính cho A1.
  + flipFlops: số lần budget đổi chiều (tăng ↔ giảm) và số lần bid một target đổi chiều,
    chuẩn hóa /30 ngày.
  + wastedSpend: chi tiêu trên target/search term mà cuối cùng bị pause/negative, tính từ lúc đủ
    ngưỡng N2 đến lúc hành động.
  + timeToTier: số ngày tới $12 và tới $25 (null nếu không tới).
  + kinh tế: tổng spend, sales, ACoS, lợi nhuận xấp xỉ = sales × BE − spend.
  + invariantViolations (phải = 0), apiFailures, driftEvents, notifications theo loại.
- Tổng hợp: p5/p50/p95, mean, min/max mỗi chỉ số. Tỷ lệ run có ít nhất 1 pause sớm.
- Ghi runs.jsonl và summary.json.
- So sánh cấu hình: --compare 'ambiguity.changeDayCountsAsPost=false' (hoặc bất kỳ cặp key=value
  nào trong config) chạy cùng tập seed cho 2 cấu hình và ghi diff các chỉ số. Đây là cách đánh giá
  tác động của các flag ambiguity.
- Hiệu năng: full-account 100 seed × 60 ngày phải chạy xong < 5 phút trên máy này với
  --workers auto. Ghi thời gian thực tế vào README.

# 6. BÁO CÁO (src/report/*.ts)
npm run report -- --edge out/edge --mc out/mc/<name> [--mc out/mc/<khác>] --out out/report
→ out/report/report.html (một file tự chứa, không có script ngoài, chart bằng SVG inline, hiển thị
tốt ở cả light và dark qua prefers-color-scheme) và out/report/report.md có cùng nội dung chính.
Nội dung:
1. Tóm tắt: số rule đã mô phỏng, số edge case INVARIANT pass/fail, các chỉ số Monte Carlo chính.
2. Bảng edge case: id, loại, kết quả (PASS/FAIL/số đo), một câu giải thích.
3. Monte Carlo: histogram SVG cho premature, flipFlops, profit, timeToTier.
   Có bảng p5/p50/p95. Nếu có --compare thì thêm bảng so sánh.
4. "Phát hiện về spec v3.1": gom từ README các phát hiện đã ghi (B1 phụ thuộc pha lịch, R05 reset
   làm R07 không chạy, E6 harvest làm nguồn bị R06, R04B thực tế mỗi 8 ngày, tỷ lệ pause sớm do
   attribution). Mỗi phát hiện kèm bằng chứng số liệu và đề xuất hướng sửa spec (đề xuất, không
   sửa rule).
5. Bảng toàn bộ flag ambiguity: giá trị mặc định và ý nghĩa.
Report sinh tất định từ dữ liệu đầu vào. Có test cho renderer: HTML hợp lệ cơ bản, có đủ các mục,
không có URL ngoài.

# 7. TIÊU CHÍ CHUNG
- npm run typecheck và npm test pass. Toàn bộ test cũ (golden Bước 3–4) giữ kỳ vọng. Nếu buộc phải
  đổi thì giải thích trong README.
- npm test vẫn < 60 giây. Monte Carlo lớn không chạy trong npm test; chỉ có test nhỏ 3 seed.
- Chạy thật và để lại output:
  + npm run mc -- scenarios/full-account.json --seeds 100 --workers auto --out out/mc/full-account
  + npm run mc -- scenarios/edge/attribution-storm-account.json --seeds 100 --compare
    'ambiguity.changeDayCountsAsPost=false' --out out/mc/storm. Scenario này là full-account + bão
    attribution của A1.
  + npm run edge -- --out out/edge
  + npm run report -- --edge out/edge --mc out/mc/full-account --mc out/mc/storm --out out/report
- README: phần Bước 5 (executor, reconcile, crash, suite, Monte Carlo, report, cách chạy).
Kết thúc: liệt kê file mới/đã sửa, kết quả npm test (thời gian), bảng edge case (PASS/FAIL/số đo),
summary Monte Carlo chính (premature theo rule, profit p50, flipFlops p50), thời gian chạy
Monte Carlo, đường dẫn report.html, và mọi SPEC-AMBIGUITY mới.
```
