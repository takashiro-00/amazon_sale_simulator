# PPC Rule Simulator v3.1 — Lộ trình & Edge Case

Nguồn: `Automation Rule v3.1` (PDF 9 trang). Prompt 1 nằm ở [prompt-1-master.md](prompt-1-master.md).

## 1. Lộ trình 5 bước

| Bước | Module | Bao gồm | Xong khi |
|---|---|---|---|
| **1. Nền móng** | `domain/`, `time/`, `data/facts`, `guards/`, `engine/priority` | G1 (ngưỡng), G4 (bộ nhớ trạng thái), G5 (khung first-match-wins), G6 (clampBid), G7 (tag/port interface), G8 (clock PT, DST), kho số liệu bitemporal. Chỉ có stub rule. | Test G1 khớp ví dụ $30/40%/10%, toàn bộ hàm guard có test |
| **2. Thế giới giả lập** | `market/`, `api/fakePort`, `scenarios/` | Mô hình thị trường: bid → impressions → click → đơn, theo giờ và theo placement. Độ trễ attribution + restatement. Budget cạn giữa ngày (dữ liệu bị cắt). Fake API có lỗi 429/5xx, ghi thành công một phần, đọc lại chưa thấy giá trị mới. Scenario DSL (JSON/YAML) dùng seed để chạy lại ra đúng kết quả. | Cùng một seed chạy 2 lần ra cùng kết quả; scenario "đơn về trễ" tạo được restatement |
| **3. Engine + nhóm Campaign** | `engine/`, `rules/campaign/` | resolveWindow (D-2, W_post, ngày chín), cooldown, ân hạn, "chỉ khớp khi thực sự đổi giá trị". R01–R09 + state machine tag NORMAL→MANAGE→ALERT→PAUSED_AUTO, R06B 2 bước, pre_tag_tier, baseline_acos. | 3 vòng đời trong Phần 10 của spec chạy ra đúng mốc ngày (golden test) |
| **4. Nhóm Target / Search term / Placement / Theo giờ** | `rules/target/`, `rules/searchTerm/`, `rules/placement/`, `rules/hourly/` | R10–R14, R15 (2 bước, không atomic), R16/R17 + ngoại lệ Exact, R18/R19, R20/R21/R21B. Chính sách xử lý xung đột liên cấp (campaign rule đổi bid keyword trong cùng run). Bộ lập lịch theo giờ. | Ví dụ "từ khóa không ra đơn" của spec: R12 rồi R13 đúng ngày; R21B chỉ gọi API 1 lần tại ranh giới khung giờ |
| **5. Orchestrator + Kiểm bất biến + Báo cáo** | `runner/`, `invariants/`, `report/` | Chạy N ngày theo tick giờ. Kiểm tra bất biến sau MỖI lần ghi. Bộ scenario edge case (mục 3). Monte Carlo nhiều seed. Báo cáo: timeline, audit giải thích, KPI (tỷ lệ pause nhầm, số lần lên xuống, chi tiêu lãng phí, thời gian để scale). | Mọi scenario ở mục 3 có test pass/fail tự động |

Nguyên tắc kiến trúc xuyên suốt:
- Rule là **hàm thuần** `evaluate(ctx) → Proposal | null`. Chỉ engine ghi trạng thái, chỉ port gọi API.
- Mọi quyết định lưu **ảnh chụp dữ liệu đầu vào** tại thời điểm `asOf`, nên luôn trả lời được "vì sao hôm đó rule X chạy".
- Tiền lưu bằng số nguyên micros. Bid làm tròn cent **trước khi** xét "có đổi giá trị không".

## 2. Chỗ spec mơ hồ cần anh chốt (đã thành flag trong `SimConfig.ambiguity`)

1. **Ngày thực hiện thay đổi** có tính vào W_post không? Spec ghi R02 ngày 4 → R03 ngày 8, khớp với cách "ngày đổi = ngày 0 tính vào". Nếu run chạy giữa ngày thì dữ liệu ngày đó lẫn trước và sau thay đổi.
2. **Phạm vi reset window**: R07/R06B/R09 đổi bid của keyword. Việc này có reset window của campaign không, và ngược lại?
3. **Xung đột liên cấp**: G5 chỉ xếp thứ tự trong cùng một cấp. R07 (cấp campaign, bid −10%) và R11 (cấp keyword, bid −20%) cùng chạy trên một keyword trong một run thì sao? Gộp lại thành −28% thì vi phạm giới hạn ±20% của G6.
4. **R04B "mỗi 3 ngày"** mâu thuẫn với Phần 10 "mỗi 8 ngày". Lý do: G2 bắt cửa sổ 7 ngày cần đủ 7 ngày chín sau lần đổi, nên thực tế mất ≥ 9 ngày. Cần chọn bên nào đúng.
5. **Cửa sổ 14 ngày của R06B** là 14 ngày lịch hay W_post? Nếu là lịch thì dính dữ liệu từ trước lần thay đổi, trái với G2.
6. **anchor_bid** reset khi nào? Ví dụ khi đổi giá bán hoặc BE. Nếu không reset, `0.5×anchor` có thể lớn hơn Bid_max mới và khoảng bid hợp lệ thành rỗng.
7. **R06B Bước 1 khi đang MANAGE**: có ghi đè pre_tag_tier không? Nếu có, mức budget gốc trước R07 bị mất (chỉ còn ≤ $8).
8. **Trần ToS 1.5×Bid_max** có tính hệ số giờ R21 (×1.15) không?

## 3. Edge case nguy hiểm nhất mà simulator PHẢI mô phỏng được

Xếp theo mức thiệt hại. ⛔ = gây hành động không đảo ngược được (PAUSE vĩnh viễn hoặc negative).

### A. Dữ liệu & thời gian

| # | Edge case | Vì sao nguy hiểm | Scenario cần dựng | Đạt khi |
|---|---|---|---|---|
| A1 ⛔ | **Bão attribution, đơn về trễ quá D-2** | G2 coi D-2 là "chín", nhưng Amazon vẫn ghi nhận thêm đơn tới 7–14 ngày. R06/R13 có thể PAUSE vĩnh viễn dựa trên số "0 đơn" sau đó bị sửa lại. | Phân phối độ trễ có đuôi dài, ví dụ 20% đơn về ở D+3 đến D+7. Có ngày lễ (Prime Day) làm độ trễ tăng gấp đôi. | Đo **tỷ lệ pause nhầm** = số pause mà dữ liệu cuối cùng (sau khi đủ đơn) không còn thỏa điều kiện. Ngưỡng do anh đặt. |
| A2 ⛔ | **Restatement làm 1 đơn biến mất** (trả hàng, hủy đơn) | Campaign có đúng 1 đơn ở D-3 → bị sửa thành 0 → R06/R08 kích hoạt muộn hơn dự kiến, hoặc kích hoạt sau khi đã scale budget. | Fact có version 2 với orders giảm. | Engine luôn dùng phiên bản ≤ asOf. Audit ghi được "quyết định dựa trên version nào". |
| A3 | **Chuyển DST (01/11/2026)** | Ngày 25 giờ, giờ 01:00 lặp lại hai lần. R20/R21 gom 28 ngày theo giờ bị lệch. R21B có thể gọi API hai lần hoặc bỏ sót ranh giới khung. | Chạy qua 01/11/2026 và 08/03/2027. | Mỗi ngày tổng click theo giờ = click theo ngày. R21B đúng 1 call mỗi ranh giới. |
| A4 | **Run theo giờ Hà Nội** | 08:00 Hà Nội = chiều hôm trước theo PT, nên D-2 lệch 1 ngày. R15 "Chủ Nhật" chạy nhầm sang thứ Bảy hoặc thứ Hai. | Runner đặt ở Asia/Ho_Chi_Minh. | Mọi ngày và lịch đều tính theo PT. |
| A5 | **Budget cạn giữa ngày làm méo dữ liệu theo giờ** | Campaign hết budget lúc 15h thì các giờ tối có 0 click. R20/R21 kết luận sai về "giờ yếu", còn R04B "tiêu ≥90%" lại thỏa. | Market model cắt traffic khi chi tiêu chạm budget. | Simulator báo được số giờ thiếu dữ liệu. Có test chứng minh R20 không giảm bid cho giờ thiếu dữ liệu, nếu anh chọn hành vi đó. |
| A6 | **Hourly (Marketing Stream) ≠ báo cáo ngày** | Hai nguồn số liệu lệch nhau thì R20/R21 và R10/R11 nhìn thấy hai thực tế khác nhau. | Thêm nhiễu và độ trễ riêng cho nguồn hourly. | Có cảnh báo khi độ lệch vượt X%. |

### B. Xung đột giữa các rule

| # | Edge case | Vì sao nguy hiểm | Scenario | Đạt khi |
|---|---|---|---|---|
| B1 ⛔ | **R05 cướp lượt của R08/R06** | R08 chỉ chạy mỗi 3 ngày, còn R05 chạy hàng ngày. Vào ngày R08 không đến lịch, R05-B (0 đơn) hạ thẳng về $5 và reset window. Sau đó ở $5 thì 3 ngày tiêu tối đa $15, có thể không còn đạt 0.6×Spend_zero ($12.6) để R08 kích hoạt. Tùy pha của lịch mà campaign được gắn ALERT hoặc không bao giờ được gắn. | Cùng một chuỗi dữ liệu, dịch mốc lịch every-3-days từ 0 đến 2 ngày. | Kết quả (có ALERT hay không) không phụ thuộc pha lịch, hoặc báo cáo chỉ rõ sự phụ thuộc này. |
| B2 ⛔ | **Window bị reset liên tục làm R06 không bao giờ chạy** | R06 đo "từ lần reset gần nhất". Nếu các rule ưu tiên thấp hơn liên tục đổi budget hoặc bid (R05, R07, R09 khôi phục +10% mỗi 3 ngày), window không bao giờ tích đủ Spend_zero, dù tổng tiền đốt thực tế vượt xa. | Campaign 0 đơn kéo dài 30 ngày, có tag và đang khôi phục bid. | Bất biến: tổng chi tiêu 0 đơn tính theo lịch không vượt K×Spend_zero mà không có cảnh báo. |
| B3 | **R06 và R08 cùng khớp, R06B Bước 2 và R09 cùng khớp** | R09 có thể gỡ tag (tag ≥ 6 ngày, đạt 2 lần kiểm tra) trước khi R06B Bước 2 kịp đánh giá ở ngày 7–9. Khi đó r06bPhase bị treo trên campaign đã về NORMAL. | Campaign lỗ nặng hồi phục đúng ngày 6–9. | r06bPhase luôn nhất quán với tag (bất biến). |
| B4 | **Xung đột liên cấp ghi cùng một bid** | R07 (−10%) và R11/R12 trên cùng keyword trong một run. Hoặc R09 khôi phục +10% cùng lúc R12 giảm ×0.8. | Ép cả hai cùng khớp trong một ngày. | Không bao giờ có 2 lần ghi baseBid/target/run. Tổng thay đổi ≤ ±20%. |
| B5 | **Bỏ qua no-op rồi rơi xuống rule ngược chiều** | "Chỉ khớp khi thực sự đổi giá trị": rule cao bị kẹp ở giới hạn nên no-op, lượt chuyển cho rule thấp hơn có thể đi ngược hướng. Ví dụ R12 ở sàn thì no-op, R13 chưa đủ 30 click, rule thấp hơn lại tăng bid. | Keyword 0 đơn đang ở sàn, ít impression. | Bất biến: keyword có cờ lãng phí không bao giờ được tăng bid. |
| B6 | **pre_tag_tier bị ghi đè** | R07 lưu $14.4, hạ về $8. Sau đó R06B Bước 1 lưu lại "$8". Khi R09 gỡ tag thì budget không bao giờ quay lại $14.4. | NORMAL → R07 → R06B → R09. | Theo flag `r06bOverwritesPreTagTier`. |

### C. Bid "trôi" và vòng xoáy chết

| # | Edge case | Vì sao nguy hiểm | Scenario | Đạt khi |
|---|---|---|---|---|
| C1 | **Bid decay xếp chồng** | R07 −10%, R06B −20%, R11 tối đa −20%, R12 ×0.8 lặp lại, cộng R20 ×0.7 theo giờ. Bid hiệu dụng có thể xuống ≈ 0.5×anchor×0.7, thấp hơn sàn thực tế. | Keyword đi qua tag → R11 → R12 → giờ yếu. | Bid hiệu dụng ≥ $0.20 trong mọi giờ. Có đo log decay. |
| C2 ⛔ | **Vòng xoáy chết vì thiếu mẫu** | Bid thấp làm ít impression, ít click, không bao giờ đủ N2/N3/15 click. Không rule nào khớp, keyword đứng im mãi. R14 muốn cứu thì bị chặn bởi cờ lãng phí hoặc tag. | Market có ngưỡng bid cạnh tranh, ví dụ dưới $0.45 thì gần như không có impression. | Báo cáo liệt kê target "đứng im > 30 ngày". |
| C3 | **Khôi phục không đối xứng** | −10% rồi +10% cho 0.99, không về đúng giá trị cũ. Làm tròn cent cộng dồn qua nhiều chu kỳ. R09 phải tách phần giảm do tag khỏi phần giảm do R11/R12. | 5 chu kỳ MANAGE ↔ NORMAL. | Sau khi khôi phục xong: baseBid = trước tag × (các hệ số R11/R12 xảy ra trong lúc có tag), sai số ≤ $0.01. |
| C4 | **Khoảng bid hợp lệ rỗng** | Giá bán giảm, Bid_max giảm xuống dưới 0.5×anchor. Hoặc sản phẩm không khả thi (Bid_max = $0.20 = sàn), khi đó R10/R14 không bao giờ khớp và R11 luôn no-op. | Đổi G1 giữa chừng; sản phẩm $5. | Có cảnh báo EMPTY_BID_RANGE. Không crash, không gửi bid ngoài [$0.20, Bid_max]. |
| C5 | **Trần ToS bị vi phạm sau đó** | R18 tăng ToS lúc bid thấp, sau đó R10 tăng base, hoặc R21 nhân 1.15, làm base×hệ số×(1+ToS) vượt 1.5×Bid_max mà không rule nào kiểm tra lại. | R18 rồi R10 rồi giờ mạnh. | Bất biến G6 được kiểm tra sau MỌI lần ghi, kể cả lần ghi ở rule khác. |

### D. Thống kê và dao động

| # | Edge case | Scenario | Đạt khi |
|---|---|---|---|
| D1 | **Ít đơn, ACoS nhảy mạnh** (spec Phần 11): một đơn ngẫu nhiên đẩy campaign lên R02/R03, rồi R05 hạ, rồi lại lên. | Monte Carlo với CVR thật = ngưỡng ± 10%. | Đo số lần đảo chiều budget/bid mỗi 30 ngày. Nêu ngưỡng chấp nhận. |
| D2 | **baseline_acos chụp lúc gặp may** làm R07 gắn tag quá nhạy (đã có max(…, T_win) chặn một phần). | Ghi baseline trong giai đoạn 3 ngày có ACoS thấp bất thường. | Thống kê số lần R07 gắn tag oan. |
| D3 | **ACoS chia cho 0 hoặc vô cực**: có đơn nhưng sales = $0 (coupon 100%); CVR phần còn lại = 0 nên R18 "≥ 2×0" luôn đúng. | Fixture riêng. | Không rule nào khớp chỉ vì phép chia cho 0. |

### E. API & vận hành

| # | Edge case | Vì sao nguy hiểm | Đạt khi |
|---|---|---|---|
| E1 ⛔ | **R15 không atomic**: tạo Exact thất bại hoặc chưa đọc lại được mà negative nguồn đã thêm, search term tốt bị chặn ở cả hai nơi. | Fake port làm lỗi bước i, hoặc "thành công nhưng đọc lại chưa thấy". | Không bao giờ có negative nguồn khi Exact chưa được xác nhận tồn tại. |
| E2 | **Run lặp hoặc crash giữa chừng**: chạy lại cùng ngày làm R12 nhân ×0.8 hai lần. | Kill runner sau 50% số lần ghi, rồi chạy lại. | Idempotency key: kết quả giống hệt chạy một lần. |
| E3 | **Đọc lại chưa thấy giá trị mới (eventual consistency)**: đọc lại thấy giá trị cũ, coi là no-op hoặc áp lại lần nữa. | Port trả giá trị cũ trong T phút. | Engine dùng trạng thái của chính nó (G4), không dùng giá trị đọc lại từ API. |
| E4 | **Người dùng sửa tay trên console** (đổi bid, bật lại campaign PAUSED_AUTO): base_bid hoặc tag trong bộ nhớ lệch với Amazon. | Bơm sự kiện "sửa tay". | Phát hiện lệch và có chính sách rõ ràng (tin Amazon hay tin bộ nhớ). PAUSED_AUTO không tự bật lại. |
| E5 | **Tag kép, sai endpoint, negative trùng** (G7). | Tên campaign bẩn sẵn `[alert][MANAGE]`, keyword trùng khác hoa/thường. | 0 tag kép, 0 bản trùng. |
| E6 | **Ăn thịt lẫn nhau giữa các campaign** (R15): chuyển term tốt sang Exact làm campaign nguồn mất đơn, ACoS tăng, R07 tag oan campaign nguồn. | 1 Auto + 1 Manual cùng ASIN. | Báo cáo theo ASIN, không chỉ theo campaign. |

## 4. Gợi ý thứ tự viết scenario (Bước 5)

Golden tests (Phần 10 của spec) → A1, B1, B2 → C2, E1 → phần còn lại.
Sáu case A1, B1, B2, C2, E1, E2 là nơi bug gây mất tiền hoặc gây pause vĩnh viễn.
