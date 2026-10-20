# PROMPT 2b — Sửa 4 lỗi review Bước 2

```text
# BỐI CẢNH
./simulator đã xong Bước 2 (market model, reporting, driver, faulty port, scenario, CLI).
Review bằng probe phát hiện 4 lỗi dưới đây. Chỉ sửa trong ./simulator.
Không thêm dependency. evaluate() của rule vẫn trả null.
Với mỗi lỗi: viết test tái hiện trước (phải fail trên code hiện tại), sau đó sửa, rồi test pass.

# LỖI 1 — Độ trễ attribution bị rút ngắn 1 ngày (src/market/reporting.ts)
Hiện tại: knownAt của đơn = 00:00 PT của ngày click + lagDays. Báo cáo ngày D phát hành lần đầu
lúc D+1 03:00 PT, nên đơn có lag=1 (knownAt D+1 00:00) lọt vào báo cáo đầu tiên.
Probe: lagDistribution {"1":1} → báo cáo D+1 03:00 có 3/3 đơn, đáng lẽ phải là 0.
Quy ước đúng (đã chốt): "lag N" = đơn xuất hiện lần đầu ở lần phát hành daily thứ N+1 của ngày
click. Tức là lag 0 có trong báo cáo D+1 03:00, lag 1 có từ D+2 03:00, lag k có từ D+1+k 03:00.
Hourly stream áp dụng cùng quy ước: lag 0 có ở lần phát hành đầu tiên của giờ đó; lag k có từ
lần phát hành daily-restatement tương ứng (D+1+k 03:00 PT).
Trả hàng: returnedAt tính theo cùng mốc. Đơn biến mất ở lần phát hành thứ
max(lag, returnLagDays)+1, giới hạn tối đa đến D+14.
Nghiệm thu:
- lag {"1":1}: as-of D+1 03:00 thấy 0 đơn, as-of D+2 03:00 thấy đủ.
- lag {"0":1}: as-of D+1 03:00 thấy đủ.
- Với phân phối mặc định của golden, khi rule chạy ngày D đọc ngày D-2 thì tỷ lệ đơn thấy được
  khớp tổng P(lag ≤ 1) trong sai số thống kê. Test trên hàm tính, không dựa vào mẫu ngẫu nhiên.

# LỖI 2 — Budget chung bị chia theo thứ tự ID target (src/market/driver.ts, model.ts)
Hiện tại: driver sắp target theo ID. Target đầu chạy trọn giờ và tiêu ngân sách trước.
Probe: 2 target giống hệt nhau ("a", "b") trong campaign $5, 14 ngày → impression a=2129, b=326.
Sửa: trong mỗi giờ, sinh dòng impression của TẤT CẢ target trong campaign rồi trộn thứ tự
bằng rng có seed (ví dụ fork theo campaign + giờ). Sau đó duyệt chung với một bộ đếm ngân sách;
khi cạn thì dừng toàn bộ campaign.
Giữ nguyên tính chất: số ngẫu nhiên tự nhiên (impression, click, CVR) của từng target vẫn
được fork theo target, để thêm target không làm đổi "nhu cầu" của target khác.
Nghiệm thu:
- 2 target giống hệt nhau, campaign bị cạn ngân sách: tổng impression 14 ngày chênh ≤ 15%.
- Đổi tên ID (a↔b hoặc "zzz"/"aaa") cho ra cùng tổng impression theo vai trò (đối xứng).
- Campaign không bị cạn: kết quả từng target giống như khi target đó chạy một mình.
Đổi lại comment SPEC-AMBIGUITY tương ứng.

# LỖI 3 — Scenario golden-winner không mô phỏng campaign "thắng" (scenarios/golden-winner.json)
Hiện tại: budget $5 cạn ngay trong giờ 00 PT mỗi ngày (click theo giờ [9,0,0,…]). Chỉ có
14 ngày. ACoS ≈ 8%.
Sửa scenario (KHÔNG sửa mô hình để khớp):
- days = 40.
- Chỉnh baseImpressionsPerDay, ctr, clearingPrice, bid, hourlyTrafficCurve (dùng đường cong
  thực tế: thấp lúc 0–6h, cao 18–22h PT) sao cho:
  (a) ở budget $5 với bid tĩnh, ngân sách cạn trong khoảng 13:00–18:00 PT phần lớn các ngày;
  (b) nhu cầu không cạn đủ lớn để chi ≥ $25/ngày, nên khi rule nâng budget (Bước 3) thì vẫn
      tiêu hết;
  (c) ACoS kỳ vọng 18–22% (dưới T_win 28%), CVR thật quanh 12–15%.
- Thêm test tính bằng hàm kỳ vọng (không phải mẫu) để chứng minh (a), (b), (c).
- Giữ nguyên scenarios/budget-capped.json để thử riêng tình huống cạn sớm.

# LỖI 4 — Hiệu năng không đủ cho Monte Carlo
Hiện tại: 1 target × 14 ngày sinh 62.832 fact, facts.jsonl 15MB, CLI chạy 8.5 giây.
Nguyên nhân: mỗi giờ phát hành lại 15 lần × (tổng + 3 placement + mỗi search term) dù không
đổi gì; mô phỏng từng impression; queryFacts quét tuyến tính.
Sửa:
- Chỉ phát hành version mới khi số liệu của (entity, kỳ, chiều) THỰC SỰ khác version trước
  (có đơn mới hiện ra hoặc đơn bị trả). Version đầu luôn phát hành.
- Không phát hành fact placement PRODUCT_PAGE và fact search term khi toàn bộ chỉ số = 0 và
  chưa từng phát hành fact khác 0 cho chiều đó.
- Mô phỏng theo lô thay vì từng impression: rút số impression theo Poisson, chia cho placement và
  search term bằng multinomial, click theo binomial, đơn theo binomial. Chi phí là tổng các CPC
  ngẫu nhiên. Riêng khi gần cạn ngân sách (khi tổng chi phí của lô vượt phần còn lại) thì được
  chuyển sang mô phỏng từng click để dừng đúng ở click cuối cùng còn đủ tiền.
  Bắt buộc giữ tất định theo seed.
- Thêm FactIndex (Map theo entityRef → marketplaceDate → versions đã sắp theo knownAt), dùng cho
  queryFacts khi có entityRef. Giữ API cũ.
Nghiệm thu:
- golden-winner 14 ngày (bản cũ, giữ làm fixture perf trong test) hoặc 1 target × 14 ngày:
  runScenario < 0.5 giây, số fact giảm ≥ 10× so với 62.832.
- Benchmark test: 20 target × 60 ngày chạy < 10 giây. Ghi số liệu vào README.
- Tất định: cùng seed → cùng hash. Hash mới khác hash cũ (ghi chú trong README).
- queryFacts có index cho cùng kết quả với bản tuyến tính trên 3 scenario mẫu (test so sánh).
- Mọi bất biến cũ vẫn giữ: CPC ≤ bid, chi tiêu ≤ cap, tổng hourly = daily khi noise = 0 (cả ngày
  DST), không fact nào có knownAt sớm hơn kỳ của nó.

# TIÊU CHÍ CHUNG
- npm run typecheck, npm test, npm run sim -- scenarios/golden-winner.json --out out/golden đều pass.
- Test cũ chỉ được đổi kỳ vọng kèm giải thích trong README.
- Kết thúc: liệt kê file đã sửa, test mới cho từng lỗi, kết quả npm test, thời gian chạy và số
  fact trước/sau, summary.json mới của golden-winner, click theo giờ của 1 ngày golden.
```
