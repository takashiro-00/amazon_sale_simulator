# PROMPT 3b — R06B được kích hoạt lại sau khi hồi phục

```text
# BỐI CẢNH
./simulator Bước 3 (rule campaign R01–R09). Spec: docs/simulator/spec-v3.1.md, mục R06B và R09.
Lỗi: r06bPhase chỉ trở về 'NONE' khi R01 chạy. Sau khi R06B chạy (bước 1 → bước 2 'DONE') và
R09 gỡ tag, campaign về NORMAL nhưng r06bPhase vẫn 'DONE', nên R06B KHÔNG BAO GIỜ chạy lại.
Probe (ScriptedMarket, $30/BE 40%):
- ACoS 70% các ngày 0–6, 20% các ngày 7–40, rồi 70% từ ngày 41.
- Kết quả: R06B ngày 6 và 14, R09 ngày 15, tăng budget lại đến $17.28.
- Từ ngày 41, R06B không chạy. Thay vào đó R05 hạ từng bậc ở các ngày 45/49/53/57/61 và R07
  chỉ chạy ở ngày 69. Campaign lỗ ở ACoS 70% gần 4 tuần.
Chỉ sửa trong ./simulator. Không thêm dependency. Viết test tái hiện (fail) trước, rồi sửa.

# SỬA
- Khi R09 gỡ tag (MANAGE/ALERT → NORMAL), đặt r06bPhase='NONE' và r06bStep1At=null trong cùng
  decision. Điều này thay cho logic hiện tại (đang đặt 'DONE' khi STEP1_WAITING).
  Ghi // SPEC-AMBIGUITY: "mỗi lần campaign hồi phục về NORMAL thì R06B được kích hoạt lại".
- Bất biến mới trong src/invariants/campaign.ts: tag = NORMAL ⇒ r06bPhase = 'NONE'.
  ('DONE' chỉ hợp lệ khi tag ∈ {MANAGE, ALERT, PAUSED_AUTO}.)
- Không đổi hành vi khác.

# NGHIỆM THU
1. Regression test với đúng kịch bản probe ở trên, 80 ngày:
   - R06B chạy lần thứ hai sau ngày 41 (bước 1: MANAGE, $5, bid −20% trong giới hạn sàn 0.70).
   - Sau đó, nếu ACoS vẫn 70%, R06B bước 2 PAUSE (notify R06B_PAUSED).
   Assert ngày cụ thể và ghi vào README.
2. Test cũ về edge case B3 (R09 gỡ tag khi STEP1_WAITING) cập nhật thành r06bPhase='NONE'.
3. Bất biến mới được kiểm tra trong mọi golden test (B1–B5) mà không vỡ.
4. npm run typecheck và npm test pass. Snapshot chỉ được đổi ở những chỗ liên quan, có giải thích.
Kết thúc: liệt kê file đã sửa, timeline mới của regression test, kết quả npm test.
```
