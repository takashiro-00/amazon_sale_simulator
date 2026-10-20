# PROMPT 1c — Cooldown theo từng rule

```text
# BỐI CẢNH
./simulator đang ở Bước 1. Spec: docs/simulator/spec-v3.1.md (đọc phần G3 và cột "Chờ").
Lỗi: registry đã khai báo cooldownDays cho từng rule, nhưng engine (src/engine/priority.ts,
src/engine/cooldown.ts) KHÔNG đọc trường này. Hiện engine lấy số ngày từ
TargetMemory.cooldownDays hoặc config.cooldown[kind]. Hậu quả:
- R04B chờ 2 ngày thay vì 3.
- R14 chờ 3 ngày thay vì 7.
- R12 chỉ chờ 5 ngày khi chính rule tự gán memory.cooldownDays.
- R06B dùng cooldownKind 'status' với 0 ngày, tức là vô nghĩa.
Chỉ sửa trong ./simulator. evaluate() của mọi rule vẫn trả null. Không viết market model.
Viết test tái hiện (fail) trước, rồi mới sửa.

# MÔ HÌNH ĐÚNG: cooldown do RULE VỪA HÀNH ĐỘNG ĐẶT RA
Cột "Chờ" trong spec là khoảng chờ SAU KHI rule đó hành động.
Tách metadata cooldown thành 2 trường (bỏ cooldownKind/cooldownDays cũ):
  cooldownGate: CooldownKind | null
    Rule bị CHẶN khi đối tượng đang trong cooldown loại này.
  cooldownSets: ReadonlyArray<{ kind: CooldownKind; days: number }>
    Cooldown mà rule ĐẶT RA khi decision của nó thực sự đổi giá trị loại đó.
Bảng (bắt buộc đúng):
  R01            gate null    sets []                      (dùng grace)
  R02 R03 R04    gate budget  sets [budget 2]
  R04B           gate budget  sets [budget 3]
  R05            gate budget  sets [budget 2]
  R06            gate null    sets []                      (safety stop, không bao giờ bị chặn)
  R06B           gate null    sets [budget 2, bid 3]       (bước 2 tính bằng r06bStep1At + 7 ngày, KHÔNG phải cooldown)
  R07            gate null    sets [budget 3, bid 3]
  R08            gate null    sets [budget 3]              (cảnh báo khẩn, không bị cooldown chặn)
  R09            gate null    sets [budget 3, bid 3]
  R10 R11        gate bid     sets [bid 3]
  R12            gate bid     sets [bid 5]
  R13            gate null    sets []
  R14            gate bid     sets [bid 7]
  R15 R16 R17    gate null    sets []
  R18 R19        gate placement sets [placement 7]
  R20 R21 R21B   gate null    sets []                      (hệ số giờ không phải đổi base_bid)
R07/R08/R09 không gate vì đã chạy mỗi 3 ngày theo lịch. Ghi `// SPEC-AMBIGUITY:` cho lựa chọn này
và thêm flag ambiguity.tagRulesGatedByCooldown = false (nếu true thì gate = budget).

# THAY ĐỔI STATE
- CampaignMemory: thêm cooldownUntil: { budget: MarketplaceDate|null; placement: MarketplaceDate|null }.
- TargetMemory: bỏ cooldownDays; thêm bidCooldownUntil: MarketplaceDate|null.
  Giữ lastBidChangeAt và lastChangeAt để audit.
- cooldownUntil = ngày marketplace của lần đổi + days. Đối tượng còn trong cooldown khi
  toMarketplaceDate(now) < cooldownUntil. Ví dụ: đổi ngày D với 3 ngày → bị chặn D+1, D+2,
  được chạy lại từ D+3.
- Cập nhật assertStateInvariants và createTargetMemory/createCampaignMemory cho phù hợp.
- Xóa config.ambiguity.cooldownDayBasis cùng nhánh 'elapsed-24h', vì cooldown giờ chỉ đếm theo ngày lịch PT.

# THAY ĐỔI ENGINE (firstMatchWins)
- Gate: nếu rule.cooldownGate != null và đối tượng tương ứng đang cooldown thì ghi
  BLOCKED_BY_COOLDOWN và xét rule kế tiếp. Gate 'bid' xét target của objectRef; gate 'budget'
  và 'placement' xét campaign.
- Stamp: SAU KHI decision MATCHED (đã qua G6 và không phải no-op), engine tự xác định loại
  nào thực sự đổi:
    budget = dailyBudgetMicros hoặc budgetTierIndex đổi
    bid = baseBidMicros của target đổi (chỉ những target đó)
    placement = topOfSearchPct đổi
  Với mỗi loại đã đổi:
    (a) đặt cooldownUntil theo cooldownSets của rule. Nếu rule đổi một loại không có trong
        cooldownSets thì dùng config.cooldown mặc định (bid 3, budget 2, placement 7) và ghi
        reason 'DEFAULT_COOLDOWN_APPLIED'.
    (b) gọi applyResetOnEffectiveChange để reset windowStartAt và lastChangeAt (G3).
  Rule KHÔNG được tự ghi cooldownUntil/windowStartAt. Nếu proposedState tự sửa các trường
  này thì báo ERROR 'RULE_WROTE_ENGINE_FIELD'.
- No-op không stamp và không reset.

# TIÊU CHÍ NGHIỆM THU
1. Sau decision R12 trên target t ở ngày D: R11/R10/R14 trên t bị BLOCKED_BY_COOLDOWN
   từ D+1 đến D+4, chạy được ở D+5. Sau R10: chạy được ở D+3.
2. Sau R14 ở D: R10 trên t bị chặn đến D+6, chạy được ở D+7.
3. Sau R04B ở D: R02/R03/R04/R05 bị chặn D+1, D+2, chạy được ở D+3. Sau R02: chạy được ở D+2.
4. Ngay sau R02 (budget cooldown đang chạy): R06, R08, R07, R09, R13 KHÔNG bị chặn bởi cooldown.
   Khi tagRulesGatedByCooldown=true thì R07/R08/R09 bị chặn, nhưng R06 vẫn không.
5. R07 giảm bid 2/3 target: chỉ 2 target đó có bidCooldownUntil = D+3 và windowStartAt mới;
   campaign có budget cooldown D+3.
6. Decision no-op: không thay đổi cooldownUntil, windowStartAt, lastChangeAt.
7. Rule tự ghi cooldownUntil: ERROR 'RULE_WROTE_ENGINE_FIELD', không có decision.
8. DST: đổi 2027-03-13 06:00 PST với 3 ngày → chạy được 2027-03-16 06:00 PDT.
9. Test bảng metadata cập nhật theo bảng trên cho đủ 24 rule.
10. npm run typecheck và npm test pass; test cũ được sửa kèm giải thích nếu kỳ vọng thay đổi.
    README cập nhật mô hình cooldown.
Kết thúc: liệt kê file đã sửa, test mới, kết quả npm test.
```
