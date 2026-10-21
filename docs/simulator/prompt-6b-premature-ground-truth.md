# PROMPT 6b — Đo "quyết định sớm" bằng sự thật, chạy lại P1

```text
# BỐI CẢNH
./simulator Bước 6 (đã commit): các flag v32.* và kết quả trong simulator/docs/simulator/v3.2-results.md.
Review của project lead kết luận "P1 THUA" là KHÔNG đáng tin, vì hai lý do:
(a) Metric premature (src/montecarlo/metrics.ts) đánh giá lại decision bằng chính rule của biến thể
    (config biến thể) trên dữ liệu đã chín. Biến thể P1 có điều kiện chặt hơn, nên cùng một decision
    vẫn bị tính là "sớm" nhiều hơn. Bằng chứng: P1-K3 trên premature-population có profit và
    wastedSpend giống hệt baseline ở 100/100 seed (tức decision giống nhau), nhưng premature vẫn
    tăng 0.07.
(b) Scenario premature-population có lag 3/5/7 ngày, trong đó 70% đơn đến ở ngày 7. K = 3 hoặc 4
    không thể bắt được đơn đến ở ngày 7.
Chỉ sửa trong ./simulator. Không thêm dependency. TDD. Đã được duyệt: triển khai trực tiếp, không
dừng ở cổng duyệt kế hoạch. Khi mọi flag v32 tắt, mọi hash scenario cũ và 335 test giữ nguyên
(trừ test của chính metric premature: chỉ đổi khi có giải thích).

# 1. METRIC SỰ THẬT, KHÔNG PHỤ THUỘC RULE (src/montecarlo/metrics.ts)
Thêm metric `wrongZeroOrder`, chỉ áp cho decision dựa trên "0 đơn": R06, R12, R13, R16, R17,
R05 nhánh B, R08.
- Lấy cửa sổ mà decision đã dùng để kết luận "0 đơn". Ghi cửa sổ này vào decision tại thời điểm
  quyết định (from/to/entity), qua recorder đọc số liệu đã có từ Bước 4.
- Đếm đơn THẬT trong cửa sổ đó từ dữ liệu đã chín hẳn (asOf = cuối mô phỏng + 15 ngày, hoặc
  từ market truth).
- Nếu có ≥ 1 đơn thì decision là "sai về 0 đơn".
- Metric KHÔNG gọi lại evaluator của rule và KHÔNG phụ thuộc config biến thể. Cùng một decision
  luôn cho cùng kết quả ở mọi biến thể.
- Giữ metric `premature` cũ nhưng đổi tên trong report thành "premature (rule-relative)" và ghi
  chú hạn chế. Mọi kết luận v3.2 dùng `wrongZeroOrder`.
- Thêm `wrongZeroOrderPause`: số pause vĩnh viễn (R06/R13) sai, và tỷ lệ seed có ≥ 1 pause sai.
- Test bắt buộc: hai biến thể có cùng decision thì có cùng wrongZeroOrder; đối chứng
  premature-positive cho wrongZeroOrder > 0; lag {"0":1} cho wrongZeroOrder = 0.

# 2. CHẠY LẠI P1 VỚI K PHÙ HỢP VỚI LAG
- Biến thể K = 3, 5, 8 trên: premature-population (lag 3/5/7), attribution-storm-account,
  marginal-account, full-account. 100 seed, --workers auto.
- Báo cáo cho từng K:
  + wrongZeroOrder và wrongZeroOrderPause (p50/mean, tỷ lệ seed có pause sai);
  + wastedSpend, profit, timeToTier;
  + "độ trễ hành động": số ngày trung bình từ khi entity đủ ngưỡng spend/click đến khi rule chạy.
- Tiêu chí P1 (thay tiêu chí cũ):
  THẮNG nếu tỷ lệ seed có pause sai giảm ≥ 50% trên premature-population, và profit p50 trên
  marginal/full-account không giảm quá 5%.
  Nếu không K nào đạt thì THUA, và ghi rõ đánh đổi giữa pause sai và wastedSpend theo từng K.

# 3. ĐÁNH GIÁ LẠI CÁC ĐỀ XUẤT KHÁC BẰNG METRIC MỚI
- Chạy lại phần premature của P2, P3, P4 và tổ hợp bằng wrongZeroOrder (dùng lại output nếu decision
  đã lưu đủ cửa sổ; nếu không thì chạy lại).
- Nếu kết luận của đề xuất nào thay đổi thì cập nhật và ghi lý do.

# 4. CẬP NHẬT BÁO CÁO
- Cập nhật v3.2-results.md (chuyển về docs/simulator/v3.2-results.md ở gốc repo nếu được phép.
  Nếu sandbox chỉ cho sửa ./simulator thì giữ nguyên chỗ và ghi đường dẫn trong README).
- Thêm phần "Sửa phương pháp đo" giải thích vì sao kết luận P1 cũ bị bỏ.
- Bảng kết luận cuối P1–P6 và danh sách flag đề xuất cho v3.2, kèm câu chữ sửa spec.
- Regenerate report HTML.
Kết thúc: liệt kê file đã sửa, kết quả npm test, bảng P1 theo K (wrongZeroOrderPause rate,
wastedSpend, profit), bảng kết luận cuối P1–P6.
```
