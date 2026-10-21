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

## Bước 3 — Campaign rules và runner ngày

`src/rules/campaign/` cài R01–R09 (mỗi rule một file); R10–R21B vẫn trả `null`.
Rule chỉ đọc context và trả proposal. Notification nằm trong proposal, engine chỉ gọi
`notify` sau khi proposal được chấp nhận; evaluate không I/O hay sửa context.
`MetricsReader` đọc daily campaign facts (không hour/placement) qua `queryFacts(asOf)`;
thiếu ngày không chứng minh được 0 đơn. Lookback 30 ngày kết thúc D-2, không cắt theo reset.
Audit chứa state, config, ngưỡng và snapshot fact đã biết tại thời điểm chạy.

Runner chạy từng bucket UTC nhưng quyết định theo ngày/giờ PT, trước traffic của bucket.
Thứ tự: đồng bộ manual edit → R01 nếu mới/bật lại → ghi budget ngày → tracker R09 →
first-match-wins theo id campaign → kiểm bất biến → ghi FaultyFakePort không lỗi, có
idempotency key → dựng EntityView từ budget/status/submittedBid cho market.
Chỉ budget/placement reset cửa sổ campaign; R01 luôn reset và bắt đầu grace kể cả budget no-op.
Tracker ghi counter/lastR09CheckDate mỗi ngày kiểm tra, không chiếm lượt G5. Campaign PAUSED
không được đánh giá rule thường; chỉ manual PAUSED→ENABLED mới cho R01 chạy lại.
Budget history giữ 35 ngày; sau quyết định cập nhật lại budget thực dùng cho ngày đó.

`ScriptedMarket(scenario, callback | Record<campaignId, Record<date, ScriptedDay>>)` nhận
`{clicks, spendUsd, orders, salesUsd}`. Callback nhận `{day, date, campaign}` để dựng script tiêu
đúng budget đang chạy. Tổng nguyên được phân bổ đều qua số giờ thực của ngày (23/24/25),
không lag attribution, phát hành daily campaign/target fact tại D+1 03:00 PT. Campaign PAUSED
sinh số liệu 0. Script mô tả số liệu quan sát chính xác; không áp thêm budget cap.

### Quyết định ambiguity mới

Mỗi lựa chọn dưới đây có comment `// SPEC-AMBIGUITY:` tại mã thực thi.

| Vấn đề | Mặc định / quyết định | Hệ quả |
| --- | --- | --- |
| `ambiguity.r09BudgetRestore` | `pre-tag-tier`; tùy chọn `keep-current` | Gỡ tag về đúng bậc đã lưu; tùy chọn kia giữ budget hiện tại |
| `every3DaysAnchorMode` | `campaign-created`; tùy chọn `global` | Ngày tạo +3k theo lịch PT; global dùng `every3DaysAnchor` |
| R06 `minRipeDays` | 1, cap W_post 14 ngày | Không chờ đủ 14 ngày; vẫn cần G2 và coverage đầy đủ của cửa sổ |
| `resolveWindow` tương thích Bước 1 | Bỏ option: min = days, post cap `maxPostDays`; có option: post cap = days | Giữ test/hành vi post cũ, cho phép R06 cap 14 với min 1 |
| R06B `calendar14` khi campaign còn mới | Khoảng 14 ngày lịch kết thúc D-2; không bắt đủ 14 fact | Có thể step 1 sớm khi đủ spend, đơn và ACoS; `wpost14` vẫn đòi 14 ngày chín sau reset |
| Làm tròn ngưỡng tỷ lệ | Chuẩn hóa G1 tới 12 chữ số thập phân | 36% không bị coi là nhỏ hơn `0.9 × 40%` do floating point |
| Hệ số tag khi G6 kẹp bid | Chỉ ghi phần giảm/khôi phục thực được nhận; cent rounding thường giữ hệ số danh nghĩa | Bid ở sàn không phát sinh phần giảm ảo để R09 tăng sai; chạm trần vẫn giữ pending |
| R06 pause giữa R06B waiting | Chuyển phase thành DONE khi pause | PAUSED_AUTO không giữ STEP1_WAITING |
| ScriptedMarket budget | Số liệu quan sát, không cap lại; PAUSED = 0 | Golden dùng số liệu chính xác và callback tiêu đúng budget |
| Budget history trong ngày | Lưu budget sau run | R04B so spend với budget của chính ngày đó |
| Giờ PT lặp do DST | Dispatch ngày một lần, ở lần xuất hiện đầu | `runHour=1` không khôi phục bid hai lần trong ngày 25 giờ |

Manual edit giữ quy ước Bước 2: edit ở đúng ranh giới bucket có hiệu lực ở bucket kế;
bật lại được nhận ở lần daily run tiếp theo. Budget sửa tay phải nằm trên ladder, nếu không
runner throw. RunHour khác 00:00 kết hợp `changeDayCountsAsPost=true` vẫn có thể dùng ngày
có traffic trước thay đổi; đây là flag có sẵn, không tự sửa chính sách.

### Golden và timeline thực đo

Tái tạo:

```sh
npm run typecheck
npm test
npm run sim -- scenarios/golden-winner.json --rules campaign --out out/golden-rules
node scripts/campaign-goldens.mjs
```

CLI campaign ghi `facts.jsonl`, `port-calls.jsonl`, `summary.json` và thêm
`decisions.jsonl`, `audit.jsonl`, `notifications.jsonl`, `timeline.md`.
CLI không có `--rules` vẫn chạy market-only như Bước 2.

Golden Scripted dùng startDate 2026-10-01, sản phẩm $30/BE 40%/CVR 10%. Ngày 0 tính từ ngày tạo;
run lúc 00:00 PT. B1 tiêu đúng budget, ACoS 20%, 2 đơn và 10 click/ngày. B3 giữ B1 đến hết ngày
12, ACoS 40% ngày 13–23 rồi 18% từ ngày 24. B4 giữ B1 đến hết ngày 13, sau đó $5 và 5 click/ngày,
0 đơn ($15/3 ngày ≥ $12.6); biến thể hồi phục từ ngày 18. B5 ACoS 70%, tiêu $5/ngày,
2 đơn/ngày; biến thể hồi phục 30% từ ngày 7. Các script là fixture kiểm thử quan sát,
không buộc doanh số tổng hợp bằng đơn × giá bán.

| Case | Timeline (ngày: rule → budget/tag) | Artifact |
| --- | --- | --- |
| B1 thắng | 0 R01 $5; 4 R02 $8; 8 R03 $10; 12 R04 $12; 20 R04B $14.40; 28 R04B $17.28; 36 R04B $20.74; tất cả NORMAL | [B1](out/B1/timeline.md) |
| B2 0 đơn | 0 R01 $5; 6 R06 $5/PAUSED_AUTO; giữ PAUSED hết ngày 39 | [B2](out/B2/timeline.md) |
| B3 xấu rồi hồi phục | 21 R07 $8/MANAGE/f=.9; 33 R09 $12/NORMAL; 36 R09 f=.99; 39 R09 f=1; 41 R04B $14.40; 49 R04B $17.28 | [B3](out/B3/timeline.md) |
| B4 ALERT → pause | 18 R08 $5/ALERT; 24 R06 $5/PAUSED_AUTO | [B4](out/B4/timeline.md) |
| B4 hồi phục | 18 R08 $5/ALERT; 27 R09 $12/NORMAL; 35 R04B $14.40 | [B4 hồi phục](out/B4-recovery/timeline.md) |
| B5 tiếp tục 70% | 6 R06B MANAGE/$5/f=.8; 14 R06B PAUSED_AUTO, notification R06B_PAUSED | [B5](out/B5/timeline.md) |
| B5 hồi phục 30% | 6 R06B MANAGE/$5/f=.8; 14 R06B memory-only DONE, giữ MANAGE; 18 R09 NORMAL/$5; 21/24/27 R09 khôi phục bid đến 1 | [B5 hồi phục](out/B5-recovery/timeline.md) |

B2 tính tay: ngày 5 chỉ có ngày 0–3 chín, spend $20 < $21. Ngày 6 có ngày 0–4,
spend $25, 25 click và 0 đơn: R06 khớp lần đầu, gửi R06_PAUSED.
B3 không có R05 vì 40% < T_bad=44%. Tracker pass ở ngày 30 và 33;
tag từ ngày 21 đã đủ 6 ngày, R09 gỡ ngày 33 và khôi phục bid ở các lịch kế tiếp.
B5 bước 2 cần đủ 7 ngày chín sau step 1 ngày 6 nên ngày 14 mới eligible, dù ngày 13 đã đủ
7 ngày lịch. B3 roadmap có unit test gỡ tag khi đang waiting và đồng thời đặt phase NONE, xóa r06bStep1At.
B6 kiểm cả hai flag: R07 lưu $14.40 → $8, R06B giữ $14.40 nếu false / ghi đè $8 nếu true;
R09 trả về đúng bậc tương ứng. Sàn hệ số .70, bid floor/trần và cent rounding có regression riêng.

Smoke MarketDriver giữ nguyên `scenarios/golden-winner.json`, seed 42, 40 ngày:
[Timeline smoke](out/golden-rules/timeline.md). R02 ngày 5 → $8, R03 ngày 9 → $10,
R04 ngày 13 → $12, R04B ngày 21/29/37 → $14.40/$17.28/$20.74. Không pause,
không notification, không vi phạm bất biến. Đạt $12 ngày 13, trước ngày 25.
Khác B1 một ngày do đơn ngẫu nhiên/knowledge time, không chỉnh scenario hay rule.

### Phát hiện — edge case B1 roadmap

Cùng fixture B4, chỉ đổi global anchor 0/1/2 ngày. Snapshot ở
`test/__snapshots__/campaign-loop.test.ts.snap`, dữ liệu tái tạo tại `out/edge-B1.json`.

| Pha / anchor | R05 | Có ALERT / ngày | Có R06 / ngày |
| --- | --- | --- | --- |
| 0 / 2026-10-01 | Không | Có / 18 | Có / 24 |
| 1 / 2026-10-02 | Ngày 18, về $5 | Có / 22 | Có / 24 |
| 2 / 2026-10-03 | Ngày 18, về $5 | Có / 23 | Có / 24 |

R05 thực sự cướp lượt ở pha 1/2 và reset cửa sổ. Fixture này vẫn đủ $15 mỗi W3 ở $5,
nên mọi pha cuối cùng đều có ALERT; ngày gắn tag lệch 4–5 ngày. R08 ở pha 1/2 không đổi budget
(vẫn $5), vì vậy không reset thêm cửa sổ, R06 vẫn pause ngày 24. Không khẳng định các pha
luôn cùng kết quả cho fixture khác.

Test cũ: `engine.test.ts` bổ sung các field context bắt buộc nhưng giữ kỳ vọng cũ;
`review.test.ts` chỉ gọi stub với context rỗng cho R10–R21B, vì campaign đã có logic thật.
Metadata campaign vẫn được kiểm đầy đủ; `registry` kiểm context thật với id không tồn tại vẫn null.
Không thay scenario hoặc kỳ vọng market cũ. Xác minh Bước 3: typecheck và toàn bộ test pass;
CLI campaign + script golden sinh các timeline trên.

### File thay đổi Bước 3

| Loại | File (tương đối trong simulator) |
| --- | --- |
| Mới — dữ liệu/market/runner/invariant | `src/data/metrics.ts`, `src/market/scripted.ts`, `src/runner/campaignLoop.ts`, `src/invariants/campaign.ts` |
| Mới — rule | `src/rules/campaign/r01.ts`, `r02.ts`, `r03.ts`, `r04.ts`, `r04b.ts`, `r05.ts`, `r06.ts`, `r06b.ts`, `r07.ts`, `r08.ts`, `r09.ts`, `r09Tracker.ts`, `shared.ts` |
| Mới — test/report | `test/campaign.test.ts`, `test/campaign-loop.test.ts`, `test/__snapshots__/campaign-loop.test.ts.snap`, `scripts/campaign-goldens.mjs` |
| Sửa — runtime | `config/defaults.ts`, `src/audit/log.ts`, `src/cli/sim.ts`, `src/data/windows.ts`, `src/domain/params.ts`, `src/domain/state.ts`, `src/engine/priority.ts`, `src/engine/types.ts`, `src/rules/registry.ts` |
| Sửa — test/docs | `test/cli.test.ts`, `test/engine.test.ts`, `test/review.test.ts`, `README.md` |

Kết quả cuối: `npm run typecheck` exit 0; `npm test`: **15 file, 177 test pass**;
`git diff --check -- simulator` sạch. Không dependency mới. Review độc lập phát hiện lỗi
bookkeeping tại sàn bid và lặp daily run trong DST; cả hai đã sửa theo regression test.


### Regression R06B kích hoạt lại sau R09

R09 gỡ MANAGE/ALERT về NORMAL đồng thời đặt `r06bPhase='NONE'`,
`r06bStep1At=null`. Quyết định ambiguity: mỗi lần campaign hồi phục về NORMAL thì
R06B được kích hoạt lại. Invariant mới: NORMAL ⇒ phase NONE; DONE chỉ được giữ
khi MANAGE, ALERT hoặc PAUSED_AUTO. Runner kiểm invariant sau mọi decision,
bao gồm toàn bộ golden B1–B5; không đổi snapshot hiện có.

Test `R06B rearms after recovery...` chạy ScriptedMarket 80 ngày, $30/BE 40%,
10 click/2 đơn mỗi ngày, tiêu đúng budget: ACoS 70% ngày 0–6, 20% ngày 7–40,
70% từ ngày 41. Timeline (ngày 0 = 2026-10-01, run 00:00 PT):

| Ngày | Quyết định |
| --- | --- |
| 0 | R01 $5/NORMAL |
| 6 | R06B bước 1 $5/MANAGE |
| 14 | R06B bước 2 DONE, giữ MANAGE do đã hồi phục |
| 15 | R09 $5/NORMAL, phase NONE và timestamp null |
| 16/20/25 | R02/R03/R04 tăng $8/$10/$12 |
| 18/21/24 | R09 khôi phục bid |
| 33/41 | R04B tăng $14.40/$17.28 |
| 45/49/53 | R05 giảm $14.40/$12/$10 |
| 56 (2026-11-26) | R06B bước 1 lần hai $5/MANAGE, bid $1.04 → $0.84 |
| 64 (2026-12-04) | R06B bước 2 $5/PAUSED_AUTO, notify R06B_PAUSED |
| 65–79 | Giữ PAUSED |

Ngày 55 W14 còn chứa ngày 40 ACoS 20%; ngày 56 W14 gồm ngày 41–54 đều 70%,
vượt 1.5×BE. Bước 2 ngày 64 có đủ 7 ngày chín sau bước 1 (W7 ngày 56–62).
Bid bước 1 đề xuất −20%, vẫn áp G6 hiện có: sàn anchor $1.05×.8=$.84 cao hơn
đề xuất làm tròn $.83. Hệ số tag thực nhận $.84/$1.04≈.807692, không thấp hơn .70.
Không thay guard hoặc hành vi khác, không thêm dependency.

Xác minh regression: test tái hiện fail trước sửa (không có R06B lần hai); sau sửa
`npm run typecheck` exit 0, `npm test`: **15 file, 182 test pass**; golden B1–B5
đều qua invariant mới, không đổi snapshot. `git diff --check -- simulator` sạch.

## Bước 4 — account rules

Implementation follows `docs/step-4-plan.md`. Only the simulator changes; no dependencies are added. `runCampaignLoop` remains campaign-only; `runAccountLoop` runs the full account.

Daily PT order: manual edit/R01 → budget history → R09 tracker → CAMPAIGN → PLACEMENT → TARGET → pending harvest verification → SEARCHTERM → weekly hourly analysis. Each UTC hour runs R21B before market traffic. Both repeated 01:00 hours at DST fallback are distinct instants.

`campaign-first` skips the complete TARGET group when R06B/R07/R09 already wrote that target's base in the run (`SKIPPED_CROSS_LEVEL`). `error` remains available for conflict tests. Placement-only decisions never lower target bases. Base proposals pass G6 using the maximum of the 24 factors. Product hard corrections take precedence over soft anchor/step limits after price changes and emit `EMPTY_BID_RANGE` when half the anchor exceeds the new maximum.

R15 creates an Exact, persists pending only after successful creation, then verifies its ID and normalized query with `listKeywords`. Source Negative Exact follows a positive read only. Pending checks run daily, including weekdays; after seven days they time out without adding a negative. Negatives carry harvest provenance and are deduplicated by campaign/normalized text. Market truth for a harvested target inherits source CTR/auction parameters, source CVR × term multiplier and source impressions × term share. A campaign negative removes that query from all of its targets and reduces impressions by the removed share; it does not redistribute the share.

Placement uses its own post-change window. REST with ≥30 clicks and zero orders has CVR=0: the formula is literally `CVR_TOP >= 2 * 0`, still requiring TOP ≥30 clicks, ≥3 orders and winning ACoS. Positive orders with zero sales yield infinite ACoS for R11/R19.

| New/refined config | Default | Meaning |
| --- | --- | --- |
| ambiguity.crossLevelBidPolicy | campaign-first | Campaign writes suppress target group; error for tests |
| ambiguity.placementWindow | post14-min7 | Placement origin, max 14 days, min seven ripe days |
| ambiguity.hourlyScope | campaign | Campaign hourly evidence; target mode supported |
| ambiguity.r14CountResetAfterFlag | true | Restart R14 count after its 30-day flag expires |
| thresholds.r10r11Clicks | 15 | Target sample gate |
| thresholds.hourlyClicks | 40 | Hourly sample gate |
| hourlyAnalysisWeekday | 1 | Monday PT |

Golden zero-order target ($30, BE 40%, anchor $.80):

| Run day | Mature evidence | Action |
| --- | --- | --- |
| 5 | D0–D3 each five clicks/$2.80 = 20 clicks/$11.20 | R12 $.80 → $.64; waste flag |
| 6 | D4 adds zero clicks | No action |
| 7 | D5 adds ten clicks/$5.60 = 30 clicks/$16.80 | R13 PAUSED; ten clicks since R12 |

Two foundation-test premises necessarily change with the brief: `engine.test.ts` explicitly selects `error` for its conflict test; its hourly-only proposal now asserts unchanged base ($1 rather than $.81). No campaign golden expectations or snapshots change. Registry metadata remains compatible with the prior metadata tests; actual placement evaluation resolves the refined post window.

Full-account scenario premises (before its first smoke run): 60 days from 2026-10-01, seed `full-account-20261020`, product $30/BE40%/expected CVR10%. Discovery divides demand equally between a high-conversion harvest term and a zero-conversion waste term. Manual winner offsets bleeder spend so campaign zero-order pause does not mask R13. Bleeder starts at $1 to make ≥$16.80 feasible by 30 clicks. The low-impression target has zero CTR and a steep impression response near $.60, so three 15% raises should make its subsequent W7 exceed 100 impressions. Creation remains invisible for 60 minutes, requiring a later verification run before a source negative. If these premises do not produce the required observations, stop with measurements; do not tune rules to pass.

Smoke đã pass với kỳ vọng được sửa: mỗi chu kỳ cờ R14 có tối đa ba lần tăng, hai lần tăng cách nhau ít nhất bảy ngày. Trong 60 ngày, low tăng **5 lần**, chia chu kỳ **3 + 2**: 10-09/10-16/10-23 và 11-22/11-29; bid $.40 → $.46 → $.53 → $.61 → $.70 → $.80. W7 tương ứng 0, 0, 4, 53, 76 impressions. Scenario được giữ nguyên. Regression 120 ngày với impression luôn thấp kiểm tra nhiều chu kỳ ba lần tăng và cờ 30 ngày, độc lập với hard cap của engine.

Audit lưu diff đệ quy của các field thay đổi, gồm cả negative/harvest khi liên quan; phía thiếu field được biểu diễn bằng null. Event không khớp có before/after rỗng. inputsSnapshot chỉ có reads ({query, from, to, totals}), paramsVersion, configHash (SHA-256), now. Mỗi rule có recorder riêng; metrics daily lọc hourly/placement trước khi resolve fact, giữ nguyên daily totals. Decision trong bộ nhớ vẫn đầy đủ; decisions.jsonl chỉ lưu diff và metadata. CLI ghi JSONL từng dòng với backpressure; AuditLog cung cấp iterator event và jsonLines, không làm I/O. `config.audit.level` mặc định `all`; `matched` giữ MATCHED/ERROR để dùng cho Monte Carlo.

Không đổi golden hay snapshot campaign. Assertion audit no-op trong `test/engine.test.ts` buộc đổi từ `after: ctx.state` sang `before: {}, after: {}` theo hợp đồng diff mới; kiểm tra no-op/cooldown giữ nguyên.

## Phát hiện Bước 4

**E6: harvest làm campaign nguồn mất toàn bộ đơn → R06 pause vĩnh viễn.** AUTO nguồn tăng budget ngày 4 (2026-10-05); term tốt được harvest Chủ Nhật 10-04 và negative ở nguồn sau xác minh ngày 5 (10-06). R06 pause vào ngày 8 (10-09), yêu cầu người dùng xác nhận mới bật lại. W_post ngày 8 là **10-05–10-07**, 470 impressions, **33 clicks, $23.287437 spend, 0 orders, $0 sales** (ACoS infinite); vượt Spend_zero=$21 và N2=20. Hai ngày zero-order kiểm tra thêm 10-06–10-07 có 22 clicks/$15.353274. Scenario chỉ có **hai search term**, nên khi bỏ term tốt, toàn bộ traffic còn lại là term rác; hiện tượng bị phóng đại. Đây là phát hiện mô hình/scenario, không thay đổi rule.

CLI full-account tạo đủ audit.jsonl, decisions.jsonl, notifications.jsonl, port-calls.jsonl và timeline.md; 34 decisions, 41 API calls đều thành công. Kết quả kiểm chứng và số liệu cuối xem [step-4-status.md](docs/step-4-status.md).

## Bước 5 — executor, drift, crash, edge, Monte Carlo và report

`src/runner/executor.ts` dựng WritePlan theo thứ tự: campaign (name/tag, budget, status nguyên tử), placement, từng target/keyword, negative. Retry tối đa `api.maxAttempts=4` cho 429/5xx và phần tử lỗi transient; key không đổi. `retryAfterSeconds` cộng vào `waitSeconds`, không đổi SimClock. Chỉ entity ack mới commit; target lỗi giữ memory/cooldown/window/flag cũ. Outcome `PARTIAL_APPLY`/`APPLY_FAILED` và notification `API_WRITE_FAILED` ghi rõ lỗi. Bid của kế hoạch có thay đổi ToS dùng trần an toàn cho cả ToS trước/sau để vẫn hợp lệ nếu placement lỗi. R09 còn target khôi phục lỗi giữ `bidRestorePending`. R21B chỉ cập nhật sent map với target ack và thử lại target lỗi ở boundary kế tiếp. Lỗi lập trình và `CrashError` vẫn throw.

`src/runner/reconcile.ts` đọc campaigns và mọi loại target trước daily rules. Mặc định tin Amazon; `ambiguity.driftPolicy='trust-engine'` repair remote bằng retry. Drift ghi `DRIFT_DETECTED` cùng fields; không reset window/cooldown/anchor. Bid base nhận từ bid remote chia factor giờ marketplace; PAUSED_AUTO chỉ chạy R01 khi đọc thấy console enable. Manual edit tác động vào backing InMemoryFakePort; thị trường dùng trạng thái Amazon thực tế, kể cả write thành công một phần.

`runDaily` nhận state, port, clock, facts, thresholds và dữ liệu submitted bid/ack, trả state cùng decisions/audit/notifications, sent/ack và thời gian chờ. Run ID tất định từ instant marketplace. Fake API giữ snapshot đọc đầu tiên theo key `daily:<runId>` để replay không hiểu nhầm ghi dở dang thành sửa tay. `CrashingPort` ném sau lần ghi thành công thứ N, trước khi caller commit ack. Regression crash tại N=1,2,5,half,last−1: snapshot trước run + cùng API cho state/API/idempotency log giống clean run, R12 ×0.8 chỉ áp một lần. Đây là mô hình crash với cùng port được giữ lại, không phải persistence ra database ngoài simulator.

Suite `scenarios/edge/*.json` ghi một kết quả cho mỗi A1–E6 và chaos-account vào `out/edge`. INVARIANT kiểm thất bại thật; MEASURE lưu số liệu, không sửa rule để đẹp kết quả. Các fixture regression Bước 3–4 chạy lại bằng Vitest từ CLI edge; C3 kiểm 5 chu kỳ MANAGE/NORMAL. Chaos chạy 60 ngày với rate limit 10%, server error 5%, partial batch 10%, stale read 30 phút, hai console edit và price change. `hourlyAnalyses` lưu evidence/factor thực tế của R20/R21 để đo tác động, kể cả giờ thiếu bằng chứng; không đếm nhầm chúng như daily decision.

Monte Carlo dùng worker_threads (auto tối đa 8 worker), audit matched, seed đánh số 0…N−1, kết quả runs theo thứ tự seed. Kiểm worker thật 1/2 cho cùng kết quả. `matureFacts` flush riêng tới cuối +15 ngày; premature gọi lại đúng evaluator với state, instant, params và cửa sổ gốc, chỉ đổi asOf. R05B tách đúng nhánh zero-order. Wasted spend hợp nhất các vùng target/search term bị tác động để không đếm kép R06/R13/negative. Summary có phân vị, mean/min/max, tỷ lệ run pause sớm; compare chạy cùng seed và ghi diff, kể cả loại notification chỉ xuất hiện ở một phía.

```sh
npm run typecheck
npm test
npm run edge -- --out out/edge
npm run mc -- scenarios/full-account.json --seeds 100 --workers auto --out out/mc/full-account
npm run mc -- scenarios/edge/attribution-storm-account.json --seeds 100 --compare 'ambiguity.changeDayCountsAsPost=false' --out out/mc/storm
npm run report -- --edge out/edge --mc out/mc/full-account --mc out/mc/storm --mc out/mc/marginal --out out/report
```

Report HTML/Markdown sinh từ dữ liệu đã lưu, sort ổn định, không dùng thời gian hệ thống. HTML tự chứa, chart SVG inline, light/dark theo `prefers-color-scheme`, không URL/script ngoài. README Bước 3–4 là nguồn các phát hiện lịch/reset/harvest; report bổ sung evidence edge và Monte Carlo, chỉ đề xuất sửa spec.

### Các SPEC-AMBIGUITY mới của Bước 5

| Flag | Mặc định | Ý nghĩa |
| --- | --- | --- |
| driftPolicy | trust-amazon | Giá trị console được nhận vào engine; có thể chọn trust-engine. |
| staleReadPolicy | acknowledged-write-grace | Không nhận read cũ trong `api.staleReadGraceMinutes=30` sau ack; có thể chọn trust-read. |
| dailyReadPolicy | snapshot-per-run | Cùng run ID đọc lại cùng snapshot ban đầu để replay. |
| offLadderBudgetPolicy | nearest-tier | Budget console ngoài ladder dùng bậc gần nhất để giữ invariant budget; tie chọn bậc thấp hơn. |
| mcTierScope | first-campaign | Time-to-tier của account là campaign đầu tiên đạt $12/$25; đã đạt lúc bắt đầu thì 0. |
| wastedSpendThresholdPolicy | prorate-crossing-day | Bucket ngày vượt N2 được phân bổ theo phần click sau ngưỡng. |
| incompleteRecoveryWindow | exclude | D2 không tính sự kiện thiếu đủ 14 ngày sau R07. |

Grace của stale read cần đặt ít nhất bằng độ trễ đọc giả lập. Console sửa trong grace có thể được nhận trễ tới daily run kế tiếp; API không có revision nên chưa thể phân biệt read cũ và sửa tay ngay sau ack. Đây là lựa chọn được công khai bằng flag, không suy đoán sửa tay từ một stale read.

### Tương thích test cũ

Không đổi rule, golden hay snapshot Bước 3–4. Test manual bid cũ đổi từ yêu cầu synthetic decision `MANUAL_EDIT` sang `DRIFT_DETECTED`, vì yêu cầu Bước 5 thay đường R10 giả lập bằng console + reconcile; giữ window/anchor theo hợp đồng drift. Test discovery scenario lọc file `.json` ở cấp root thay vì đọc cả thư mục `edge/`. Assertion `CREATE_FAILED` cũ được giữ cùng audit failure mới.

### Kết quả chạy thật Bước 5

| Bộ Monte Carlo | Số lượt | Thời gian | Profit p50 | Flip-flops budget / bid p50 (/30 ngày) | Run có pause sớm | Invariant max |
| --- | --- | --- | --- | --- | --- | --- |
| full-account | 100 | 108.896 giây | $8,801.912132 | 0.5 / 0.5 | 0% | 0 |
| storm mặc định | 100 | 301.311 giây | $8,815.009223 | 0.5 / 0.5 | 0% | 0 |
| storm changeDayCountsAsPost=false | 100 | cùng lệnh storm | $8,212.071795 | 0 / 0 | 0% | 0 |

Thời gian storm **301,311 giây là tổng 200 lượt** (100 seed × hai cấu hình), không phải 100 lượt. Full-account 100 seed ×60 ngày **108,896 giây**, đạt mốc <5 phút trên máy này với auto=8 worker. Các lượt chạy có thể chậm khi song song với full suite; benchmark trên là lệnh yêu cầu thực tế.

| Premature (tổng 100 seed) | full-account | storm | storm compare |
| --- | --- | --- | --- |
| R06 | 0 | 0 | 0 |
| R13 | 0 | 0 | 0 |
| R12 | 0 | 0 | 0 |
| R16 | 0 | 0 | 0 |
| R17 | 0 | 0 | 0 |
| R05B | 0 | 0 | 0 |
| R08 | 0 | 0 | 1 |

Compare làm profit p50 giảm **$602,937428**, flip-flops p50 về 0/0; có một R08 sớm, không có R06/R13 pause sớm. Không suy rộng tỷ lệ 0 từ những market/seed này sang mọi thị trường. API failures/drift của ba bộ Monte Carlo đều 0 vì hai scenario MC không bật API chaos; stress API nằm trong edge suite.

### Phát hiện Bước 5

- **Attribution:** A1 một seed và MC storm mặc định 100 seed không ghi nhận quyết định sớm theo phép đánh giá lại đúng rule/cửa sổ. Compare `changeDayCountsAsPost=false` có **1 R08 sớm/100 seed**. Đề xuất đánh giá thêm market gần ngưỡng và maturity lag trước khi thay spec; không thay rule.
- **B2:** ba pha đều có **$50** zero-order calendar spend tới R06; cửa sổ tại R06 có **$25** zero-order spend, so với **Spend_zero=$21**. Đề xuất tách cửa sổ giám sát lãng phí tích lũy khỏi window reset do budget.
- **A5/A6:** **5.020 target-hour** cạn budget/thiếu impressions; R20 giảm giờ thiếu dữ liệu **0**. Noise 10% gây tổng lệch spend hourly so với daily **$122,960463**; 624 bản phân tích factor thật, R20/R21 đổi factor **0/0** trong fixture này. Đề xuất spec quy định riêng exposure/budget-capped trước khi học hệ số giờ.
- **C2:** ba target đứng im >30 ngày. **D2:** một R07 có đủ 14 ngày theo dõi, ACoS sau đó **19,375% < T_win 28%**. Đề xuất cửa sổ/điều kiện phục hồi rõ ràng để đánh giá vòng xoáy chết và baseline may mắn.
- **E6:** nguồn có **11 đơn/$14,230770** trước harvest, **4 đơn/$28,187445** sau harvest; R06 ngày 8. Đề xuất theo dõi đồng thời ASIN và campaign, xét grace sau harvest. Không suy ra quan hệ nhân quả chỉ từ before/after này.


## Bước 5b — đối chứng đo lường

Chạy từ `simulator/`, không thêm dependency, không sửa rule hoặc kỳ vọng test cũ:

```sh
npm run typecheck
npm test
npm run edge -- --out out/edge
npm run mc -- scenarios/marginal-account.json --seeds 100 --workers auto --out out/mc/marginal
npm run report -- --edge out/edge --mc out/mc/full-account --mc out/mc/storm --mc out/mc/marginal --out out/report
```

Nếu thiếu bộ MC cũ, chạy lại hai lệnh full-account và storm ở mục Bước 5 phía trên trước khi chạy report. Bộ cũ còn nguyên trong lần chạy 5b này. Report đọc thêm hai file edge `premature-positive.json`, `hourly-signal.json` và bộ MC `marginal`.

### Đối chứng premature

`scenarios/edge/premature-positive.json`: một Exact target, CVR thật 4%, bid $0.80, CTR 8%, 1.800 impressions/ngày trước auction/budget, giá $30, BE 40%. Lag 3/5/7 ngày có trọng số 10%/20%/70%; 18 ngày, seed 1. Chọn seed có đơn thật đến trễ để làm đối chứng dương xác định, không ước lượng tỷ lệ premature của quần thể. Không dùng fact nhân tạo, ScriptedMarket hay sửa đơn sau khi chạy.

Qua `runAccountLoop` rồi `measureRun`: **premature R12=1, R06=1, tổng=2**, premature pause=1. Giữ nguyên scenario/seed, chỉ thay lag bằng `{ "0": 1 }`: **premature tổng=0**. Cửa sổ và state giữ tại quyết định gốc; knowledge time của lần đánh giá lại nằm sau khi đơn chín:

| Rule | Ngày PT | Cửa sổ gốc (bao gồm hai đầu) | Click | Spend | Đơn/sales lúc quyết định | Đơn/sales đã chín |
| --- | --- | --- | --- | --- | --- | --- |
| R12 | 2026-10-05 | 01–03/10 | 23 | $13.960293 | 0 / $0 | 3 / $90 |
| R06 | 2026-10-07 | 01–05/10 | 40 | $23.201352 | 0 / $0 | 4 / $120 |

ACoS gốc vô cực; sau chín lần lượt 15.5114% và 19.3345%. Có đơn nên cả hai rule 0 đơn không còn khớp. `out/edge/premature-positive.json` lưu metric dương/âm và cửa sổ/giá trị này.

### Marginal 100 seed

`scenarios/marginal-account.json`: 45 ngày, ba campaign Manual, mỗi campaign hai Exact target, 1.000 impressions/target/ngày, CTR 8%, attribution tức thì, không chaos API. Giá $30, BE 40%, Exp_CVR 10% dẫn xuất qua `deriveThresholds`: T_win=28%, T_ok=36%, T_bad=44%. Bid/CVR thật của ba nhóm lần lượt $0.50/(5%,4.5%), ($0.55,$0.50)/(4%,3.8%), ($0.60,$0.55)/(3.5%,3.2%). Với CPC kỳ vọng 0.775×bid, ACoS cơ sở trước tác động rule lần lượt khoảng 25.83–28.70%, 33.99–35.52%, 44.29–44.40%, nằm sát ba ngưỡng. Rule thay bid, budget và pause sẽ làm ACoS cả run khác ACoS cơ sở này.

Lệnh 100 seed, auto=8 worker, hoàn tất trong **100.937 giây** (durationMs trong summary). Các giá trị tiền là USD; flip-flops là số lần đảo chiều/30 ngày, cộng trên account:

| Metric | p5 | p50 | p95 |
| --- | --- | --- | --- |
| timeToTier.to12 (ngày) | 12 | 21 | 39.8 |
| timeToTier.to25 (ngày) | null | null | null |
| acos | 23.711834% | 26.358676% | 30.965622% |
| profit | 181.808135 | 436.574816 | 719.042877 |
| spend | 488.788992 | 848.990216 | 1185.309382 |
| flipFlops.budget | 2 | 4.666667 | 8 |
| flipFlops.bid | 3.933333 | 10 | 16.066667 |
| wastedSpend | 0 | 96.659040 | 434.155417 |
| prematureTotal | 0 | 0 | 0 |

89/100 seed đạt $12; percentile to12 chỉ dùng seed đạt tier theo policy hiện có. **0/100 đạt $25** trong 45 ngày, nên summary không có cột số to25; bảng biểu diễn bằng null, không thay bằng 0. Test nhanh chạy 8 seed ×18 ngày, xác nhận tập `(ruleId, objectRef, ngày)` khác nhau và ít nhất một phân phối metric có p5 khác p95.

### Hourly signal và boundary

`scenarios/edge/hourly-signal.json`: seed 42, 100 ngày, một campaign với ba target có đường traffic khác nhau: target yếu CVR 3% chỉ ở giờ 00, target mạnh CVR 40% chỉ ở giờ 01, target nền CVR 15% chia đều giờ 02–23. CTR 8%, impressions/ngày tương ứng 100/100/600; giá $100 để các giờ vẫn sinh đơn và campaign không bị pause bởi hiệu quả kinh tế. Không thêm tham số hourly CVR vào market model: dùng mixture target theo giờ ở campaign scope hiện có.

R01 vẫn bắt đầu budget $5. Để tách tín hiệu giờ khỏi budget cap, fixture có console edit budget $25 lúc 2026-11-30T08:00Z; reconciliation thật tiếp nhận edit. Cửa sổ kiểm chứng cuối **10/12/2026–06/01/2027** có đủ 28 ngày cho cả 24 giờ, ít nhất **48 click/giờ**, **0 giờ budget-capped**. Giai đoạn khởi động trước cửa sổ này có thể cạn budget; không dùng nó làm bằng chứng đủ volume. Giờ 00 có 5/170 đơn/click (2.94%), giờ 01 có 94/209 (44.98%).

Qua `runAccountLoop`: **R20 giảm factor 34 lần, R21 tăng factor 33 lần, R21B có 626 batch write**. R20/R21 là số thay đổi factor target×giờ trong `hourlyAnalyses`, không phải số daily Decision (runner gọi chung `analyzeHours`). R21B đếm port call `updateTargets` có key R21B; mọi target của fixture dùng cùng endpoint keyword. Có đúng **626 boundary đổi bid**, **0 key boundary trùng**, **0 write tại boundary không đổi bid**. `hourlyBoundaries` ghi bid acknowledged trước/sau từng boundary để test đối chiếu port call, kể cả boundary no-op. Test DST/idempotency cũ vẫn giữ nguyên.

### Phát hiện Bước 5b

Không phát hiện bug thật trong `maturePremature`, R20/R21 hay submitBoundary; **không sửa rule/metric để đạt đối chứng**. Premature cũ toàn 0 và hourly cũ 0/0 phản ánh fixture chưa có bằng chứng dương. Test mới trong `test/measurement-controls.test.ts` chạy market và account loop thật, không gọi evaluator trực tiếp. Thêm helper đo cửa sổ trong `src/edge/controls.ts`, telemetry boundary trong runner, và nối hai đối chứng vào edge suite. Dùng policy ambiguity hiện có (D-2, campaign hourly scope, first-campaign tier, excludes unreached tiers); không đưa vào lựa chọn semantics mới.

Xác minh: `npm run typecheck` pass; `npm test`: **298/298 test, 37 file, 27.12 giây wall time** (test time cộng các worker 67.58 giây). 295 test cũ giữ nguyên kỳ vọng, thêm 3 test. Không commit/push.

## Bước 6 — thử nghiệm v3.2 (mặc định giữ v3.1)

Chỉ sửa trong `simulator/`. Báo cáo chi tiết được đặt tại
[docs/simulator/v3.2-results.md](docs/simulator/v3.2-results.md) để tuân thủ phạm vi này;
không sửa spec hoặc proposals bên ngoài simulator.

| Flag | Mặc định v3.1 | Biến thể thử |
| --- | --- | --- |
| `v32.zeroOrderLagDays` | 2 | 3, 4 |
| `v32.r06CalendarGuard` | false | true |
| `v32.r08Daily` | false | true |
| `v32.postHarvestGraceDays` | 0 | 7 |
| `v32.hysteresis` | false | true |
| `v32.hourlyExcludeCapped` | false | true |

**P1 — định nghĩa cửa sổ zero-order.** Chỉ bằng chứng “0 đơn” của R06/R12/R13/R16/R17,
R05 nhánh B và R08 dịch điểm kết thúc từ D-2 sang D-K. Cửa sổ rolling giữ số ngày,
W_post vẫn cắt theo mốc reset; khoảng “từ lần R12 gần nhất” của R13 giữ toàn bộ mốc bắt đầu,
không cắt còn 30 ngày. Hai ngày của zeroOrdersRobust là D-K-1 và D-K. Ngoài ra, có đơn
ở **bất kỳ ngày nào từ D-K+1 đến D-2** thì không thỏa zero-order. Cần đủ coverage để
chứng minh zero-order; thiếu ngày không được coi như 0 đơn. Spend, click và các ngưỡng
khác của rule vẫn lấy cửa sổ gốc kết thúc D-2. P1 không làm tất cả dữ liệu của rule chậm K ngày.

P2 thêm nhánh HOẶC của R06: 14 ngày lịch kết thúc D-2, không cắt theo reset,
spend ≥ 2×Spend_zero và zero-order theo P1 nếu bật. Nhánh cũ giữ nguyên.
P3 chỉ cho R08 bỏ gate every3Days; R07/R09 giữ lịch cũ.
P4 bắt đầu từ lần ghi Negative Exact của harvest thành công, không phải lúc đề nghị tạo Exact.
Ngày ghi là ngày 0; chặn R06 khi số ngày lịch marketplace nằm trong [0,N), ghi audit
`BLOCKED_BY_HARVEST_GRACE`. Các rule khác không bị gate này. Ghi thất bại không tạo ân hạn.

Hệ số P5 có thể chỉnh tại `config.v32Hysteresis`: `bidUp=.9`, `bidDown=1.1`,
`budgetUp=.95`, `budgetWinUp=.95`, `budgetDown=1.05`. Chỉ ngưỡng kích hoạt đổi;
không đổi công thức lượng tăng/giảm. R10 áp dụng ngưỡng mới ở cả W14 và W_post.
P6 loại toàn bộ bucket của ngày/giờ có cap trước khi tính CVR giờ và CVR đối chiếu.
Mỗi giờ cần ≥20 **ngày lịch phân biệt** không cap trong 28 ngày; không đủ thì factor =1,
kể cả trước đó đã có factor khác 1. `hourlyAnalyses.cleanDays` ghi số ngày sạch khi bật P6.

Khi mọi flag tắt, không thêm field memory/negative/telemetry; config hash audit được tính
trên hình dạng config v3.1 để giữ hash cũ. Regression hash kiểm cả state, quyết định,
audit, timeline và API calls. Các hệ số hysteresis không có hiệu lực khi P5 tắt.

### So sánh cấu hình

```sh
npm run mc -- scenarios/marginal-account.json --seeds 100 --workers auto \
  --variant P1-K3 'v32.zeroOrderLagDays=3' \
  --variant P5 'v32.hysteresis=true' \
  --variant custom 'v32.hysteresis=true v32.r08Daily=true' \
  --out out/v32/example
```

Mỗi `--variant NAME` nhận một hoặc nhiều `key=value`, có thể gộp trong dấu nháy.
Baseline luôn v3.1 mặc định ở CLI; mỗi biến thể chạy đúng seed 0…99 của baseline.
`summary.json.variants` chứa summary, diff (gồm p50/mean), paired better/tied/worse và
betterRate cho profit, wastedSpend, prematureTotal, tổng flipFlops bid+budget.
`NAME-runs.jsonl` giữ từng seed. BetterRate loại tie khỏi tử số, vẫn giữ tie trong mẫu số;
đây là kiểm định cặp mô tả, không phải p-value. Cú pháp `--compare key=value` cũ vẫn chạy;
nhiều `--compare` cũ vẫn gộp thành một cấu hình so sánh như trước. `summary.compare.paired` cũng có thống kê cặp cùng định nghĩa như biến thể có tên.

### Tái lập thử nghiệm

Quần thể premature có năm campaign độc lập, mỗi campaign một target CVR thật 2%–6%,
giữ lag 3/5/7 ngày của đối chứng. Không thay rule để tạo tín hiệu và không chỉnh scenario
sau khi xem kết quả. Cổng sau chạy baseline trước, yêu cầu ≥10% seed có premature,
rồi mới chạy các biến thể; không đạt thì dừng để xem lại scenario:

```sh
npm run typecheck
npm test
npm run build
node dist/src/cli/mc.js scenarios/edge/premature-population.json \
  --seeds 100 --workers auto --min-premature-seed-rate 0.1 \
  --variant P1-K3 v32.zeroOrderLagDays=3 --variant P1-K4 v32.zeroOrderLagDays=4 \
  --out out/v32/P1-premature-population
sh scripts/v32-mc.sh
node scripts/v32-edge.mjs
node scripts/v32-results.mjs
node scripts/v32-combined.mjs
node scripts/v32-results.mjs
npm run report -- --edge out/edge --mc out/mc/full-account \
  --v32 out/v32 --out out/report
```

B1/B2 là descriptor, script dùng đúng ScriptedMarket/ba pha của edge suite hiện có;
E6/A5 dùng full-account thật, hourly-signal dùng đối chứng thật. Không thay script/rule
để một đề xuất thắng. Các biến thể chung scenario chia sẻ baseline để tránh chạy lại
100 seed baseline cho từng đề xuất. Report mặc định đọc `out/v32` nếu có; có thể đổi
bằng `--v32 DIR`. Mục **Thử nghiệm v3.2** gồm bảng metric/delta, tỷ lệ seed tốt hơn,
edge bật/tắt và kết luận từ báo cáo Markdown.

### Thời gian chạy thử nghiệm v3.2

Tổng thời gian lệnh Monte Carlo đã lưu và bộ edge cuối: **4936.594 giây (82.28 phút)**. Đây là tổng durationMs từng lệnh, gồm cả lượt kiểm tra lại/exploratory và lệnh dang dở được chạy lại, có ghi trong out/v32; không phải wall time vì có lệnh chạy song song. Chi tiết từng lệnh, số lượt và định nghĩa tại [out/v32/timing.json](out/v32/timing.json). Không tính build, Vitest hoặc đối chiếu hash vào tổng durationMs.

Khoảng thời gian lịch từ lệnh MC đầu tiên đến output MC cuối: **54.90 phút**, gồm cả khoảng chờ/triển khai giữa các lệnh; không phải thời gian CPU. Mốc đầu ước lượng từ birthtime summary đầu tiên trừ durationMs của lệnh đó.
