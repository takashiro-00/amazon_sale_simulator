# Bộ Rule Tự động Tối ưu Amazon PPC v3.2 (đề xuất)

Dựa trên [spec-v3.1.md](spec-v3.1.md). Bản này thêm 4 thay đổi (P3, P4, P6, P7) đã được thử trên simulator. Danh sách thay đổi và bằng chứng nằm ở mục **Nhật ký thay đổi** cuối tài liệu. Chỗ thay đổi so với v3.1 được đánh dấu **[v3.2]**.

## Phần 1. Tham số theo sản phẩm (G1)

Mỗi ASIN có: Price, BE (ACoS hòa vốn), Exp_CVR (mặc định 10%).

| Tên | Công thức |
|---|---|
| T_win | min(30%, 0.7×BE) |
| T_ok | min(40%, 0.9×BE) |
| T_bad | min(50%, 1.1×BE) |
| CPA_target | Price × T_win |
| Spend_zero | 2.5 × CPA_target, kẹp trong [$10, $40] |
| N2 | 2 ÷ Exp_CVR, làm tròn lên (mặc định 20) |
| N3 | 3 ÷ Exp_CVR (mặc định 30) |
| N2h | N2 ÷ 2 (mặc định 10) |
| N17 | 0.6 × N2 (mặc định 12) |
| Bid_min | $0.20 |
| Bid_max | max($0.20, min($3, Price × CVR × T_ok)) |

Ví dụ: $30, BE 40%, CVR 10% → T_win 28%, T_ok 36%, T_bad 44%, CPA $8.40, Spend_zero $21, N2 20, N3 30, Bid_max $1.08.

Ngưỡng ACoS:
- Budget: dưới T_ok thì tăng; từ T_ok đến dưới T_bad thì giữ nguyên; từ T_bad trở lên thì giảm.
- Bid: ≤ T_win thì tăng; trên T_win đến T_ok thì giữ; trên T_ok thì giảm.

Các trường hợp ACoS đặc biệt:
- Chưa chi tiêu: ACoS không xác định, mọi so sánh đều không thỏa.
- Có chi tiêu, doanh số = 0: ACoS = vô cực.

Nếu Bid_max tính ra < $0.20: đặt Bid_max = $0.20 và cảnh báo "sản phẩm không khả thi ở bid tối thiểu".

## Phần 2. Quy tắc chung

**G2. Chỉ dùng dữ liệu đã chín**
- Cửa sổ W3/W7/W14 kết thúc ở D-2.
- "0 đơn" chỉ đúng khi không có đơn ở cả D-3 lẫn D-2.
- W_post tính từ sau lần thay đổi gần nhất, tối đa 30 ngày.
- Rule dùng cửa sổ 3 ngày cần đủ 3 ngày chín sau lần đổi gần nhất; rule 7 ngày cần đủ 7 ngày.

**G3. Reset, cooldown, ân hạn**
- Mỗi lần đổi bid/budget/placement thì reset cửa sổ đo.
- Thay đổi no-op (giá trị không đổi) không reset và không tính cooldown.
- Cooldown: bid 3 ngày (5 ngày sau R12), budget 2 ngày, placement 7 ngày.
- Campaign mới hoặc vừa bật lại có 3 ngày ân hạn. Trong thời gian này R02–R05, R06, R06B, R07, R08, R09 không chạy.

**G4. Bộ nhớ**
- Campaign: tag (NORMAL/MANAGE/ALERT/PAUSED_AUTO), bậc budget, pre_tag_tier, baseline_acos, thời điểm đổi gần nhất, thời điểm bắt đầu cửa sổ đo, thời điểm gắn tag, giai đoạn R06B, số lần kiểm tra R09 đạt, % boost ToS, **[v3.2]** ngày hết ân hạn harvest (xem R15).
- Target: base_bid, anchor_bid, hệ số giảm do tag, hệ số theo giờ, mốc hết cờ lãng phí, cờ ít lượt hiển thị, số lần R12, số lần R14.
- Bid gửi lên Amazon = base_bid × hệ số giờ hiện tại.
- baseline_acos được ghi khi R02/R03/R04/R04B tăng budget và khi R09 gỡ tag.

**G5. First-match-wins**
- Mỗi đối tượng chỉ nhận 1 hành động mỗi lần chạy.
- Rule chỉ "khớp" khi thực sự đổi được giá trị.
- Thứ tự ưu tiên:
  - Campaign: R06 > R06B > R08 > R05 > R07 > R09 > R04B > R04 > R03 > R02
  - Target: R13 > R12 > R11 > R10 > R14
  - Search term: R15 > R16 > R17
  - Placement: R19 > R18
  - Theo giờ: bỏ qua target PAUSED > R20/R21 (R21B gộp vào cùng 1 lần ghi)

**G6. Giới hạn bid**
- Mỗi lần đổi base_bid tối đa ±20%. R20/R21/R21B không bị giới hạn này.
- $0.20 ≤ bid ≤ Bid_max.
- Bid hiệu dụng × (1 + ToS%) ≤ 1.5 × Bid_max.
- base_bid luôn trong [0.5×, 2×] anchor_bid.
- Áp dụng cho: R06B, R07, R09, R10, R11, R12, R14, R15, R18, R20, R21, R21B.

**G7. Gọi API an toàn**
- Xóa [MANAGE]/[ALERT] bằng regex trước khi gắn tag mới.
- Kiểm tra trùng trước khi tạo keyword hoặc negative.
- Mức nghiêm trọng ALERT > MANAGE; không bao giờ ghi đè ALERT bằng MANAGE.
- Endpoint: keyword dùng `/sp/keywords`; Auto/Product dùng `/sp/targets`.

**G8. Múi giờ**: dùng giờ marketplace (Mỹ = America/Los_Angeles).

## Phần 3. Ngân sách campaign

**Thang budget (CHÍNH XÁC):** $5 → $8 → $10 → $12 → $14.40 → $17.28 → $20.74 → $24.88 → $25. Từ $12 trở lên mỗi bậc ×1.2, tối đa $25.

- **R01** (hàng ngày): campaign mới hoặc được bật lại.
  - Đặt budget $5, tag NORMAL, xóa thông tin tag cũ, reset cửa sổ, bắt đầu 3 ngày ân hạn.
  - Campaign PAUSED_AUTO chỉ được bật lại khi người dùng xác nhận.
- **R02**: NORMAL, budget $5, W3 có ≥1 đơn, ACoS < T_ok → $8, ghi baseline. Cooldown 2 ngày.
- **R03**: NORMAL, $8, W3 có ≥2 đơn, ACoS < T_ok → $10.
- **R04**: NORMAL, $10, cả 3 ngày đều có ≥1 đơn, ACoS < T_ok → $12.
- **R04B**: NORMAL, budget ≥ $12, tiêu ≥90% budget ở ≥5/7 ngày, W7 có ≥5 đơn, ACoS < T_win → budget ×1.2 (tối đa $25; đã $25 thì no-op). Cooldown 3 ngày.
  - **[v3.2]** W7 phải có đủ 7 ngày dữ liệu chín sau lần tăng budget trước (G2). Vì vậy trên thực tế R04B chạy khoảng **mỗi 8 ngày lịch**, không phải mỗi 3 ngày. Cooldown 3 ngày không thay thế yêu cầu dữ liệu chín này.
- **R05** (hàng ngày, cooldown 2 ngày, chỉ khi budget > $5):
  - A: W3 có ≥1 đơn và ACoS ≥ T_bad → hạ 1 bậc.
  - B: W3 có 0 đơn và chi tiêu ≥ min(CPA_target, 0.6×Spend_zero) → về $5.
- **R06** (hàng ngày, ưu tiên số 1): từ lần reset gần nhất (tối đa 14 ngày) có 0 đơn, và một trong hai:
  - chi tiêu ≥ Spend_zero và click ≥ N2; hoặc
  - chi tiêu ≥ min(2.5×Spend_zero, $63).

  Hành động: PAUSE, budget $5, tag PAUSED_AUTO, gửi thông báo. Không tự bật lại.
  - **[v3.2]** Không chạy trên campaign nguồn đang trong **ân hạn harvest** (7 ngày sau khi R15 thêm Negative Exact vào campaign đó, xem R15).
- **R06B** (hàng ngày): W14 có ≥1 đơn, chi tiêu ≥ Spend_zero, ACoS > 1.5×BE.
  - Bước 1: lưu bậc budget cũ, gắn [MANAGE] (nếu đang ALERT thì giữ ALERT), budget $5, bid −20%.
  - Bước 2 (sau 7 ngày): nếu ACoS W7 vẫn > 1.5×BE thì PAUSE (PAUSED_AUTO); nếu đã khá hơn thì giữ tag và để R09 xử lý.

## Phần 4. Gắn/gỡ tag (R07, R09 mỗi 3 ngày; **[v3.2]** R08 hằng ngày)

- **R07** [MANAGE]: NORMAL, W7 có ≥1 đơn và ≥10 click, ACoS_W7 > max(1.1×ACoS nền, T_win).
  - ACoS nền = min(baseline_acos, T_ok); nếu chưa có baseline thì dùng T_ok.
  - Hành động: gắn tag, lưu bậc budget cũ, budget = min(hiện tại, $8), bid −10% một lần. Tổng giảm do tag không quá −30%.
  - Khi đang có tag: chặn R02–R04B, R10, R14, R18, R21.
- **R08** [ALERT]: W3 có 0 đơn, chi tiêu ≥ 0.6×Spend_zero, 30 ngày qua từng có đơn, tag chưa phải ALERT.
  - Hành động: gắn ALERT (thay MANAGE), budget $5. Lưu bậc budget cũ nếu đang NORMAL; nếu đang MANAGE thì giữ giá trị đã lưu.
  - Gửi thông báo khẩn. Không đổi bid. Nếu đồng thời chạm R06 thì R06 thắng.
  - **[v3.2]** R08 chạy **hằng ngày** (v3.1: mỗi 3 ngày). Lý do: ở v3.1, việc campaign có bị gắn ALERT hay không, và vào ngày nào, phụ thuộc vào ngày bắt đầu lịch 3 ngày. Ở một số ngày, R05 hạ budget trước khi R08 kịp chạy.
  - **[v3.2] Lưu ý vận hành:** với sản phẩm có đơn về rất trễ (phần lớn đơn đến sau 5–7 ngày), R08 hằng ngày có thể gắn ALERT trên dữ liệu chưa chín thường hơn một chút. Nên kiểm tra độ trễ attribution thực tế của account trước khi bật.
- **R09** gỡ tag:
  - MANAGE: ACoS W7 ≤ max(ACoS nền, 0.9×T_win), có ≥1 đơn, đạt 2 lần kiểm tra liên tiếp, tag đã tồn tại ≥6 ngày.
  - ALERT: W7 có ≥2 đơn và ACoS ≤ T_ok.
  - Hành động:
    - Gỡ tag.
    - Budget tính lại nhưng không vượt pre_tag_tier.
    - Bid +10% mỗi 3 ngày đến khi hết phần đã giảm do tag; không hoàn tác thay đổi của R11/R12.
    - Ghi baseline mới.
  - Không chạy trong 3 ngày ân hạn.

## Phần 5. Bid target (hàng ngày)

- **R13** PAUSE: W14 có ≥30 click, 0 đơn, chi tiêu ≥ 2×CPA_target, và một trong hai:
  - đã bị R12 giảm ≥1 lần và từ đó có thêm ≥10 click mà vẫn 0 đơn; hoặc
  - bid đang ở sàn max($0.20, 0.5×anchor).
- **R12**: W_post (tối đa 14 ngày) có ≥20 click và 0 đơn.
  - Hành động: bid ×0.8 (không dưới sàn), cờ lãng phí 14 ngày (chặn R14), tăng r12Count. Cooldown 5 ngày.
  - Nếu bid đã ở sàn thì rule không khớp.
- **R11**: W_post có ≥15 click, ≥1 đơn, ACoS > T_ok → bid × max(T_ok/ACoS, 0.8). Cooldown 3 ngày.
- **R10**: NORMAL, hết cooldown, W14 có ≥3 đơn và ACoS ≤ T_win, và W_post (≥3 ngày, ≥15 click) ACoS ≤ T_win.
  - Hành động: bid ×1.10, không vượt min(Bid_max, 2×anchor). Cooldown 3 ngày.
- **R14**: W7 có <100 impression, bid < min($0.75, Bid_max), NORMAL, không có cờ lãng phí, không thuộc trường hợp (≥10 click và 0 đơn).
  - Hành động: bid ×1.15. Tối đa 3 lần, mỗi lần cách ≥7 ngày; sau đó đặt cờ ít lượt hiển thị 30 ngày.

## Phần 6. Search term

- **R15** (Chủ Nhật): search term từ campaign Auto/Broad/Phrase (bỏ qua Exact), W14 có ≥2 đơn, ACoS ≤ T_ok, Exact chưa tồn tại.
  - i. Tạo Exact trong campaign Manual, bid = CPC trung bình 14 ngày, kẹp trong [$0.20, Bid_max].
  - ii. Chỉ khi bước i thành công và đã kiểm tra lại mới thêm Negative Exact vào campaign nguồn.
  - iii. **[v3.2] Ân hạn harvest:** ngày Negative Exact được ghi thành công vào campaign nguồn là ngày 0. Trong 7 ngày lịch tiếp theo, R06 không chạy trên campaign nguồn; R06 được xét lại từ ngày 7. Các rule khác vẫn chạy bình thường. Lý do: sau khi chuyển term tốt sang Exact, campaign nguồn có thể tạm thời chỉ còn traffic kém và bị R06 pause vĩnh viễn ngay lập tức.
- **R16** (hàng ngày): W14 có ≥30 click, 0 đơn → Negative Exact (kiểm tra trùng trước).
  - Ngoại lệ: nếu search term trùng một Exact đang chạy thì không negative, chuyển cho R12/R13.
- **R17** (hàng ngày): W14 có chi tiêu ≥2.5×CPA_target, ≥12 click, 0 đơn → Negative Exact (cùng ngoại lệ với R16).

## Phần 7. Placement (hàng ngày, cooldown 7 ngày)

- **R18**: NORMAL; vị trí Top trong W14 có ≥30 click và ≥3 đơn; CVR Top ≥ 2× CVR phần còn lại (nếu phần còn lại <30 click thì so với CVR campaign); ACoS Top ≤ T_win.
  - Hành động: ToS +10 điểm, tối đa 100%, phải thỏa G6.
- **R19**: vị trí Top trong W14 có ≥20 click, ACoS > T_bad (0 đơn mà có chi tiêu cũng tính), chi tiêu Top ≥ 2×CPA_target, boost đang > 0 → ToS −20 điểm (thấp nhất 0).

## Phần 8. Theo giờ (dữ liệu 28 ngày theo giờ marketplace; chạy hàng tuần và theo khung giờ)

- **R20**: giờ H có ≥40 click và CVR giờ < 0.5×CVR campaign → bid = base × 0.70 (không dưới 0.5×base và $0.20). Bỏ qua target PAUSED.
- **R21**: giờ H có ≥40 click, ≥2 đơn, CVR giờ ≥ 1.3×CVR campaign, CVR campaign > 0, NORMAL → base × 1.15 (không vượt Bid_max). Bỏ qua PAUSED.
- **[v3.2] Chỉ học từ giờ có dữ liệu sạch (áp dụng cho R20 và R21):**
  - Với mỗi giờ H, bỏ khỏi thống kê những ngày mà giờ H bị cạn budget (campaign đã tiêu hết budget nên không có traffic ở giờ đó).
  - Chỉ đánh giá giờ H khi trong 28 ngày còn ≥ 20 ngày sạch của giờ H và vẫn đủ ngưỡng click/đơn ở trên. Không đủ thì hệ số giờ H = 1.0.
  - CVR campaign dùng để so sánh cũng chỉ tính trên các giờ-ngày sạch.
  - Lý do: giờ cạn budget không có traffic vì hết tiền, không phải vì giờ đó yếu. Học từ những giờ này cho ra hệ số sai.
- **R21B**: hết mỗi khung giờ → bid = base × hệ số của khung kế tiếp (không có hệ số thì ×1.0). Chỉ gọi API 1 lần tại ranh giới.

## Phần 10. Vòng đời mẫu (golden test)

Sản phẩm $30, BE 40%.

- **Campaign thắng:**
  - Ngày 0: tạo campaign, budget $5.
  - Ngày 4: R02 lên $8. Ngày 8: R03 lên $10. Ngày 12: R04 lên $12.
  - Từ ngày 20: R04B ×1.2 mỗi 8 ngày nếu vẫn tiêu hết budget và ACoS < 28%.
- **Campaign 0 đơn:** 3 ngày ân hạn; khi chi tiêu ≥ $21 và ≥20 click mà vẫn 0 đơn thì R06 PAUSE (khoảng ngày 7).
- **Xấu đi rồi hồi phục:**
  - ACoS lên 40%: R07 gắn MANAGE, budget ≤ $8, bid −10%.
  - Khi đạt ngưỡng 2 lần liên tiếp: R09 gỡ tag, budget về (không vượt mức cũ), bid +10% mỗi 3 ngày.
- **Từ khóa 0 đơn:**
  - 20 click: R12 −20% và đặt cờ.
  - Thêm 10 click vẫn 0 đơn (đủ 30 click, chi tiêu ≥ $16.8 trong 14 ngày): R13 PAUSE.

## Phần 11. Lưu ý

- Dữ liệu ít đơn thì ACoS dao động mạnh.
- R06 và R13 pause vĩnh viễn; phải bật thủ công (campaign cần người dùng xác nhận).
- Mọi số mặc định đều chỉnh được trong bảng tham số.
- **[v3.2]** Với sản phẩm có đơn về rất trễ (phần lớn đơn đến sau khoảng 1 tuần), quyết định "0 đơn" của R06/R13 thường sai khi dữ liệu chín hẳn. Simulator đo được pause sai ở 99% lượt chạy. Chờ thêm (dùng dữ liệu đến D-8 thay vì D-2) chỉ giảm được khoảng 30% và làm giảm lợi nhuận. Vì vậy v3.2 KHÔNG đổi cửa sổ D-2. Với nhóm sản phẩm này nên cân nhắc tắt pause vĩnh viễn hoặc đo độ trễ thực tế trước (hướng nghiên cứu cho bản sau).

## Nhật ký thay đổi v3.1 → v3.2

Mọi thay đổi đã được thử trên simulator: cùng 100 seed cho v3.1 và v3.2, kèm các edge case liên quan. Số liệu đầy đủ: `simulator/docs/simulator/v3.2-results.md`. Đề xuất gốc: [v3.2-proposals.md](v3.2-proposals.md).

| Mã | Thay đổi | Mục trong spec | Bằng chứng từ simulator | Flag simulator |
|---|---|---|---|---|
| P3 | R08 chạy hằng ngày thay vì mỗi 3 ngày | Phần 4, R08 | ALERT được gắn ở ngày 18 dù lịch bắt đầu ngày nào (v3.1: ngày 18, 22 hoặc 23). Không thêm quyết định sai trên kịch bản bão attribution. Trên nhóm sản phẩm có đơn về rất trễ, số ALERT sai tăng nhẹ (trung bình 0.15 → 0.18 mỗi lượt chạy), nên mới có lưu ý vận hành ở R08. | `v32.r08Daily=true` |
| P4 | 7 ngày ân hạn harvest: R06 không chạy trên campaign nguồn sau khi R15 thêm negative | Phần 3 R06; Phần 6 R15 bước iii; G4 | Kịch bản E6: v3.1 pause vĩnh viễn campaign Auto nguồn 3 ngày sau harvest; v3.2 không pause. Trên full-account: tiền lãng phí trung bình giảm $8.10, lợi nhuận không đổi. | `v32.postHarvestGraceDays=7` |
| P6 | R20/R21 bỏ giờ cạn budget, chỉ học khi có ≥ 20 ngày sạch | Phần 8 | Kịch bản hourly-signal: số hệ số giờ học từ giờ cạn budget giảm từ 3 xuống 0. Vẫn phát hiện đúng giờ yếu (R20) và giờ mạnh (R21). | `v32.hourlyExcludeCapped=true` |
| P7 | Sửa câu chữ R04B: thực tế khoảng 8 ngày lịch giữa hai lần tăng | Phần 3, R04B | Golden test: R04B ở ngày 20, 28, 36. Không đổi hành vi, chỉ sửa câu chữ. | — |

**Đã thử nhưng không đưa vào v3.2:**

| Mã | Đề xuất | Lý do không đưa vào |
|---|---|---|
| P1 | Dùng dữ liệu cũ hơn (D-3/D-5/D-8) cho điều kiện "0 đơn" | Với độ trễ đơn bình thường, v3.1 đã không có quyết định sai; chờ lâu hơn chỉ làm tăng tiền lãng phí (D-8: $48 → $106) và giảm lợi nhuận. Với nhóm đơn về rất trễ, D-8 chỉ giảm khoảng 30% số pause sai. |
| P2 | R06 thêm điều kiện theo 14 ngày lịch | Không xấu đi nhưng cũng không đo được lợi ích nào. Giữ làm tùy chọn. |
| P5 | Vùng đệm quanh ngưỡng ACoS cho bid/budget | Số lần lên xuống chỉ giảm khoảng 8%, chưa đạt mục tiêu 40%. |

**Không bật cả bộ một lúc chưa qua kiểm chứng:** bật đồng thời P2+P3+P4+P6 làm lợi nhuận trung bình giảm nhẹ ($3–4 trên các kịch bản full-account và bão attribution). Nên bật từng thay đổi và theo dõi.
