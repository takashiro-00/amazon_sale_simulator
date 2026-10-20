# PROMPT 3 — Engine + nhóm Campaign R01–R09 (Bước 3/5)

```text
# BỐI CẢNH
./simulator đã xong Bước 1 (domain, G1–G8, engine first-match-wins, cooldown theo rule) và
Bước 2 (market model, reporting bitemporal, FaultyFakePort, scenario, CLI).
Spec là nguồn sự thật: docs/simulator/spec-v3.1.md (đọc kỹ Phần 2, 3, 4, 10).
Edge case: docs/simulator/00-roadmap-and-edge-cases.md (mục B1, B3, B6).
Bước 3: cài logic R01–R09 và một vòng lặp chạy theo ngày, tối thiểu, đủ để chạy golden test.
Chưa cài R10–R21B (vẫn trả null). Chưa xử lý lỗi API nâng cao (Bước 5).
Chỉ sửa trong ./simulator. Không thêm dependency. TDD: viết test trước rồi mới cài.
Rule là hàm THUẦN: chỉ đọc RuleContext, trả Proposal | null. Không I/O, không Date.now.

# 1. ĐỌC SỐ LIỆU CHO RULE (src/data/metrics.ts)
MetricsReader(factIndex, asOf, config) — mọi truy vấn đều qua queryFacts với asOf = clock.now().
Không rule nào được nhìn thấy fact có knownAt > now.
- campaignWindow(campaignId, window: ResolvedWindow) → { impressions, clicks, spendMicros, orders,
  salesMicros, acos: Acos, daily: Array<{date, orders, spendMicros, clicks}> }.
  Đọc fact cấp campaign: entityRef = campaignId, daily, không placement, không hour.
- hasOrdersInLookback(campaignId, days=30, today): có đơn trong [D-2-29, D-2] theo lịch.
  Không bị cắt bởi lần reset.
- Ngày thiếu fact: tính là thiếu dữ liệu. Rule dựa vào "0 đơn" phải coi thiếu dữ liệu là
  không đủ điều kiện (theo ambiguity.missingZeroOrderDays đã có).
- Điều kiện "0 đơn" của R05B, R06, R08 phải đồng thời thỏa zeroOrdersRobust (G2).

# 2. MỞ RỘNG CONTEXT VÀ STATE
- RuleContext thêm:
  metrics: MetricsReader;
  thresholdsByCampaign: Record<campaignId, DerivedThresholds>;
  today: MarketplaceDate;
  notify(event).
  Giữ thresholds theo target cho G6.
- CampaignMemory thêm (cập nhật createCampaignMemory và assertStateInvariants):
  budgetByDate: Record<MarketplaceDate, Micros> (runner ghi mỗi ngày, giữ 35 ngày gần nhất)
  createdAt: Instant
  bidRestorePending: boolean
  lastR09CheckDate: MarketplaceDate | null
- TargetMemory dùng sẵn tagReductionFactor (≥ 0.70) để theo dõi phần giảm do tag.
- NotificationLog: { at, campaignId, type: 'R06_PAUSED'|'R06B_PAUSED'|'R08_ALERT'|
  'PRODUCT_INFEASIBLE', details }.

# 3. CỬA SỔ (dùng resolveWindow có sẵn, KHÔNG viết lại)
- Thêm option minRipeDays vào resolveWindow (mặc định = days, giữ hành vi cũ).
- R02, R03, R04, R05, R08: W3 rolling, cần đủ 3 ngày chín sau lần đổi gần nhất của campaign.
- R04B, R07, R09: W7 rolling, cần đủ 7 ngày chín.
- R06: W_post tối đa 14 ngày, minRipeDays = 1 (không cần đủ 14 ngày).
- R06B bước 1: W14 theo ambiguity.r06bWindow (mặc định 'calendar14' = 14 ngày lịch kết thúc D-2,
  không cắt theo reset). Bước 2: W7 post kể từ bước 1, cần đủ 7 ngày chín.
- windowStartAt của campaign chỉ reset khi budget hoặc placement của campaign đổi (engine đã làm),
  hoặc khi R01 chạy.

# 4. LỊCH CHẠY
- daily: R01–R06B. every3Days: R07, R08, R09.
- Thêm config.every3DaysAnchorMode: 'campaign-created' | 'global' (mặc định 'campaign-created':
  chạy vào ngày createdAt + 3k theo lịch PT). 'global' dùng every3DaysAnchor sẵn có.
- Rule không đến lịch ghi audit NOT_SCHEDULED và bị bỏ qua.

# 5. LOGIC TỪNG RULE (src/rules/campaign/*.ts, mỗi rule một file)
Gọi T = thresholdsByCampaign[c]. "budget $X" nghĩa là đặt budgetTierIndex tương ứng trên thang
và dailyBudgetMicros khớp. Mọi thay đổi tag phải cập nhật campaign.name bằng applyTag hoặc
removeTag (G7) và memory.tag, giữ hai nơi luôn khớp nhau.

R01 (daily; chỉ rule này chạy cho campaign chưa có memory hoặc vừa được user bật lại):
  - Phát hiện: campaign chưa có memory, hoặc status chuyển PAUSED → ENABLED do user
    (manualEdit). Hệ thống KHÔNG BAO GIỜ tự đặt ENABLED cho campaign PAUSED_AUTO. Việc user bật
    lại trên console được coi là "xác nhận".
  - Hành động: budget $5, tag NORMAL (gỡ tag trên name), xóa preTagTier, baselineAcos, taggedAt,
    r06bPhase=NONE, r09ConsecutivePasses=0, bidRestorePending=false; startGrace(); reset window.
R02/R03/R04 (NORMAL; W3; ACoS < T_ok):
  R02: budget $5 và ≥1 đơn → $8. R03: $8 và ≥2 đơn → $10.
  R04: $10 và cả 3 ngày đều có ≥1 đơn → $12.
  Ghi baselineAcos = ACoS W3.
R04B (NORMAL; budget ≥ $12; W7): spendMicros ngày ≥ 90% budgetByDate của chính ngày đó ở ≥ 5/7
  ngày; ≥5 đơn; ACoS < T_win → budgetMultiplyStep (đã có). Ghi baselineAcos = ACoS W7.
  Ở $25 thì no-op.
R05 (budget > $5; W3): A) ≥1 đơn và ACoS ≥ T_bad → stepDown 1 bậc.
  B) 0 đơn (robust) và spend ≥ min(CPA_target, 0.6×Spend_zero) → $5.
R06 (W_post ≤14, minRipe 1): 0 đơn (robust) và [(spend ≥ Spend_zero và clicks ≥ N2) hoặc
  spend ≥ min(2.5×Spend_zero, $63)] → status PAUSED, budget $5, tag PAUSED_AUTO (name không chứa
  [MANAGE]/[ALERT]), requiresUserConfirmToEnable=true, pausedAutoReason='R06', notify R06_PAUSED.
R06B:
  Bước 1 (r06bPhase NONE, campaign ENABLED): W14 có ≥1 đơn, spend ≥ Spend_zero, ACoS > 1.5×BE.
    - Lưu preTagTier nếu chưa có. Nếu đã có thì chỉ ghi đè khi ambiguity.r06bOverwritesPreTagTier.
    - Tag MANAGE, trừ khi đang ALERT (giữ ALERT); taggedAt nếu tag mới.
    - Budget $5.
    - Bid −20% mọi target ENABLED của campaign: tagReductionFactor ×0.8 nhưng không dưới 0.70.
      Nếu chạm sàn thì chỉ giảm phần còn được giảm.
    - r06bPhase=STEP1_WAITING, r06bStep1At=now.
  Bước 2 (STEP1_WAITING, đã ≥ 7 ngày lịch từ r06bStep1At và W7 post eligible):
    - Nếu ACoS W7 > 1.5×BE thì PAUSE như R06 (tag PAUSED_AUTO, reason 'R06B', notify R06B_PAUSED,
      r06bPhase=DONE).
    - Nếu không, r06bPhase=DONE và giữ tag. Đây là thay đổi memory-only nên phải được tính là
      "khớp" (memory đổi giá trị).
R07 (every3Days; NORMAL; W7 ≥1 đơn, ≥10 click): ACoS_W7 > max(1.1×base, T_win), với
  base = min(baselineAcos ?? T_ok, T_ok). Hành động:
    - Tag MANAGE, taggedAt=now, preTagTier = tier hiện tại.
    - Budget = min(hiện tại, $8).
    - Bid −10% một lần cho target ENABLED (tagReductionFactor ×0.9, sàn 0.70).
    - r09ConsecutivePasses=0.
R08 (every3Days; tag ≠ ALERT, ≠ PAUSED_AUTO; W3): 0 đơn (robust), spend ≥ 0.6×Spend_zero,
  hasOrdersInLookback 30 ngày.
    - Gắn ALERT (thay MANAGE), budget $5.
    - preTagTier = tier hiện tại nếu đang NORMAL; nếu đang MANAGE thì giữ nguyên preTagTier.
    - taggedAt=now nếu từ NORMAL; nếu từ MANAGE thì giữ taggedAt cũ.
    - notify R08_ALERT. Không đổi bid. r09ConsecutivePasses=0.
R09 (every3Days; không chạy trong grace):
  Tracker (src/rules/campaign/r09Tracker.ts): chạy mỗi ngày R09 đến lịch, TRƯỚC firstMatchWins,
  cho campaign MANAGE. Nếu W7 eligible, ≥1 đơn và ACoS_W7 ≤ max(base, 0.9×T_win) thì
  r09ConsecutivePasses += 1; ngược lại = 0. Ghi lastR09CheckDate. Tracker không phải decision
  và không chiếm lượt G5.
  Gỡ MANAGE: passes ≥ 2 và tag tồn tại ≥ 6 ngày lịch.
  Gỡ ALERT: W7 có ≥2 đơn và ACoS ≤ T_ok.
  Hành động gỡ:
    - Tag NORMAL, gỡ tag trên name.
    - Budget theo ambiguity.r09BudgetRestore (mới, mặc định 'pre-tag-tier'): đặt về preTagTier
      (không vượt). 'keep-current' thì giữ nguyên.
    - preTagTier=null, baselineAcos = ACoS W7, taggedAt=null, r09ConsecutivePasses=0.
    - bidRestorePending = (có target nào tagReductionFactor < 1).
  Khôi phục bid (R09 khi NORMAL và bidRestorePending, đúng lịch every3Days):
    - Mỗi target có tagReductionFactor f < 1: f' = min(1, f×1.10), baseBid ×= f'/f, qua G6.
      Không đụng phần thay đổi của R11/R12.
    - Khi mọi f = 1 thì bidRestorePending=false.
  R09 trên campaign MANAGE chưa đủ điều kiện thì trả null (tracker đã cập nhật counter).
Mọi decision cấp campaign có ghi bid target đều đi qua engine. Engine áp G6 qua clampBid và
đặt cooldown/reset theo Bước 1.

# 6. VÒNG LẶP NGÀY TỐI THIỂU (src/runner/campaignLoop.ts)
runCampaignLoop({ scenario | scriptedMarket, days, config, runHour = 0 }) → { state, audit,
notifications, decisions, facts, timeline }.
- Mỗi giờ marketplace: nếu là runHour thì chạy rule TRƯỚC khi chạy market giờ đó. Với
  changeDayCountsAsPost=true, run 00:00 PT nghĩa là trước traffic.
- Thứ tự trong run: (1) áp manualEdit, phát hiện R01; (2) ghi budgetByDate[today];
  (3) chạy tracker R09; (4) với mỗi campaign (theo thứ tự id) chạy
  firstMatchWins(CAMPAIGN order); (5) áp decision vào EngineState; (6) ghi qua
  FaultyFakePort (cấu hình không lỗi) với idempotencyKey; (7) dựng EntityView cho market
  (budget, status, bid = submittedBid(base, hourlyFactor) / 1e6).
- Market có 2 lựa chọn:
  (a) MarketDriver của Bước 2;
  (b) ScriptedMarket (src/market/scripted.ts, implements MarketModel): nhận kịch bản theo ngày
      { clicks, spendUsd, orders, salesUsd } cho từng campaign, phân bổ đều vào giờ, lag 0,
      phát hành fact daily lúc D+1 03:00 PT (cùng quy ước Bước 2), có fact cấp campaign và
      target. Dùng cho golden test cần số liệu chính xác.
- timeline: danh sách { day (số ngày tính từ ngày 0), date, ruleId, before, after } để so sánh
  với spec.
- Sau mỗi decision chạy assertCampaignInvariants (mục 7). Vi phạm thì throw.

# 7. BẤT BIẾN CAMPAIGN (src/invariants/campaign.ts)
- Tag trên name khớp memory.tag; không tag kép (G7).
- PAUSED_AUTO ⇒ status PAUSED, budget $5, requiresUserConfirmToEnable.
- Budget luôn là một bậc trên thang; dailyBudgetMicros = ladder[budgetTierIndex].
- preTagTier ≠ null ⇔ tag ∈ {MANAGE, ALERT}.
- r06bPhase = STEP1_WAITING ⇒ tag ∈ {MANAGE, ALERT}. Nếu R09 gỡ tag khi đang STEP1_WAITING thì
  phải đặt r06bPhase=DONE trong cùng decision (edge case B3).
- tagReductionFactor mọi target ∈ [0.70, 1].
- Không decision nào xảy ra trên campaign đang trong grace cho rule thuộc GRACE_BLOCKED_RULES.

# 8. TEST BẮT BUỘC
A. Unit test từng rule (fixture fact viết tay, không dùng market). Mỗi rule có test:
   khớp; không khớp ngay dưới ngưỡng; bị chặn bởi tag/grace/cooldown/lịch; no-op ở biên
   (R04B ở $25, R05 ở $5).
B. Golden test bằng ScriptedMarket, sản phẩm $30/BE 40%/CVR 10%, campaign tạo ngày 0 = 2026-10-01:
   B1 "Campaign thắng" (spec Phần 10): kịch bản tiêu đủ budget mỗi ngày, ACoS 20%, mỗi ngày ≥1
      đơn và ≥1 đơn/ngày cho R04, ≥5 đơn/7 ngày cho R04B. PHẢI ra đúng: ngày 4 R02 $8, ngày 8 R03 $10,
      ngày 12 R04 $12, ngày 20 R04B $14.40, ngày 28 R04B $17.28, ngày 36 R04B $20.74.
      Không rule nào khác khớp.
   B2 "Campaign 0 đơn": $5/ngày, 5 click/ngày, 0 đơn. R06 PAUSE vào ngày đầu tiên thỏa
      điều kiện. Test assert đúng ngày đó (ghi ngày kỳ vọng tính tay trong comment, spec nói
      "khoảng ngày 7"). Có notify R06_PAUSED. Sau đó không rule nào chạy nữa. Campaign vẫn PAUSED
      đến hết 40 ngày.
   B3 "Xấu đi rồi hồi phục": như B1 đến $12, sau đó ACoS 40% (≥1 đơn/ngày), rồi trở lại 18%.
      Assert theo thứ tự:
      - R07 gắn MANAGE, budget $8, mọi target tagReductionFactor 0.9.
      - Không có R05 (40% < T_bad).
      - R09 gỡ tag sau 2 lần pass liên tiếp và tag ≥ 6 ngày, budget về $12 (preTagTier).
      - Sau đó R09 khôi phục bid +10% ở lần chạy every3Days kế tiếp cho tới f=1.
      Assert ngày cụ thể do code tính ra và ghi bảng timeline vào README.
   B4 "ALERT": như B1 đến $12, sau đó 0 đơn với spend ≥ $12.6/3 ngày.
      - R08 gắn ALERT, budget $5, notify R08_ALERT.
      - Nếu tiếp tục 0 đơn thì R06 PAUSE khi đủ điều kiện (window tính từ lần R08 đổi budget).
      Biến thể có hồi phục: ≥2 đơn/7 ngày, ACoS ≤ T_ok → R09 gỡ ALERT, budget về $12.
   B5 "R06B": ACoS 70% (> 1.5×BE = 60%) có đơn, spend ≥ $21/14 ngày.
      - Bước 1: MANAGE, $5, bid −20%.
      - Nếu vẫn 70%: bước 2 PAUSE (R06B_PAUSED).
      - Biến thể ACoS về 30% sau bước 1: r06bPhase=DONE, giữ MANAGE, R09 xử lý sau.
C. Edge case:
   - B1 roadmap (R05 cướp lượt R08): cùng kịch bản B4, chạy với every3DaysAnchorMode 'global'
     và anchor lệch 0/1/2 ngày. Test ghi lại (snapshot) mỗi biến thể có ALERT hay không, có R06
     hay không, ngày nào. Không assert mọi biến thể giống nhau. Ghi bảng kết quả vào README phần
     "phát hiện".
   - B3 roadmap: R09 gỡ tag khi r06bPhase=STEP1_WAITING → r06bPhase=DONE, bất biến không vỡ.
   - B6 roadmap: NORMAL $14.40 → R07 (preTagTier $14.40, budget $8) → R06B bước 1. Với
     r06bOverwritesPreTagTier=false thì preTagTier vẫn $14.40 và R09 khôi phục về $14.40. Với
     true thì về $8.
   - PAUSED_AUTO + manualEdit status ENABLED → R01 chạy (budget $5, NORMAL, grace). Không có
     manualEdit thì hệ thống không bao giờ tự bật lại.
D. Smoke test với MarketDriver + scenarios/golden-winner.json (ngẫu nhiên, 40 ngày, seed 42):
   không vi phạm bất biến, campaign không bao giờ PAUSED, đạt ≥ $12 trước ngày 25.
   Nếu không đạt thì DỪNG và báo cáo vì sao (số liệu W3/W7 ở các ngày then chốt).
   KHÔNG chỉnh scenario hay rule để test pass.

# 9. CLI
npm run sim -- scenarios/golden-winner.json --rules campaign --out out/golden-rules
→ ghi thêm decisions.jsonl, audit.jsonl, notifications.jsonl, timeline.md (bảng ngày | rule |
budget | tag).

# TIÊU CHÍ CHUNG
- npm run typecheck và npm test pass. Test cũ chỉ đổi kỳ vọng khi có giải thích trong README.
- README: thêm phần Bước 3 gồm mô hình runner, bảng quyết định cho mọi ambiguity mới
  (r09BudgetRestore, every3DaysAnchorMode, minRipeDays của R06), timeline của B1–B5, và bảng
  phát hiện edge case B1.
- Mọi lựa chọn khi spec mơ hồ phải có // SPEC-AMBIGUITY:.
Kết thúc: liệt kê file mới/đã sửa, kết quả npm test, timeline.md của golden-winner (smoke) và
của B1, bảng kết quả edge case B1, và mọi SPEC-AMBIGUITY mới.
```
