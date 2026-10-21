# PROMPT 6 — Thử nghiệm các đề xuất v3.2 (Bước 6)

```text
# BỐI CẢNH
./simulator đã xong Bước 1–5b: R01–R21B, market, executor, edge suite, Monte Carlo (npm run mc,
có --compare key=value), report.
Đọc trước: docs/simulator/v3.2-proposals.md (7 đề xuất P1–P7 kèm bằng chứng), spec
docs/simulator/spec-v3.1.md, simulator/README.md (các phần phát hiện Bước 3–5b).
Bước 6: cài các đề xuất P1–P6 thành flag `v32.*` trong SimConfig, MẶC ĐỊNH TẮT để giữ đúng hành vi
v3.1. Sau đó chạy so sánh Monte Carlo và viết báo cáo khuyến nghị.
Chỉ sửa trong ./simulator. Không thêm dependency. TDD. Project lead đã duyệt phạm vi: triển khai
trực tiếp, KHÔNG dừng ở cổng duyệt kế hoạch.
Bất biến quan trọng nhất: khi mọi flag v32 tắt, toàn bộ test hiện có (298) phải pass KHÔNG đổi kỳ
vọng, và hash/kết quả các scenario cũ không đổi.

# 1. FLAG (config/defaults.ts → SimConfig.v32, mặc định như v3.1)
P1 v32.zeroOrderLagDays: number (mặc định 2).
   Riêng điều kiện "0 đơn" (gồm cả zeroOrdersRobust) của R06, R12, R13, R16, R17, R05 nhánh B
   và R08 dùng dữ liệu kết thúc ở D-K thay vì D-2. Các ngưỡng spend/click của cùng rule vẫn tính
   trên cửa sổ gốc kết thúc ở D-2. Có đơn ở bất kỳ ngày nào từ D-K+1 đến D-2 thì điều kiện "0 đơn"
   cũng không thỏa. Ghi rõ định nghĩa này trong README.
P2 v32.r06CalendarGuard: boolean.
   R06 khớp thêm khi: tổng spend có 0 đơn trong 14 ngày lịch kết thúc D-2 (không cắt theo reset)
   ≥ 2×Spend_zero, VÀ 0 đơn trong cùng khoảng đó (áp dụng P1 nếu bật). Điều kiện cũ giữ nguyên;
   đây là điều kiện HOẶC.
P3 v32.r08Daily: boolean. R08 chạy hằng ngày thay vì every3Days. R07/R09 giữ nguyên.
P4 v32.postHarvestGraceDays: number (mặc định 0). Trong N ngày lịch sau khi R15 thêm Negative
   Exact ở campaign nguồn, R06 không chạy trên campaign nguồn (audit 'BLOCKED_BY_HARVEST_GRACE').
   Các rule khác vẫn chạy.
P5 v32.hysteresis: boolean. Khi bật:
   - R10 cần ACoS ≤ 0.9×T_win;
   - R11 cần ACoS > 1.1×T_ok;
   - R02/R03/R04 cần ACoS < 0.95×T_ok; R04B cần ACoS < 0.95×T_win;
   - R05 nhánh A cần ACoS ≥ 1.05×T_bad.
   Các hệ số nằm trong config.v32Hysteresis để chỉnh được.
P6 v32.hourlyExcludeCapped: boolean. R20/R21 loại khỏi thống kê giờ H những ngày mà giờ H có
   budgetCapped, và chỉ đánh giá giờ H khi còn ≥ 20 ngày không bị cap trong 28 ngày.
   Không đủ thì hệ số = 1.0.
Mỗi flag có unit test chứng minh: tắt → hành vi v3.1; bật → đúng định nghĩa trên.
Mọi rule đọc flag qua config, không hard-code.

# 2. COMPARE NHIỀU CẤU HÌNH (src/montecarlo, CLI)
- Cho phép --compare lặp nhiều lần, mỗi lần là một biến thể có tên:
  --variant P1-K3 'v32.zeroOrderLagDays=3' --variant P5 'v32.hysteresis=true' ...
  Biến thể có thể gồm nhiều key=value. Baseline luôn là v3.1 mặc định.
- Tất cả biến thể chạy CÙNG tập seed với baseline. summary.json có: metric của từng biến thể,
  delta so với baseline (p50 và mean), và kiểm định cặp đơn giản theo seed (tỷ lệ seed biến thể tốt
  hơn baseline cho profit, wastedSpend, premature, flipFlops).
- Giữ tương thích cú pháp --compare cũ.

# 3. SCENARIO PHỤC VỤ THỬ NGHIỆM
- scenarios/edge/premature-population.json: dựa trên premature-positive nhưng là quần thể (5 target
  CVR thật 2%–6%, lag 3/5/7 ngày như đối chứng) để Monte Carlo 100 seed đo được tỷ lệ premature.
  Trước khi chạy thử nghiệm, kiểm tra baseline v3.1 có premature > 0 ở ít nhất 10% seed. Nếu không
  đạt, chỉnh SCENARIO (không chỉnh rule) và ghi lý do.
- Dùng lại: marginal-account.json, full-account.json, edge/attribution-storm-account.json,
  edge/B1.json (3 pha), edge/B2.json, edge/E6.json, edge/A5.json, edge/hourly-signal.json.

# 4. CHẠY THỬ NGHIỆM (để lại output trong out/v32/)
Mỗi lệnh 100 seed, --workers auto:
- P1: premature-population, attribution-storm-account, marginal-account với biến thể K=3 và K=4.
- P2: marginal-account, full-account; chạy B2 dạng edge với flag bật/tắt.
- P3: attribution-storm-account; chạy B1 dạng edge cả 3 pha với flag bật/tắt.
- P4: full-account; chạy E6 dạng edge với flag 0 và 7.
- P5: marginal-account, full-account.
- P6: chạy A5 và hourly-signal dạng edge với flag bật/tắt; hourly-signal vẫn phải phát hiện được
  giờ yếu và giờ mạnh.
- Tổ hợp: các đề xuất "thắng" theo tiêu chí trong v3.2-proposals.md, gộp lại thành biến thể
  'v32-combined', chạy trên marginal, full-account, storm, premature-population.

# 5. BÁO CÁO (docs/simulator/v3.2-results.md và mở rộng npm run report)
- Mỗi đề xuất có:
  + bảng baseline và biến thể (p50/mean của premature theo rule, wastedSpend, profit, flipFlops,
    timeToTier);
  + delta;
  + tỷ lệ seed tốt hơn;
  + kết quả edge bật/tắt;
  + KẾT LUẬN theo cột "Thắng khi": THẮNG / THUA / KHÔNG RÕ, kèm một câu lý do.
- Phần tổ hợp và đề xuất cuối: danh sách flag nên đưa vào spec v3.2, kèm câu chữ đề xuất để sửa
  spec (tiếng Việt, cùng giọng văn với spec-v3.1.md). P7 chỉ sửa câu chữ.
- Report HTML có thêm mục "Thử nghiệm v3.2" đọc từ out/v32.
- Trung thực: nếu đề xuất thua hoặc không rõ, ghi rõ. Không chỉnh tham số để đề xuất thắng.

# 6. TIÊU CHÍ CHUNG
- npm run typecheck và npm test pass (thêm test mới; 298 test cũ giữ nguyên).
- npm test < 60 giây.
- Ghi tổng thời gian chạy toàn bộ thử nghiệm vào README.
Kết thúc: liệt kê file mới/đã sửa, kết quả npm test, bảng kết luận P1–P6 (THẮNG/THUA/KHÔNG RÕ với
số liệu chính), danh sách flag đề xuất cho v3.2 và đường dẫn v3.2-results.md.
```
