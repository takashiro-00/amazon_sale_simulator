# PPC Rule Simulator — Bước 2/5

Package offline độc lập, Node 20+, TypeScript strict + `noUncheckedIndexedAccess`, Luxon và Vitest. Không có Amazon adapter, credential, SDK, HTTP client hoặc truy cập mạng trong simulator. Rule vẫn là stub; Bước 2 bổ sung market model và fake API có lỗi. Không thay đổi `../bridge`.

## Chạy

```sh
cd simulator
npm install
npm run typecheck
npm test
```

`.npmrc` đặt cache npm trong package để tránh lỗi quyền ở cache toàn máy. Cache, `node_modules`, `dist` được ignore. Dependency runtime duy nhất là Luxon. `npm install` cần mạng để tải dependency; logic mô phỏng không dùng mạng.

## Cây thư mục và file đã tạo

```text
simulator/
├── .gitignore
├── .npmrc
├── package.json
├── package-lock.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── config/defaults.ts
├── src/
│   ├── domain/
│   │   ├── money.ts
│   │   ├── hash.ts
│   │   ├── params.ts
│   │   ├── acos.ts
│   │   ├── entities.ts
│   │   ├── state.ts
│   │   └── budgetLadder.ts
│   ├── time/clock.ts
│   ├── data/{facts,windows}.ts
│   ├── engine/{types,priority,cooldown}.ts
│   ├── guards/bid.ts
│   ├── api/{port,tags}.ts
│   ├── audit/log.ts
│   ├── rules/registry.ts
│   └── market/port.ts
└── test/
    ├── domain.test.ts
    ├── time-data.test.ts
    ├── guards.test.ts
    ├── engine.test.ts
    ├── api.test.ts
    └── offline.test.ts
```

## Mapping G1–G8

| Nguyên tắc | File |
|---|---|
| G1 ngưỡng theo ASIN, phiên bản | `domain/params.ts`, `domain/money.ts`, `domain/hash.ts`, `config/defaults.ts` |
| G2 dữ liệu chín, bitemporal | `data/facts.ts`, `data/windows.ts` |
| G3 reset, cooldown, grace | `engine/cooldown.ts`, `data/windows.ts` |
| G4 bộ nhớ, base bid, invariant | `domain/state.ts`, `domain/entities.ts` |
| G5 ưu tiên, audit, xung đột | `engine/priority.ts`, `engine/types.ts`, `audit/log.ts` |
| G6 giới hạn và làm tròn | `guards/bid.ts` |
| G7 port fake, tag, trùng lặp | `api/port.ts`, `api/tags.ts` |
| G8 lịch marketplace, DST | `time/clock.ts` |

Các đường dẫn trong bảng tính từ `src/`, trừ `config/defaults.ts`.

## Hợp đồng sử dụng

- `usd('30.00')` tạo số nguyên branded `Micros`; `toUsd()` trả chuỗi thập phân. Tỷ lệ là `number`, nhưng phép nhân tiền dùng phân số `bigint` rồi làm tròn sang micros. Không lưu tiền dưới dạng USD float.
- `deriveThresholds(params, config)` trả ngưỡng đóng băng và cảnh báo. `paramsVersion` là hash xác định của tham số và cấu hình ảnh hưởng ngưỡng, không dùng làm hash bảo mật.
- Override theo ASIN/scenario bằng cấu hình riêng, ví dụ `{ ...DEFAULT_CONFIG, product: { ...DEFAULT_CONFIG.product, expCvr: 0.08 } }`, rồi truyền cùng config cho các hàm. `ProductParams.expCvr` có ưu tiên cao hơn default.
- `Instant` là ISO có offset, `MarketplaceDate` là `YYYY-MM-DD`; đầu vào được kiểm tra ở các helper thời gian. Chỉ dùng IANA zone trong cấu hình. `SimClock` là đối tượng đồng hồ có trạng thái được truyền tường minh; `advanceHours()` là ngoại lệ có chủ đích đối với tính thuần, không đọc đồng hồ máy. Các hàm chuyển đổi/lịch đều thuần.
- Dùng `queryFacts(rawFacts, { asOf, entityRef, from, to })` trước khi tính số liệu. Hàm chọn restatement mới nhất theo entity/date/hour/UTC-bucket/placement, loại `knownAt` tương lai. Hai bản khác nhau cùng grain và cùng `knownAt` bị từ chối. Không cộng lẫn aggregate ngày và các bucket giờ của cùng ngày. `zeroOrdersRobust()` nhận snapshot đã query cho một entity; cả D-3 và D-2 phải hiện diện và không có đơn.
- Fact theo giờ bắt buộc có `hourBucket` là đầu giờ UTC, cùng ngày/giờ PT với `hour`. Hai lần 01:00 khi DST kết thúc có UTC bucket khác nhau. Không suy ra một ngày luôn có 24 giờ; test kiểm tra đủ 23/25 bucket.
- `resolveWindow()` dùng ngày marketplace và maturity lag D-2. W_post dùng tối đa 30 ngày chín gần nhất sau thay đổi; không đủ ngày thì `eligible=false`. Kết quả là giới hạn lịch, không chứng nhận fixture có đủ coverage; kiểm tra coverage tại tầng dữ liệu/scenario sau này.
- Cooldown do rule vừa hành động đặt qua `cooldownSets`; `cooldownGate` chỉ xác định loại cooldown chặn rule kế tiếp. Engine stamp sau G6, bỏ qua no-op: budget khi dailyBudgetMicros hoặc budgetTierIndex đổi, bid chỉ cho target có baseBidMicros đổi, placement khi topOfSearchPct đổi. Thiếu loại trong cooldownSets dùng config.cooldown (bid 3, budget 2, placement 7) và ghi `DEFAULT_COOLDOWN_APPLIED`. R12 đặt bid 5 ngày, R14 bid 7, R04B budget 3; R06B đặt budget 2/bid 3, mốc bước 2 là r06bStep1At + 7 ngày ở bước sau.
- Rule ghi `TargetMemory.baseBidMicros` và `hourlyFactor`, không ghi `Target.bidMicros`. `submittedBid()` là giá trị outbound dẫn xuất; `assertStateInvariants()` kiểm tra công thức này. `targetEntities` giữ ảnh chụp API gốc, không phải bid sau decision.
- `firstMatchWins()` nhận danh sách **đã sắp thứ tự**, audit tất cả rule đã xét, chạy G6 với mọi base/hourly/ToS thay đổi liên quan, bỏ no-op sau cent rounding và chỉ nhận một decision cho mỗi object/group/run. Hàm không gọi port. Giữ chung `ctx.decisions` cho cả run để phát hiện xung đột hai chiều. Caller lấy `decision.after` làm state tiếp theo và gọi helper reset chỉ khi có thay đổi hiệu lực; chưa có orchestration thực thi rule trong bước 1.
- `clampBid()` ưu tiên giới hạn cứng ($0.20, Bid_max, ToS). Nếu bid cũ ngoài dải anchor, chỉ cho phép tiến về dải tối đa ±20%, kèm reason `OUTSIDE_ANCHOR_BAND_RECOVERING`; bước đi xa hơn trở thành no-op. Giới hạn cứng có thể buộc sửa vượt ±20%. Chỉ khi khoảng cứng không có giá trị cent hợp lệ mới trả `base=null`, `EMPTY_BID_RANGE`; engine ghi `ERROR` và từ chối decision.
- `AuditLog` chỉ append, clone sâu/đóng băng snapshot, serialize JSONL bằng `serializeJSONL()`; caller tự quyết định lưu file. Audit chứa cấu hình, ngưỡng, thời điểm, before/after và `paramsVersion`.
- Mọi phương thức port nhận idempotency key; dùng `idempotencyKey(runId, entityId, ruleId)`. Fake scope key theo operation; retry cùng payload không tạo bản sao, thay payload với cùng key/operation bị từ chối. Batch được kiểm tra toàn bộ trước khi ghi. Check trùng theo campaign/adGroup, text lowercase/trim/gộp whitespace và match type. Caller có thể list trước create; fake kiểm tra lại khi create để chặn trùng.

## Quy ước đã chốt và metadata

- Thang budget theo Phần 3: $5 → $8 → $10 → $12 → $14.40 → $17.28 → $20.74 → $24.88 → $25. `budgetMultiplyStep()` ưu tiên các bậc đã chốt (đặc biệt $20.74 → $24.88); với giá trị ngoài thang, nhân 1.2, làm tròn cent rồi kẹp $25.
- `changeDayCountsAsPost=true`: giả định run chạy đầu ngày trước khi có traffic, nên ngày đổi là ngày đầu W_post. Với maturity D−2, tạo ngày 2026-10-01 lúc 06:00 PT thì W_post 3 ngày chưa đủ ngày 10-04, đủ ngày 10-05; reset ngày 10-05 thì chưa đủ ngày 10-08, đủ ngày 10-09.
- Registry có đủ metadata cho 24 ID: schedule, cooldownGate/cooldownSets, windowDays dạng {kind, days}, blockedByTag. W_post của R11 tối đa 30 ngày theo G2; R06/R12 tối đa 14. `evaluate()` vẫn luôn trả null.
- `weekly` mô tả đợt phân tích tuần của R20/R21; caller chọn ngày chạy vì spec không ấn định thứ, và áp hệ số theo khung giờ. `hourBoundary` chỉ đúng tại đầu giờ địa phương. Chưa có orchestration theo giờ trong Bước 1.
- `removeTag()` và `applyTag(name, 'NORMAL')` gỡ tag; `escalateTag()` chỉ chặn ALERT → MANAGE và chuẩn hóa để không có tag kép.

## Kiểm thử sửa review

`test/review.test.ts` thêm 29 case: ladder/multiplication (lỗi 1), bảng 24 rule (lỗi 2), gỡ và nâng tag (lỗi 3), bid recovery/no-op/khoảng cứng rỗng (lỗi 4), DST và chạy sớm (lỗi 5), golden lifecycle ngày 4/8 (lỗi 6). `test/engine.test.ts` thêm kiểm tra recovery qua engine.

Test cũ trong `guards.test.ts` và `engine.test.ts` được cập nhật vì dải anchor và bước ±20% là ràng buộc mềm; fixture lỗi cứng nay dùng ToS khiến trần nhỏ hơn $0.20. `time-data.test.ts` đổi mặc định ngày post sang true và kiểm tra `elapsed-24h` bằng override tường minh. Các thay đổi kỳ vọng này phản ánh quyết định đã chốt trong review.

## Các điểm SPEC-AMBIGUITY

Mỗi mục dưới đây có comment `// SPEC-AMBIGUITY:` tại nơi áp dụng:

| Vị trí | Flag / hành vi mặc định |
|---|---|
| `src/data/windows.ts` | `changeDayCountsAsPost=true`: tính ngày xảy ra thay đổi là ngày đầu W_post |
| `src/data/facts.ts` | `repeatedHourPolicy='require-utc-bucket'`: phân biệt giờ DST lặp |
| `src/data/facts.ts` | `missingZeroOrderDays='ineligible'`: thiếu ngày không chứng minh được zero orders |
| `src/engine/priority.ts` | `tagRulesGatedByCooldown=false`: R07/R08/R09 không gate vì đã có lịch mỗi 3 ngày; bật true để gate budget. R06 không gate cooldown. |
| `src/engine/cooldown.ts` | `windowResetScope='entity'`: scope khác cần hierarchy, báo lỗi thay vì tự suy diễn |
| `src/engine/priority.ts` | `emptyBidRangePolicy='reject-decision'`: khoảng cứng rỗng trả null và không được thực thi |
| `src/engine/priority.ts` | `crossLevelBidPolicy='error'`: mọi xung đột base bid campaign/target bị audit lỗi; merge để Bước 4 |
| `src/guards/bid.ts` | `tosCapIncludesHourly=true`: cap gồm hourly factor |
| `src/rules/registry.ts` | `registryIds='all-explicit'`: giữ **24 ID**, vì 22 trong spec mâu thuẫn danh sách R01–R21 + R04B/R06B/R21B |

Các flag đã khai báo nhưng chưa có consumer vì không có rule logic: `r06bWindow='calendar14'`, `anchorResetPolicy='never'`, `r06bOverwritesPreTagTier=false`. Các lựa chọn merge của `crossLevelBidPolicy` chỉ được dành chỗ, chưa được thực thi.

Cooldown lưu bằng ngày marketplace PT: CampaignMemory.cooldownUntil.{budget,placement} và TargetMemory.bidCooldownUntil. Đổi ngày D, chờ 3 ngày thì bị chặn D+1/D+2, được chạy từ D+3, kể cả qua DST. Không còn chế độ elapsed-24h hoặc TargetMemory.cooldownDays.

Engine gọi applyResetOnEffectiveChange sau thay đổi thực sự để cập nhật windowStartAt và timestamp audit (lastBidChangeAt của target, lastChangeAt của campaign). Rule tự sửa cooldown/window/timestamp do engine quản lý bị ERROR RULE_WROTE_ENGINE_FIELD và không tạo decision. No-op không stamp hoặc reset. assertStateInvariants kiểm tra ngày hết cooldown target và campaignMemory nếu được truyền vào.

Test cũ được cập nhật vì reset không còn tự suy ra cooldown từ timestamp; fixture phải cung cấp expiry. Test elapsed-24h được thay bằng ngày lịch PT theo mô hình mới. Metadata của đủ 24 rule kiểm tra gate/sets mới; evaluate() của mọi rule vẫn trả null. startGrace() tiếp tục dùng khi tạo/bật lại campaign, độc lập với cooldown.

## Bước 2 — thị trường, attribution và API có lỗi

```text
Scenario JSON → validator → entityView (bid/budget tĩnh + manualEdit)
                              ↓ mỗi bucket UTC, lịch ngày PT
                 MarketDriver.step(hourInstant, entityView)
                    ↓                       ↓
          Poisson impression → click    spendByCampaign (micros/giờ)
                    ↓
          placement + search term + sổ đơn/return
                    ↓
          Reporter → FactSink.append (append-only)
                    ↓
          daily D+1 03:00 PT … D+14 / hourly end+1h + restatement
                    ↓
          queryFacts(asOf) → version mới nhất đã biết của mỗi khóa

InMemoryFakePort ← FaultyFakePort (seed + SimClock + apiFault)
                         ↓
               port-calls.jsonl cho Bước 5
```

Chạy bằng TypeScript compiler và Node, không cần runtime TypeScript hay dependency mới:

```sh
npm run typecheck
npm test
npm run sim -- scenarios/golden-winner.json --out out/golden
```

`facts.jsonl` chứa fact ngày và giờ cho target, campaign, placement và search term. Search term dùng `entityRef = <entityId>:search:<query>`. Campaign là tổng target; không cộng đồng thời các cấp hay các placement vào tổng. `hourBucket` là UTC, phân biệt hai lần 01:00 PT ngày fall-back. Ngày spring-forward không tạo giờ giả. `budgetCapped` đánh dấu bucket bị chặn; giờ làm cạn budget vẫn có phần traffic đã mua được. Chi phí dùng integer micros, CPC từng click không vượt bid gửi lên. `out/` và `dist/` được ignore.

`summary.json` chứa `trueTotals` trước trả hàng, `netOrders` sau trả hàng và tổng daily đã biết ở D+1/2/3/7/14 lúc 03:00 PT, với D là ngày cuối cùng của scenario. Đơn $0 vẫn tính orders. `port-calls.jsonl` ghi cả setup, manual edit, read probe và lỗi. CLI khởi tạo console trước khi bật lỗi; manual edit là thao tác console, luôn áp dụng được. CLI chưa retry hay thực hiện bất kỳ action rule nào; các lỗi read được ghi log. `evaluate` vẫn trả `null`; chưa có orchestrator Bước 5.

### Viết scenario

Sao chép một JSON trong `scenarios/` rồi chỉnh `seed`, `startDate` (YYYY-MM-DD), `days`, `marketplace: {id: "US", zone: "America/Los_Angeles"}`, danh sách `products` và `campaigns`. Product có `asin`, `priceUsd`, `breakEvenAcos`, `expectedCvr` (mặc định 0.1). Campaign có `id`, `asin`, `type` AUTO/MANUAL, `budget` USD, `topOfSearchPct` điểm phần trăm, `status`, `name`, `targets`. Target có `id`, `kind`, `text`, `bid` USD, `status` và các tham số sau:

| Tham số sự thật ngầm | Ý nghĩa / miền |
|---|---|
| `trueCvr` | Xác suất đơn cơ sở, [0,1]; 0 hợp lệ cho zero-order |
| `ctr` | Xác suất click mỗi impression, [0,1] |
| `clearingPrice` | Median giá cạnh tranh, USD ≥ 0 |
| `priceSpread` | Độ rộng logistic giá, USD > 0 |
| `baseImpressionsPerDay` | Nhu cầu traffic ở winRate=1, ≥ 0 |
| `hourlyTrafficCurve` | 24 trọng số theo giờ PT, không âm, tổng 1 |
| `topCvrMultiplier` | Hệ số CVR TOP, ≥ 0; CVR cuối kẹp 1 |
| `searchTerms` | `{query, weight, cvrMultiplier}`, tổng weight > 0 |

`attribution.lagDistribution` là object lag ngày 0…14 → xác suất (tổng 1); `returnLagDays` mặc định 7, nguyên 0…14. `returnRate`, `hourlyNoise`, `overspendTolerance`, `couponZeroSalesRate` mặc định 0. Validator không ép kiểu và báo đường dẫn như `campaigns[0].targets[0].trueCvr`.

Events là union có trường `type`:

- `seasonality`: `from`, `to`, `multiplier`, tùy chọn `lagMultiplier`.
- `attributionStorm`: `from`, `to`, `lagDistribution`, ghi đè trong khoảng `[from,to)`.
- `priceChange`: `at`, `asin`, `priceUsd`, tùy chọn `breakEvenAcos`. `productAt` trả thresholds và `paramsVersion` qua G1 của Bước 1.
- `manualEdit`: `at`, `entityId`, `field` bid/budget/status/name, `value`; áp dụng từ bucket kế tiếp.
- `apiFault`: `from`, `to`, `fault`; cấu hình như `apiFault` cấp scenario.

Timestamp event phải có offset UTC. `apiFault` hỗ trợ `rateLimit: {probability, retryAfterSeconds, windows: [{from,to,retryAfterSeconds}]}`, `serverError: {probability}`, `partialBatch: {probability}`, `staleReadMinutes` và `createSucceedsButInvisible` (phút). `FaultyFakePort` nhận một `Clock` và cấu hình hoặc callback; truyền `() => eventContext(scenario, clock.now()).apiFault` để timeline lỗi có hiệu lực. Lỗi 429/5xx xảy ra trước ghi. Batch fault chọn từng item thất bại ở xác suất 50%; item thành công đã commit. Retry cùng payload/key giữ các item đã thành công, chỉ thử phần còn thiếu; đổi payload/key cũ bị từ chối. InMemoryFakePort vẫn kiểm tra toàn batch trước ghi đối với lỗi validation, và trả `{id,ok}` cho từng item hợp lệ. Test Bước 1 giữ nguyên kiểm tra validation atomic; thêm test kết quả batch mới.

Sáu mẫu: golden-winner ($30, BE 40%, budget tĩnh $5), zero-order, attribution-storm (30% đơn trễ 3–7 ngày), budget-capped, dst-fallback (2026-11-01), api-chaos. Golden không tái hiện các lần tăng budget bởi rule ở Phần 10, vì đây là CLI thị trường tĩnh.

### Giả định và giới hạn

- Win rate logistic; impression kỳ vọng tăng đơn điệu theo bid. CPC là `bid × U(0.6,0.95)`, mô phỏng đấu giá đơn giản, không phải auction Amazon đầy đủ. ToS làm tăng tỷ trọng TOP theo `.15 + .7 × pct/(100+pct)`, trần .85; chưa tăng CPC riêng cho placement.
- Fork nhu cầu và attribution dùng seed + `target:${campaignId}:${kind}:${normalizeText(text)}` + UTC instant qua helper `targetRngKey`. `normalizeText` trim, gộp khoảng trắng và chuyển chữ thường. Đổi target ID hoặc cách viết hoa/khoảng trắng trong cùng campaign không đổi mẫu; cùng keyword ở hai campaign có mẫu độc lập từ cùng phân phối khi cùng sự thật ngầm. Thêm target không đổi mẫu tự nhiên của target cũ. Khi campaign hết budget, các target cạnh tranh cap chung nên traffic thực nhận có thể đổi; giờ có cap ràng buộc dùng fork campaign + giờ. Chưa mô phỏng cannibalization.
- Duyệt bucket theo thứ tự thời gian thật; calendar day và reset budget theo PT. Curve chuẩn hóa cho ngày 24h; ngày 23/25h giữ trọng số từng giờ, nên tổng nhu cầu có thể lệch ngày thường. Driver từ chối bước trùng hoặc lùi giờ.
- Cap dừng tại click cuối có thể mua; phần dư không đủ mua click kế tiếp được coi là cạn. Không tạo click phân số. Return không hoàn CPC.
- Lag N xuất hiện ở daily release N+1: D+1+N lúc 03:00 PT. Lag 0 có ngay trong stream đầu (bucket-end + 1h); lag dương/restatement dùng lịch daily 03:00 PT, kể cả qua DST. Lag 14 xuất hiện D+15. Tổng hourly và daily bằng nhau khi đã chín và noise=0; ở cùng asOf giữa ngày có thể khác vì lịch phát hành riêng.
- Return biến mất tại D+min(14, max(lag, returnLagDays)+1) 03:00 PT. Lag sau hệ số seasonality kẹp 14 (release D+15); chỉ return có trần D+14. Nếu lag 14 và có return, đơn đã bị trả trước khi được nhìn thấy nên không bao giờ xuất hiện. Snapshot quá khứ không được sửa tại chỗ.
- Noise hourly dùng hệ số tất định mỗi target/bucket, daily không nhiễu; không phải mô hình lỗi ingestion thực tế. Chưa mô phỏng nhiều đơn trên một click, biến động CTR ngầm theo thời gian hay thay đổi đối thủ.

### Sửa lỗi review Bước 2 (2026-10-20)

Chỉ thay đổi trong `simulator`, không thêm dependency; toàn bộ `evaluate()` vẫn trả `null`.
Không đổi test/kỳ vọng cũ. `test/fixtures/golden-perf.json` giữ nguyên golden 14 ngày cũ;
`scenarios/budget-capped.json` giữ nguyên để kiểm tra cạn sớm.

| Lỗi | Test mới trong `test/regressions.test.ts` | Bằng chứng red trước khi sửa |
|---|---|---|
| Attribution | lag 0/1 ở daily/stream; xác suất maturity D-2 = 0.8 bằng hàm tính; return boundary; lag 14 ở D+15 | lag 1 nhìn thấy 3 thay vì 0 đơn |
| Shared budget | lệch impression ≤15%; đổi ID giữ nguyên kết quả theo vai trò; không cap khớp chạy solo; campaign hourly bằng tổng target tại các restatement | lệch 84.7%; test đổi ID và restatement campaign cũng đã fail trước sửa |
| Golden | `expectedImpressions()` tính chi phí cả ngày, giờ chạm $5, CVR và ACoS | days = 14 thay vì 40 |
| Hiệu năng | 14 ngày <500ms, <6.283 fact; hash replay; 20 target × 60 ngày <10s; index/linear ở ba scenario; version thay đổi và suppression chiều zero | 62.832 fact; benchmark lớn ở bản sửa trung gian 15.42s trước khi tối ưu |

Mô hình dùng Poisson tổng impression, multinomial cho các ô placement × search term (chuỗi
binomial có điều kiện), binomial click và conversion. Binomial dùng thời gian chờ geometric chính xác để bỏ qua
các thất bại, không rút một Bernoulli cho từng impression. CPC là tổng các lần rút độc lập theo
click. Chỉ giờ chạm cap mới mở rộng impression token và Fisher–Yates shuffle bằng RNG
campaign/giờ, dừng cả campaign tại click không còn mua được. Giờ không chạm cap trả nguyên
kết quả từng target, không tiêu thụ RNG của target khác. ID là nhãn; vai trò RNG là
`campaignId:kind:normalizeText(text)`, giúp đổi tên target ID không đổi mẫu tự nhiên; cùng keyword ở campaign khác dùng mẫu riêng.
Thêm keyword khác không đổi mẫu của keyword cũ.

Reporter giữ sổ chung đầy đủ ở mỗi entity/kỳ, chỉ lên lịch lần đầu và các mốc attribution/return.
Mỗi chiều chỉ append khi payload metric khác version trước; PRODUCT_PAGE/search term chưa
bao giờ khác zero được bỏ qua, còn chiều đã có số liệu vẫn phát hành version về zero.
Daily/stream có chung ledger nhưng lịch phát hành khác nhau.

`FactIndex` là Map entity → ngày → versions sắp theo knownAt, binary search cutoff; query có
entityRef tự cache index bằng WeakMap trên mảng append-only và cập nhật phần append. Có thể
truyền `new FactIndex(facts)` trực tiếp cho `queryFacts`; API mảng cũ vẫn dùng được, query
không có entityRef giữ đường tuyến tính. Snapshot giữ thứ tự gốc và phát hiện version mâu thuẫn.
Không thay thế phần tử hay rút ngắn mảng đã index; tạo mảng/index mới khi thay ledger.

Golden mới: 40 ngày, bid $1.05, CTR 4%, CVR cơ sở 12.3%, traffic 1.000/ngày trước win rate.
Đường cong thấp 00–06, đỉnh 18–22 PT. Theo kỳ vọng: win rate 88.08%, CPC $0.81375,
CVR sau mix = 14.01585%, ACoS = 19.3531%, nhu cầu chi tiêu $28.66994/ngày;
cộng kỳ vọng đến giờ 14 mới vượt $5. Đây là kỳ vọng, không phải cam kết mọi ngày ngẫu nhiên.
Trước sửa khóa RNG campaign, seed 42 thực tế cạn trong 13–18h ở 32/40 ngày. ACoS mẫu 40 ngày có thể khác kỳ vọng.

Số đo lịch sử trước sửa khóa RNG campaign, trên Node v24.22.0, không tính compiler/I/O (thời gian phụ thuộc máy):

| Mẫu | Trước | Sau |
|---|---:|---:|
| Golden cũ 1 target × 14 ngày, runScenario | 7.02s trong test tái hiện (probe: CLI 8.5s) | 80.94ms |
| Fact cùng fixture | 62.832 | 2.420 (giảm 25.96×) |
| 20 target khác keyword × 60 ngày | — | 1.971s, 103.032 fact |
| Golden mới 40 ngày | — | 145.82ms, 8.472 fact |

Chạy lại: `npm run build && node test/benchmark.mjs`; số đo, hash và giờ cạn từng ngày ghi
vào `out/benchmark.json`. Test benchmark dùng cùng các ngưỡng 500ms/10s.
SHA-256 lịch sử trước sửa khóa RNG campaign của `JSON.stringify(facts)` fixture 14 ngày:
`103febcb8896825de16f5963ae949f47cef1932b14f474e5072427369ffa8e0b`.
Hai lượt replay cùng seed cho cùng hash. Hash mới khác output cũ có 62.832 fact: batching,
RNG theo vai trò, lịch attribution và bỏ version trùng đều thay đổi output; không duy trì
hash tương thích phiên bản cũ. Không có hash baseline cũ được lưu trước review.

Kết quả lịch sử trước sửa khóa RNG campaign, click ngày 2026-10-01 theo giờ PT 00…23:
`[0,1,0,0,0,0,0,0,1,0,0,0,0,0,0,1,2,0,1,0,0,0,0,0]`.
Ngày này cạn budget ở 18h. `out/golden/summary.json` là summary đầy đủ được CLI tái tạo;
tổng 40 ngày: 7.177 impression, 224 click, $185.343427 spend, 24 đơn, $720 sales,
24 netOrders. Daily snapshot D+1 có 23 đơn/$690; D+2/3/7/14 có 24 đơn/$720.

Lần xác minh cuối: `npm run typecheck`, `npm test` (13 file, 112 test pass),
`npm run sim -- scenarios/golden-winner.json --out out/golden` đều exit 0.


### Sửa khóa RNG theo campaign (Bước 2)

Hai fork demand và attribution cùng dùng `targetRngKey`; không thêm dependency.
Ba test mới trong `test/market.test.ts` kiểm tra khác mẫu giữa hai campaign không cạn
budget, toàn bộ facts bất biến khi đổi target ID (quy nhãn ID về tên cũ), và toàn bộ
facts bất biến với chữ hoa/thường, khoảng trắng đầu/cuối/lặp/tab/newline.
Probe 40 ngày từ 2026-09-01 (tránh DST): 35.029 và 35.115 impression, lệch 0,245%,
chuỗi click theo giờ khác nhau; cả hai campaign không chạm cap.

Đổi đường dẫn fork làm thay đổi mẫu demand, attribution, số fact và hash kể cả với
campaign đơn. Không thay fixture đầu vào hay kỳ vọng test cũ; replay cùng seed vẫn
xác định. SHA-256 hiện tại của `JSON.stringify(facts)` cho
`test/fixtures/golden-perf.json` (2.304 fact):
`8cdd44a48815f7080cef42384b41dcafba3ff2f82c88496a4ad5f44ba7fab6dd`.
Các số đo/output ở mục review phía trên là lịch sử trước thay đổi này.
Golden 40 ngày hiện tại: 7.191 impression, 225 click, $182.053154 spend,
31 đơn/$930 sales và 31 netOrders; D+1 có 30 đơn/$900, D+2/3/7/14 có 31 đơn/$930.

Xác minh sau sửa: `npm run typecheck`, `npm test` (13 file, 115 test pass),
`npm run build` đều exit 0.
