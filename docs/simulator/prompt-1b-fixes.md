# PROMPT 1b — Sửa 6 lỗi sau review Bước 1

```text
# BỐI CẢNH
Bạn đã dựng ./simulator (Bước 1/5). Review phát hiện 6 lỗi. Spec gốc nằm ở
docs/simulator/spec-v3.1.md — ĐỌC FILE NÀY TRƯỚC. Spec là nguồn sự thật; khi spec có
giá trị cụ thể thì KHÔNG được đánh dấu là "unspecified".
Chỉ sửa trong ./simulator. Không viết logic rule (evaluate vẫn trả null), không viết market model.
Mỗi lỗi: viết test tái hiện (fail) trước, rồi sửa, rồi test pass.

# LỖI 1 — Thang budget sai (config/defaults.ts)
Hiện tại: [5,10,15,20,30,40,50,75,100] và bị ghi là "fixture, spec không có".
Spec Phần 3: [$5, $8, $10, $12, $14.40, $17.28, $20.74, $24.88, $25], tối đa $25.
- Đặt đúng 9 bậc trên. Xóa flag ambiguity.budgetLadderSource và comment SPEC-AMBIGUITY tương ứng.
- Thêm hàm budgetMultiplyStep(currentMicros) cho R04B: ×1.2, làm tròn cent, kẹp ≤ $25,
  và trả về đúng giá trị của thang khi bắt đầu từ $12 (12→14.40→17.28→20.74→24.88→25).
Nghiệm thu: test so từng bậc; stepUp từ $24.88 → $25; stepUp tại $25 trả về chính nó (no-op).

# LỖI 2 — Metadata registry để trống (src/rules/registry.ts)
Hiện tại mọi rule có schedule=null, cooldownKind=null, windowDays=null, blockedByTag=[].
Điền metadata theo spec (Phần 3–8 và bảng tóm tắt):
- schedule: R01–R06B, R10–R14, R16–R19 = 'daily'; R07, R08, R09 = 'every3Days';
  R15 = 'weeklySunday'; R20, R21 = 'weekly' + chạy theo khung giờ; R21B = 'hourBoundary'.
  Mở rộng type Schedule cho 'weekly' và 'hourBoundary'.
- cooldown: thêm field cooldownDays: number|null cạnh cooldownKind.
  R02,R03,R04,R05: budget/2 · R04B: budget/3 · R06B: status/7 (khoảng chờ bước 2) ·
  R07,R08,R09: budget/3 · R10,R11: bid/3 · R12: bid/5 · R14: bid/7 ·
  R18,R19: placement/7 · R01,R06,R13,R15,R16,R17,R20,R21,R21B: null.
- windowDays: R02,R03,R04,R05,R08 = 3 · R04B,R07,R09,R14 = 7 · R06 = 14 (W_post tối đa 14) ·
  R06B,R10,R13,R15,R16,R17,R18,R19 = 14 · R11,R12 = W_post (ghi 'post', R12 tối đa 14) · R20,R21 = 28.
  Đổi kiểu thành { kind: 'rolling'|'post', days } | null.
- blockedByTag (tag MANAGE và ALERT, cộng PAUSED_AUTO cho mọi rule campaign trừ R01):
  R02,R03,R04,R04B,R10,R14,R18,R21 bị chặn khi tag ∈ {MANAGE, ALERT}.
- Xóa flag ambiguity.unconfiguredRuleMetadata.
Nghiệm thu: test dạng bảng (table-driven) so khớp metadata của 24 rule với bảng trên.

# LỖI 3 — Không gỡ được tag (src/api/tags.ts)
applyTag("[ALERT] Camp", "NORMAL") trả về "[ALERT] Camp", nên R09 không bao giờ gỡ được tag.
canOverwrite chỉ được chặn đúng 1 trường hợp: MANAGE ghi đè ALERT.
- Tách ra hai hàm: escalateTag(name, tag) (chặn hạ cấp ALERT→MANAGE) và removeTag(name)
  (gỡ mọi tag, dùng cho R09). applyTag(name,'NORMAL') phải gỡ tag.
Nghiệm thu: ALERT→NORMAL và MANAGE→NORMAL gỡ sạch; ALERT→MANAGE vẫn giữ ALERT; không tag kép.

# LỖI 4 — clampBid trả Bid_max khi bid cũ nằm ngoài dải anchor (src/guards/bid.ts, engine/priority.ts)
Tái hiện: oldBase $0.30, anchor $1.00, proposed $0.33, R10 → trả về base $1.08, reasons
EMPTY_BID_RANGE. Engine từ chối mọi decision, nên target bị kẹt vĩnh viễn (edge case C2).
Tình huống này xảy ra thật khi người dùng sửa tay hoặc khi giá/BE thay đổi.
Sửa:
- Ràng buộc cứng ($0.20, Bid_max, trần ToS) luôn thắng. Dải anchor và bước ±20% là
  ràng buộc mềm theo hướng: nếu bid cũ nằm ngoài dải anchor thì cho phép mọi bước tiến
  VỀ PHÍA dải, tối đa ±20% mỗi lần; cấm bước đi xa thêm khỏi dải.
- Chỉ trả EMPTY_BID_RANGE khi chính ràng buộc cứng rỗng. Khi đó base = null
  (KHÔNG trả Bid_max) và engine từ chối decision.
- Thêm reason 'OUTSIDE_ANCHOR_BAND_RECOVERING'.
Nghiệm thu: case tái hiện trả $0.33 (hoặc giá trị hợp lệ gần nhất) kèm reason recovering;
bid $0.30 với rule đề xuất giảm thì trả no-op; ràng buộc cứng rỗng trả base null.

# LỖI 5 — Cooldown theo 24h trôi khi đổi giờ DST hoặc giờ chạy lệch (engine/cooldown.ts)
Tái hiện:
- Đổi lúc 2027-03-13 06:00 PST, kiểm tra 2027-03-16 06:00 PDT (sau 71h) → vẫn trong cooldown.
- Đổi lúc 06:00, kiểm tra 3 ngày sau lúc 05:55 → vẫn trong cooldown.
Cả hai làm cooldown dài thêm 1 ngày.
Sửa: mặc định ambiguity.cooldownDayBasis = 'marketplace-calendar' (đếm ngày lịch theo PT).
Giữ 'elapsed-24h' làm tùy chọn.
Nghiệm thu: hai case trên trả false (hết cooldown) với mặc định mới; đổi D, kiểm tra D+2 → true.

# LỖI 6 — Mốc ngày trong Phần 10 lệch 1 ngày (config/defaults.ts, data/windows.ts)
Người dùng chốt: ambiguity.changeDayCountsAsPost = true.
Nghĩa là ngày xảy ra thay đổi được tính là ngày đầu của W_post (giả định run chạy đầu ngày
trước khi có traffic). Ghi rõ giả định này trong README.
Golden test (spec Phần 10): campaign tạo 2026-10-01 lúc 06:00 PT (ngày 0), resolveWindow
W_post 3 ngày phải eligible=false vào 2026-10-04 (ngày 3) và eligible=true vào 2026-10-05 (ngày 4).
Sau khi đổi budget ở ngày 4: eligible=false ở ngày 7, true ở ngày 8.
Kiểm tra lại các test hiện có dùng giả định cũ và cập nhật cho khớp.

# TIÊU CHÍ CHUNG
- npm run typecheck và npm test pass; mọi test cũ vẫn pass, hoặc được sửa kèm giải thích vì sao.
- Không thêm dependency.
- Cập nhật README (bảng ambiguity, giả định changeDayCountsAsPost).
- Kết thúc: liệt kê file đã sửa, test mới cho từng lỗi, kết quả npm test.
```
