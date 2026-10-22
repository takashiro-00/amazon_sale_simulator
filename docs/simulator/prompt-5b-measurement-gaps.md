# PROMPT 5b — Lấp 3 lỗ hổng đo lường của Bước 5

```text
# BỐI CẢNH
./simulator đã hoàn tất Bước 1–5 (R01–R21B, market model, executor chịu lỗi, edge suite,
Monte Carlo `npm run mc`, report `npm run report`), 295 test pass, commit trên nhánh
simulator/steps-1-2. Spec: docs/simulator/spec-v3.1.md. Edge case: docs/simulator/00-roadmap-and-edge-cases.md.
Kết quả Bước 5: simulator/README.md mục "Kết quả chạy thật Bước 5" và "Phát hiện Bước 5".
Project lead review Bước 5 và thấy 3 chỗ phép đo không chứng minh được gì. Bước 5b lấp 3 chỗ đó.
Project lead đã duyệt phạm vi này: triển khai trực tiếp, KHÔNG dừng ở cổng duyệt kế hoạch, KHÔNG hỏi lại.
Chỉ sửa trong ./simulator. Không thêm dependency. TDD.
Không chỉnh rule để làm test pass. Rule chỉ được sửa khi có bug thật, và phải kèm regression test.
Mọi test hiện có giữ nguyên kỳ vọng. Mọi lựa chọn mơ hồ: thêm flag ambiguity và // SPEC-AMBIGUITY:.

# 1. METRIC PREMATURE CHƯA TỪNG BẮT ĐƯỢC GÌ (src/montecarlo/metrics.ts, maturePremature)
Hiện tại premature = 0 cho mọi rule ở mọi scenario. Không có gì chứng minh metric phát hiện được.
Yêu cầu:
- Thêm scenario đối chứng dương scenarios/edge/premature-positive.json (tên khác cũng được, ghi rõ
  trong README): một target có CVR thật thấp nhưng dương (khoảng 3–5%) và attribution lag nặng
  (phần lớn đơn đến sau 3–7 ngày). Dựng sao cho R12/R13 hoặc R06 kích hoạt trên dữ liệu chưa chín
  (lúc quyết định thấy 0 đơn hoặc ACoS rất cao, khi đơn đã chín thì rule không còn khớp).
- Test: chạy scenario này qua measureRun/runSeed, assert premature (của R12, R13 hoặc R06) > 0.
  Ghi rõ rule nào, ngày nào, số liệu cửa sổ lúc quyết định và lúc đã chín.
- Nếu dù dữ liệu rõ ràng là chưa chín mà metric vẫn = 0: tìm và sửa bug trong maturePremature
  (ví dụ: cửa sổ đánh giá lại có thật sự dùng fact đã chín không, clock/asOf, state before,
  cooldown/guard chặn evaluator, matureFacts có thật sự chứa đơn trễ không). Kèm regression test
  chứng minh bug và chứng minh đã sửa.
- Thêm một đối chứng âm: cùng scenario nhưng không có lag (đơn về ngay) → premature = 0.

# 2. MONTE CARLO GẦN NHƯ KHÔNG BIẾN THIÊN THEO SEED
full-account cho timeToTier p5 = p95 = 12 và ACoS khoảng 4%: account quá tốt, seed nào cũng ra cùng
quyết định, nên Monte Carlo không đo được gì.
Yêu cầu:
- Thêm scenario account "marginal" (ví dụ scenarios/marginal-account.json): CVR thật và ACoS thật
  nằm sát T_win / T_ok / T_bad (dẫn xuất từ breakEvenAcos qua deriveThresholds), nhiều campaign/
  target, đủ volume để rule chạy. Mục tiêu: các seed khác nhau dẫn tới quyết định khác nhau đáng kể.
- Test: chạy một số seed nhỏ (ví dụ 8–12, giữ test nhanh) và assert có biến thiên thật:
  ít nhất một trong timeToTier/acos/profit/số decision có p5 ≠ p95, và tập decision (ruleId +
  objectRef + ngày) khác nhau giữa ít nhất hai seed.
- Chạy thật 100 seed:
  npm run mc -- scenarios/marginal-account.json --seeds 100 --workers auto --out out/mc/marginal
  Ghi p5/p50/p95 của timeToTier.to12, timeToTier.to25, acos, profit, spend, flipFlops, wastedSpend,
  premature total vào README, kèm thời gian chạy.

# 3. R20/R21 CHƯA BAO GIỜ ĐỔI HỆ SỐ GIỜ TRONG RUN TÍCH HỢP
A5/A6: 624 lần phân tích, R20/R21 đổi factor 0/0. Không biết là do fixture thiếu volume hay rule
không bao giờ kích hoạt được.
Yêu cầu:
- Thêm scenario edge (ví dụ scenarios/edge/hourly-signal.json) có đủ volume giờ: ≥ 40 click mỗi
  giờ ở cấp campaign trong 28 ngày, budget không bị cạn trong ngày, có một giờ yếu rõ ràng (CVR
  hoặc ACoS tệ hơn hẳn) và một giờ mạnh rõ ràng.
- Test tích hợp (qua runAccountLoop, không gọi rule trực tiếp):
  + R20 kích hoạt (giảm factor giờ yếu) ít nhất một lần;
  + R21 kích hoạt (tăng factor giờ mạnh) ít nhất một lần;
  + R21B ghi đúng một lần mỗi ranh giới giờ có thay đổi bid (không ghi trùng ở cùng boundary,
    không ghi khi bid không đổi).
- Nếu volume đã đủ mà R20/R21 vẫn không kích hoạt: tìm nguyên nhân. Bug thật thì sửa kèm
  regression test. Nếu là do spec (ví dụ ngưỡng không thể đạt) thì KHÔNG sửa rule, ghi phát hiện
  vào README với số liệu.

# 4. NỐI VÀO EDGE SUITE VÀ REPORT
- Scenario mới của mục 1 và 3 chạy trong `npm run edge` (src/edge/suite.ts) và ghi kết quả vào
  out/edge như các case khác. Scenario marginal xuất hiện trong report qua --mc out/mc/marginal.
- Chạy lại toàn bộ:
  npm run edge -- --out out/edge
  npm run mc -- scenarios/marginal-account.json --seeds 100 --workers auto --out out/mc/marginal
  npm run report -- --edge out/edge --mc out/mc/full-account --mc out/mc/storm --mc out/mc/marginal --out out/report
  (Nếu out/mc/full-account hoặc out/mc/storm không còn thì chạy lại bằng lệnh trong README.)
- README: thêm mục "Bước 5b — đối chứng đo lường" gồm: scenario mới và cách dựng, kết quả premature
  (dương/âm), bảng p5/p50/p95 marginal 100 seed, số lần R20/R21/R21B trong hourly-signal, bug nào
  đã sửa (nếu có) kèm test. Cập nhật lệnh chạy report trong README.

# 5. NGHIỆM THU
- npm run typecheck và npm test pass toàn bộ; test cũ giữ nguyên kỳ vọng.
- Test mới: premature > 0 ở đối chứng dương, = 0 ở đối chứng âm; marginal có biến thiên theo seed;
  R20 và R21 đều kích hoạt, R21B ghi một lần mỗi boundary.
- out/edge, out/mc/marginal, out/report đã sinh lại.
- KHÔNG commit, KHÔNG push (project lead sẽ review và commit).
Kết thúc: liệt kê file đã sửa/thêm, kết quả npm test (số test, thời gian), giá trị premature ở
đối chứng dương, bảng p5/p50/p95 marginal, số lần R20/R21/R21B, và bug nào đã sửa (nếu có).
```
