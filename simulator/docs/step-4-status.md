# Bước 4 — hoàn tất

Phạm vi project lead duyệt đã triển khai trong `simulator/`, không thêm dependency, không sửa scenario. Test tái hiện R14 và audit full-state đã được chạy fail trước khi sửa.

## Kiểm chứng cuối

- `npm run typecheck`: PASS, exit 0.
- `npm test`: **259/259 PASS**, 29 files, **7.89 giây** wall time. Golden và snapshot campaign cũ giữ nguyên.
- Full-account test riêng: **5.328 giây**, dưới 15 giây; timeout regression đặt 15 giây.
- `npm run sim -- scenarios/full-account.json --rules all --out out/full-account`: **exit 0**, **6.99 giây**, gồm build.
- Có đủ `audit.jsonl`, `decisions.jsonl`, `notifications.jsonl`, `port-calls.jsonl`, `timeline.md` (và summary.json).
- `audit.jsonl`: **1,561,498 bytes**, khoảng **1.56 MB**, dưới 20 MB.
- 34 decisions; 41 port calls đều `ok`: updateCampaign 12, updateTargets keywords 18 / targets 3, createKeywords 4, listKeywords 2, createNegatives 2; updatePlacement 0.

## R14

Cờ hết hạn chỉ bị clear trong proposal hợp lệ khi reset được bật, cùng với count=1; không có proposal thì không mutate state. Effective count vẫn tính từ cờ hết hạn như trước. No-op của engine không commit reset.

Smoke 60 ngày: **5 lần tăng, chia chu kỳ 3 + 2**.

| Ngày (PT) | Ngày từ đầu | Bid mới | Count | W7 impressions |
| --- | --- | --- | --- | --- |
| 2026-10-09 | 8 | $.46 | 1 | 0 |
| 2026-10-16 | 15 | $.53 | 2 | 0 |
| 2026-10-23 | 22 | $.61 | 3, cờ đến 11-22 | 4 |
| 2026-11-22 | 52 | $.70 | 1, clear cờ | 53 |
| 2026-11-29 | 59 | $.80 | 2 | 76 |

Giữa các lần tăng đều ≥7 ngày theo lịch marketplace (có DST). Regression pure-rule 120 ngày với impression luôn thấp, bid khởi điểm thấp để không bị hard cap che khuất lỗi count: **3 + 3 + 3**, mỗi chu kỳ đóng bằng cờ 30 ngày. Test expiry không proposal xác nhận state giữ nguyên.

## Audit và hiệu năng

Audit before/after là diff field đệ quy, chỉ chứa đối tượng/field thay đổi (kể cả negative/harvest khi liên quan); event không khớp có diff rỗng. inputsSnapshot chỉ chứa reads, paramsVersion, configHash SHA-256, now; không chứa state hay raw facts. Recorder reset trước từng rule. Mọi MATCHED trong smoke có diff, rule đọc metrics có reads; SKIPPED_NOOP có reads và diff rỗng.

Decision trong bộ nhớ vẫn đầy đủ phục vụ runner. CLI xuất decision diff bằng generator, ghi JSONL qua createWriteStream với backpressure. AuditLog cung cấp event/JSONL iterator và không I/O. `config.audit.level='all'` mặc định; `'matched'` chỉ lưu MATCHED/ERROR.

Profile chỉ ra daily query lặp kiểm tra hourly bucket bằng Luxon; dailyOnly lọc hourly/placement trước resolve fact, giữ nguyên daily totals và golden, giúp đạt mốc 15 giây.

Assertion no-op audit cũ trong engine.test.ts đổi từ full after state sang before/after rỗng theo hợp đồng mới; giải thích trong README. Không đổi golden/snapshot campaign.

## Phát hiện E6

AUTO nguồn bị R06 pause ngày 8 (2026-10-09), cần user confirm để bật lại. Budget tăng ngày 4; harvest 10-04, negative nguồn sau xác minh ngày 5 (10-06). W_post 10-05–10-07: 470 impressions, **33 clicks, $23.287437, 0 orders, $0 sales**, đạt Spend_zero=$21 và N2=20; hai ngày zero-order 10-06–10-07 có 22 clicks/$15.353274. Scenario chỉ có hai search term nên tác động mất toàn bộ đơn bị phóng đại. Ghi nhận trong README, không đổi rule/scenario.

Bleeder: R12 10-07 ($1→$.80), R13 10-10 PAUSED. Harvest term tốt Chủ Nhật 10-04, anchor $.63; source negative chỉ sau verified. Term rác negative 10-08.

Target cuối: auto-source $.71 (−11.25%, stalled 53 ngày), winner $1.08 (+54.29%, 38 ngày), bleeder $.80 (−20%, PAUSED, 54 ngày), low $.80 (+100%, 1 ngày), harvested $1.08 (+71.43%, 16 ngày). Target auto-source còn ENABLED nhưng campaign nguồn PAUSED nên không chạy traffic.

## File sửa trong lượt khắc phục này

- `README.md`
- `config/defaults.ts`
- `src/audit/log.ts`
- `src/cli/sim.ts`
- `src/data/facts.ts`
- `src/data/metrics.ts`
- `src/engine/priority.ts`
- `src/rules/target/r14.ts`
- `src/runner/accountLoop.ts`
- `test/audit-compact.test.ts` (mới)
- `test/engine.test.ts`
- `test/full-account.test.ts`
- `test/target.test.ts`
- `docs/step-4-plan.md`
- `docs/step-4-status.md`

Checkbox trong step-4-plan.md đã đánh dấu hoàn tất. Không đụng các thay đổi có sẵn ngoài simulator.
