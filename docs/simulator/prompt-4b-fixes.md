# PROMPT 4b — Hoàn tất Bước 4: R14, audit, smoke

```text
# BỐI CẢNH
./simulator Bước 4 đã cài đủ R10–R21B (xem simulator/docs/step-4-status.md). Hiện có 253 test pass
và 1 test fail (smoke full-account). Project lead đã review và kết luận như sau.
Chỉ sửa trong ./simulator. Không thêm dependency. Viết test tái hiện (fail) trước rồi mới sửa.

# 1. LỖI R14: count reset lặp vô hạn (src/rules/target/r14.ts)
Khi lowImpressionFlagUntil đã hết hạn, R14 tính count = 0 nhưng KHÔNG xóa flag. Ở lần đánh giá
sau, flag cũ (đã hết hạn) vẫn còn nên count lại bị reset về 0. Kết quả: sau chu kỳ đầu, R14 tăng
bid mỗi 7 ngày không giới hạn.
Sửa:
- Khi reset (flag hết hạn và r14CountResetAfterFlag=true), proposal của R14 phải đặt
  lowImpressionFlagUntil=null cùng lúc với r14Count = 1.
- Nếu không có proposal (R14 không khớp vì lý do khác), KHÔNG mutate state. Count hiệu dụng tiếp
  tục được tính từ flag hết hạn, đúng như hiện tại.
Regression test: target luôn ít impression trong 120 ngày →
- R14 tăng đúng 3 lần, rồi có cờ 30 ngày;
- sau khi cờ hết hạn, tăng tối đa 3 lần nữa, rồi lại có cờ;
- tổng số lần tăng trong mỗi chu kỳ (giữa hai lần đặt cờ) ≤ 3.

# 2. KỲ VỌNG SMOKE SAI (test/full-account.test.ts) — lỗi của brief, không phải của rule
Brief Bước 4 yêu cầu "R14 tăng ≤ 3 lần" trong 60 ngày. Điều này mâu thuẫn với chính
r14CountResetAfterFlag=true: 3 lần (ngày 8/15/22), cờ đến ngày 52, sau đó được phép tăng tiếp.
Sửa assertion thành: "mỗi chu kỳ cờ ≤ 3 lần tăng, và giữa hai lần tăng cách ≥ 7 ngày".
Không sửa rule hay scenario để pass. Sau khi sửa lỗi 1, chạy lại và báo số lần thực tế.

# 3. AUDIT QUÁ LỚN VÀ CHẬM (src/audit/log.ts, src/engine/priority.ts, src/cli/sim.ts)
Hiện tại mỗi audit event structuredClone toàn bộ EngineState (before/after) cộng với toàn bộ fact
lịch sử (factsAsOf từ 1900). Hậu quả:
- CLI full-account lỗi "Invalid string length" và không tạo được audit.jsonl;
- test full-account mất khoảng 50 giây.
Sửa:
- before/after trong audit chỉ chứa DIFF của đối tượng bị ảnh hưởng: các field thay đổi của
  campaign/campaignMemory/target/targetEntities liên quan. Event không khớp thì không có diff.
- inputsSnapshot chỉ chứa:
  + số liệu cửa sổ mà rule đã đọc. Thêm một recorder nhẹ trong MetricsReader: mỗi lần rule gọi
    campaignWindow/targetWindow/placement/search thì ghi lại {query, from, to, totals};
  + paramsVersion;
  + hash của config;
  + now.
  KHÔNG chứa toàn bộ state, KHÔNG chứa fact thô.
- Decision vẫn giữ before/after đầy đủ trong bộ nhớ cho runner. Nhưng decisions.jsonl cũng chỉ ghi
  diff cộng với id và rule.
- Serialize JSONL theo kiểu streaming: ghi từng dòng vào file bằng fs.createWriteStream trong CLI,
  không join cả log thành một chuỗi. AuditLog vẫn không làm I/O; thêm một iterator.
- config.audit.level: 'matched' | 'all' (mặc định 'all'). 'matched' chỉ lưu event MATCHED/ERROR,
  dùng cho Monte Carlo ở Bước 5.
Nghiệm thu:
- npm run sim -- scenarios/full-account.json --rules all --out out/full-account exit 0, có đủ
  audit.jsonl, decisions.jsonl, notifications.jsonl, port-calls.jsonl, timeline.md.
- audit.jsonl < 20MB.
- test full-account < 15 giây.
- Test: mọi audit event MATCHED có diff khác rỗng và inputsSnapshot.reads khác rỗng (với rule có
  đọc số liệu). Event SKIPPED_NOOP có reads nhưng không có diff.
- Golden và snapshot cũ vẫn pass. Nếu có snapshot audit nào buộc phải đổi thì giải thích trong README.

# 4. GHI NHẬN PHÁT HIỆN (README, không sửa code)
Trong smoke full-account, campaign AUTO nguồn bị R06 PAUSE vĩnh viễn vào ngày 8. Lý do:
- term tốt được harvest và bị negative ở nguồn ngày 5;
- phần traffic còn lại của AUTO chỉ là term rác (0 đơn), nên chi tiêu đủ Spend_zero và click ≥ N2
  trong W_post sau lần tăng budget ngày 4.
Ghi vào README mục "Phát hiện Bước 4" như một ví dụ edge case E6 (harvest làm campaign nguồn mất
toàn bộ đơn → R06 pause vĩnh viễn). Kèm số liệu W_post ở ngày 8, và nêu rằng scenario chỉ có 2
search term nên hiện tượng bị phóng đại.

# 5. HOÀN TẤT
- Cập nhật simulator/docs/step-4-status.md thành trạng thái hoàn tất, có số liệu cuối.
  Đánh dấu các checkbox đã xong trong step-4-plan.md.
- npm run typecheck và npm test pass toàn bộ.
Kết thúc: liệt kê file đã sửa, kết quả npm test (kèm thời gian chạy), số lần R14 thực tế theo chu
kỳ, kích thước audit.jsonl và thời gian chạy CLI full-account.
```
