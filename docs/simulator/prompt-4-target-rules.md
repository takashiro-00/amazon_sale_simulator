# PROMPT 4 — Target, Search term, Placement, Theo giờ R10–R21B (Bước 4/5)

```text
# BỐI CẢNH
./simulator đã xong:
- Bước 1: domain, G1–G8, engine first-match-wins, cooldown theo rule.
- Bước 2: market model, reporting bitemporal, FaultyFakePort, scenario.
- Bước 3: rule campaign R01–R09, MetricsReader, campaign loop, ScriptedMarket, invariant campaign.
Spec là nguồn sự thật: docs/simulator/spec-v3.1.md (đọc kỹ Phần 1, 2, 5, 6, 7, 8, 10).
Edge case: docs/simulator/00-roadmap-and-edge-cases.md (B4, B5, C1, C2, C4, C5, D3, E1, E5, E6).
Bước 4: cài R10–R21B, chính sách xung đột liên cấp, và mở rộng runner/market cho các rule này.
Chỉ sửa trong ./simulator. Không thêm dependency. TDD: viết test trước rồi mới cài.
Rule là hàm THUẦN (đọc RuleContext, trả Proposal | null). Mọi thay đổi base bid đi qua engine (G6).
Mọi lựa chọn khi spec mơ hồ: thêm flag vào SimConfig.ambiguity (mặc định như ghi dưới đây) và
viết // SPEC-AMBIGUITY: tại chỗ dùng.

# 0. THAM SỐ NGƯỠNG (dùng tham số G1, không hard-code)
R12 click ≥ N2. R13 click ≥ N3, thêm ≥ N2h click sau R12. R14 "≥10 click mà 0 đơn" dùng N2h.
R16 click ≥ N3. R17 click ≥ N17. R10 và R11 dùng 15 click: đưa vào config.thresholds.r10r11Clicks = 15.
R20/R21 dùng 40 click: config.thresholds.hourlyClicks = 40.
Sàn bid của target: floor = max($0.20, 0.5 × anchor). Đây là sàn của R12/R13.

# 1. CHÍNH SÁCH XUNG ĐỘT LIÊN CẤP (ambiguity.crossLevelBidPolicy)
- Đổi kiểu thành 'campaign-first' | 'error' (bỏ 'target-first'). Mặc định 'campaign-first'.
- 'campaign-first': trong một run, nhóm CAMPAIGN chạy trước. Target nào đã bị một decision cấp
  campaign (R06B/R07/R09) ghi baseBid trong run đó thì bị bỏ qua toàn bộ nhóm TARGET ở run này.
  Audit ghi outcome 'SKIPPED_CROSS_LEVEL'. Kết quả: mỗi target có tối đa 1 lần ghi baseBid mỗi
  run, và tổng thay đổi mỗi run ≤ ±20%.
- 'error': giữ hành vi cũ (ERROR CROSS_LEVEL_BID_CONFLICT). Chỉ dùng trong test.

# 2. SỬA ENGINE VÀ G6
a) ToS và base bid:
   - Engine KHÔNG được tự hạ baseBid của target khi một decision chỉ đổi topOfSearchPct.
     Bỏ nhánh "ToS đổi thì clampBid mọi target".
   - Thay vào đó: rule placement (R18) chỉ được tăng ToS khi MỌI target ENABLED của campaign vẫn
     thỏa max_h(base × hourlyFactor[h]) × (1 + ToS/100) ≤ 1.5 × Bid_max.
     Nếu không thỏa thì R18 trả null, audit reason 'TOS_CAP'. R19 (giảm) luôn được phép.
b) clampBid dùng hourlyFactor = max theo 24 giờ của target (khi tosCapIncludesHourly=true),
   KHÔNG dùng hệ số của giờ đang chạy.
c) Engine hỗ trợ TẠO target mới (cho R15):
   - Target mới đi qua G6 với oldBase = proposedBase (không áp bước ±20%), anchor = bid khởi tạo.
     Vẫn áp các ràng buộc cứng.
   - Xóa lỗi TARGET_CREATION_REQUIRES_LATER_STEP.
d) Engine cho phép đổi targetEntities[id].status (R13 PAUSE). Vẫn cấm ghi trực tiếp bidMicros.
e) Bất biến mới (src/invariants/target.ts), chạy sau mọi decision và sau mỗi lần ghi theo giờ:
   - $0.20 ≤ bid gửi lên ≤ Bid_max ở mọi giờ.
   - bid gửi lên × (1 + ToS/100) ≤ 1.5 × Bid_max ở mọi giờ.
   - Mỗi target có tối đa 1 lần ghi baseBid mỗi run.
   - tagReductionFactor ∈ [0.70, 1].
   - Target có wasteFlag đang hiệu lực không bao giờ bị R14 tăng bid.
   - Target PAUSED không nhận cập nhật theo giờ.
   - Không có keyword hoặc negative trùng (chuẩn hóa text).
   - Không có Negative Exact nguồn nào từ R15 khi Exact đích chưa được xác minh tồn tại.

# 3. CỬA SỔ (dùng resolveWindow; windowStartAt là của chính target)
- R10: W14 rolling lịch (không cắt theo reset) có ≥3 đơn, ACoS ≤ T_win; VÀ W_post ≥ 3 ngày chín,
  ≥ 15 click, ACoS ≤ T_win.
- R11, R12: W_post (R11 tối đa 30, R12 tối đa 14), minRipeDays = 1 (cổng là số click).
- R13: W14 rolling lịch. "Click sau R12" = tổng click từ ngày r12LastAt (tính cả ngày đó) đến D-2,
  và phải 0 đơn trong khoảng đó.
- R14: W7 rolling lịch, yêu cầu đủ 7 ngày fact của target.
- R15/R16/R17: W14 rolling lịch theo fact search term.
- R18/R19: W14 post tính từ lastChangeAt.placement của campaign (null thì từ createdAt), tối đa 14,
  minRipeDays 7 (flag ambiguity.placementWindow = 'post14-min7').
- R20/R21: 28 ngày hourly kết thúc D-2.
- Điều kiện "0 đơn" của R12, R13, R16, R17 phải thỏa zeroOrdersRobust trên entity tương ứng.

# 4. RULE TARGET (src/rules/target/*.ts) — thứ tự R13 > R12 > R11 > R10 > R14
R13: W14 ≥ N3 click, 0 đơn, spend ≥ 2×CPA_target, và một trong hai:
     (r12Count ≥ 1 và từ r12LastAt có ≥ N2h click mà 0 đơn) hoặc base ≤ floor.
     Hành động: status PAUSED (vĩnh viễn), notify R13_PAUSED. Không có rule nào tự bật lại.
R12: W_post ≥ N2 click, 0 đơn. Nếu base ≤ floor thì trả null (để R13 xử lý).
     Hành động: base = max(floor, base×0.8), wasteFlagUntil = today+14, r12Count+1, r12LastAt=now.
     Cooldown 5 ngày (registry).
R11: W_post ≥ 15 click, ≥ 1 đơn, ACoS > T_ok → base × max(T_ok/ACoS, 0.8), không dưới floor.
     ACoS infinite (có đơn, sales $0) thì dùng 0.8.
R10: campaign NORMAL; điều kiện ở mục 3 → base × 1.10, không vượt min(Bid_max, 2×anchor).
R14: campaign NORMAL, wasteFlag hết hạn, lowImpressionFlag hết hạn, W7 < 100 impression,
     base < min($0.75, Bid_max), KHÔNG (W7 ≥ N2h click và 0 đơn), r14Count < 3, và ≥ 7 ngày từ
     r14LastAt → base × 1.15, r14Count+1, r14LastAt=now.
     Sau lần thứ 3: lowImpressionFlagUntil = today+30. Khi cờ này hết hạn thì r14Count = 0
     (flag ambiguity.r14CountResetAfterFlag = true).
Chỉ target ENABLED. Campaign PAUSED thì bỏ qua cả nhóm.

# 5. RULE SEARCH TERM (src/rules/searchTerm/*.ts) — thứ tự R15 > R16 > R17
Đối tượng: (sourceCampaignId, sourceTargetId, query chuẩn hóa), đọc fact `${targetId}:search:${query}`.
Scenario và entity cần thêm:
- ScenarioTarget.matchType cho KEYWORD ('EXACT'|'PHRASE'|'BROAD', mặc định 'EXACT' để giữ tương
  thích ngược). Runner không được ép mọi keyword thành EXACT nữa.
- ScenarioCampaign.harvestDestinationCampaignId (tùy chọn). Nếu thiếu thì dùng campaign MANUAL đầu
  tiên cùng ASIN; nếu không có thì R15 trả null với reason 'NO_DESTINATION'.
- EngineState.negatives: Record<campaignId, NegativeKeyword[]>; và pendingHarvests.
R15 (Chủ Nhật PT): nguồn là target AUTO hoặc KEYWORD PHRASE/BROAD (bỏ qua EXACT); W14 ≥ 2 đơn,
  ACoS ≤ T_ok; Exact cùng text chuẩn hóa chưa tồn tại ở campaign đích (bất kỳ status nào).
  Hành động 2 pha, KHÔNG atomic, đúng spec:
  (i) Tạo keyword EXACT ở campaign đích. bid = CPC trung bình 14 ngày của search term, kẹp
      [$0.20, Bid_max]; anchor = bid đó. Ghi qua port createKeywords. Lưu
      pendingHarvests[{query, sourceCampaignId, destCampaignId, keywordId, createdAt}].
  (ii) Xác minh bằng listKeywords. CHỈ khi thấy keyword thì mới createNegatives Negative Exact ở
      campaign nguồn, rồi xóa khỏi pendingHarvests. Nếu chưa thấy: giữ pending, runner kiểm tra
      lại ở MỖI run sau (không chờ Chủ Nhật), tối đa 7 ngày. Quá hạn thì notify
      R15_VERIFY_TIMEOUT và KHÔNG thêm negative.
  Nếu bước (i) lỗi thì không có pending và không có negative.
R16: W14 ≥ N3 click, 0 đơn → Negative Exact ở campaign nguồn.
R17: W14 spend ≥ 2.5×CPA_target, ≥ N17 click, 0 đơn → Negative Exact ở campaign nguồn.
Ngoại lệ R16/R17: query trùng (chuẩn hóa) một keyword EXACT đang ENABLED cùng ASIN thì không
  negative (reason 'EXACT_KEYWORD_EXISTS', để R12/R13 xử lý). Luôn kiểm tra trùng negative trước.

# 6. PLACEMENT (src/rules/placement/*.ts) — R19 > R18, cooldown 7 ngày
Đọc fact cấp campaign có placement TOP / REST_OF_SEARCH.
R18: campaign NORMAL; TOP ≥ 30 click, ≥ 3 đơn; CVR_top ≥ 2 × CVR_rest (nếu REST < 30 click thì so
  với CVR toàn campaign trong cùng cửa sổ); ACoS_top ≤ T_win; kiểm tra trần ToS (mục 2a)
  → ToS + 10 điểm (tối đa 100).
R19: TOP ≥ 20 click, ACoS_top > T_bad (infinite cũng tính), spend_top ≥ 2×CPA_target, ToS > 0
  → ToS − 20 điểm (tối thiểu 0).
Ghi qua port updatePlacement.

# 7. THEO GIỜ (src/rules/hourly/*.ts)
- Phân tích tuần: config.hourlyAnalysisWeekday (mặc định 1 = thứ Hai PT), chạy ở run ngày đó.
- Phạm vi thống kê: ambiguity.hourlyScope = 'campaign' (mặc định): thống kê giờ H và CVR campaign
  ở cấp campaign, áp hệ số cho mọi target ENABLED của campaign. 'target' thì thống kê riêng từng
  target.
- R20: giờ H ≥ 40 click và CVR_H < 0.5 × CVR_campaign → hệ số 0.70, nhưng bid giờ đó không dưới
  max($0.20, 0.5×base) (tức hệ số = max(0.70, 0.20/base)).
- R21: campaign NORMAL, giờ H ≥ 40 click, ≥ 2 đơn, CVR_campaign > 0, CVR_H ≥ 1.3 × CVR_campaign
  → hệ số 1.15, kẹp để base × hệ số ≤ Bid_max và thỏa trần ToS.
- R20 xét trước R21 cho từng giờ. Giờ không thỏa thì hệ số = 1.0.
- Phân tích tuần chỉ ghi bảng hourlyFactor vào memory. Không reset window, không cooldown,
  không tính là đổi baseBid.
- R21B ở MỖI ranh giới giờ PT (theo UTC instant, nên giờ lặp DST được xử lý một lần cho mỗi
  instant): bid gửi lên = roundBidToCent(base × hourlyFactor[giờ mới]).
  - Campaign không NORMAL: hệ số > 1 được coi là 1.0.
  - Bỏ qua target PAUSED.
  - Chỉ những target có bid gửi lên khác giờ trước mới được ghi. Gom thành ĐÚNG 1 lệnh
    updateTargets cho mỗi endpoint mỗi ranh giới, và không gọi gì nếu không có thay đổi.

# 8. RUNNER (mở rộng src/runner/campaignLoop.ts → runAccountLoop; giữ runCampaignLoop chạy được)
Run hằng ngày ở runHour theo thứ tự:
1. manualEdit / R01;
2. budgetByDate;
3. tracker R09;
4. CAMPAIGN;
5. PLACEMENT;
6. TARGET (áp chính sách mục 1);
7. kiểm tra lại pendingHarvests;
8. SEARCHTERM;
9. phân tích theo giờ (nếu đúng ngày).
Mỗi giờ: R21B, rồi market step với EntityView dùng bid gửi lên của giờ đó.
Mọi ghi đều qua FaultyFakePort.
Market (MarketDriver) cần biết:
- Target mới do R15 tạo. Sự thật ngầm suy ra từ target nguồn và search term:
  trueCvr = src.trueCvr × term.cvrMultiplier, ctr = src.ctr, clearingPrice/priceSpread = src,
  baseImpressionsPerDay = src.baseImpressionsPerDay × term.weight / tổng weight,
  searchTerms = [{query, weight 1, cvrMultiplier 1}].
- Negative Exact: query bị negative ở một campaign thì bị loại khỏi phân phối search term của mọi
  target trong campaign đó. Impression giảm theo đúng phần weight bị loại.
  Đây là mô hình cannibalization tối thiểu cho E6.
ScriptedMarket mở rộng để test golden: script ngày có thể chỉ định riêng từng target, placement,
search term và phân phối theo giờ. Thiếu chỉ định thì giữ hành vi cũ.

# 9. TEST BẮT BUỘC
A. Unit test từng rule R10–R21B: khớp; dưới ngưỡng; bị chặn bởi tag/cooldown/cờ/lịch; no-op ở biên
   (R12 ở sàn, R10 ở Bid_max hoặc 2×anchor, R18 ở 100% hoặc chạm trần ToS, R19 ở 0%).
B. Golden spec Phần 10 "Từ khóa không ra đơn" ($30/BE 40%):
   - Target 0 đơn đủ N2 click → R12 −20% và cờ lãng phí.
   - Thêm ≥ N2h click vẫn 0 đơn, đủ 30 click và spend ≥ $16.80 trong 14 ngày → R13 PAUSE.
   - Assert ngày chính xác bằng ScriptedMarket. Comment ghi phép tính tay.
C. Edge case:
   - B4: R07 và R11 cùng ngày trên một target. R07 áp dụng, R11 'SKIPPED_CROSS_LEVEL'.
     R11 chạy ở ngày hợp lệ kế tiếp. Không run nào đổi base quá ±20%.
     Với policy 'error' thì có ERROR CROSS_LEVEL_BID_CONFLICT.
   - B5: target có cờ lãng phí ở sàn, ít impression → không bao giờ bị tăng bid trong 30 ngày.
   - C1: R07 + R11 + R12 + R20 chồng lên nhau → bid gửi lên ≥ $0.20 mọi giờ.
     Log mức giảm tích lũy so với anchor.
   - C4: priceChange giữa chừng làm Bid_max < 0.5×anchor → không crash, không gửi bid ngoài
     [$0.20, Bid_max], có cảnh báo.
   - C5: R18 tăng ToS, sau đó R10 và R21 → trần ToS không bao giờ bị vượt; R18 trả 'TOS_CAP' khi
     không còn chỗ.
   - D3: CVR_rest = 0 với ≥ 30 click → R18 vẫn đánh giá đúng công thức (ghi rõ trong README).
     Đơn có sales $0 → ACoS infinite xử lý đúng ở R11/R19.
   - E1: scenario api-chaos với createSucceedsButInvisible → R15 không thêm negative khi chưa
     xác minh, thêm đúng 1 lần sau khi thấy keyword; biến thể timeout → không có negative,
     có notify.
   - E5: R16 chạy lại nhiều tuần → không có negative trùng. Query trùng keyword EXACT đang chạy
     → không negative.
   - R21B: số lệnh updateTargets theo giờ = số ranh giới có thay đổi (đếm trong port call log).
     Chạy qua 2026-11-01 (DST) không gọi trùng và không bỏ sót.
D. Scenario mới scenarios/full-account.json, 60 ngày, seed cố định:
   - 1 campaign AUTO (nguồn) với search term: 1 term tốt để harvest, 1 term rác để R16/R17.
   - 1 campaign MANUAL (đích) với các keyword: 1 winner, 1 bleeder 0 đơn, 1 ít impression.
   - Smoke test: không vi phạm bất biến nào; bleeder bị R12 rồi R13; term rác bị negative;
     term tốt được harvest vào Chủ Nhật và negative nguồn chỉ thêm sau khi xác minh;
     target ít impression được R14 tăng ≤ 3 lần.
   - Nếu có kỳ vọng nào không đạt: DỪNG và báo cáo kèm số liệu. KHÔNG chỉnh rule cho test pass.
     Chỉ được chỉnh scenario khi giải thích được rằng scenario không tạo ra điều kiện cần.

# 10. CLI
npm run sim -- scenarios/full-account.json --rules all --out out/full-account
→ decisions.jsonl, audit.jsonl, notifications.jsonl, port-calls.jsonl, timeline.md. Timeline có
thêm cột target/search term/ToS, và một mục tổng kết theo target: bid đầu, bid cuối, trạng thái.

# TIÊU CHÍ CHUNG
- npm run typecheck và npm test pass. Test cũ (kể cả golden B1–B5 Bước 3) phải pass không đổi
  kỳ vọng. Nếu buộc phải đổi thì giải thích trong README.
- README: thêm phần Bước 4 (chính sách xung đột, thứ tự run, mô hình negative/harvest trong market,
  bảng ambiguity mới, timeline golden "từ khóa không ra đơn", kết quả smoke full-account).
Kết thúc: liệt kê file mới/đã sửa, kết quả npm test, timeline.md của full-account (tóm tắt), số
lệnh API theo loại, và mọi SPEC-AMBIGUITY mới.
```
