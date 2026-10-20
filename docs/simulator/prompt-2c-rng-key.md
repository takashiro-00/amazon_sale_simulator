# PROMPT 2c — Khóa RNG nhu cầu theo campaign

```text
# BỐI CẢNH
./simulator, Bước 2. Trong src/market/driver.ts, RNG nhu cầu và attribution đang được fork theo
`target:${kind}:${text}`, không có campaign. Vì vậy cùng một keyword ở hai campaign khác nhau
(ví dụ Auto và Manual Exact sau khi R15 harvest) nhận chuỗi ngẫu nhiên GIỐNG HỆT nhau.
Probe: 2 campaign không cạn ngân sách, cùng target text "winner" → chuỗi click theo giờ giống hệt.
Chỉ sửa trong ./simulator. Không thêm dependency. Thay đổi nhỏ, tập trung đúng chỗ.

# SỬA
- Khóa mọi fork RNG theo target (nhu cầu, attribution, và các fork khác dùng cùng khóa) bằng
  `target:${campaignId}:${kind}:${normalizeText(text)}`.
  Gom vào một helper duy nhất, ví dụ targetRngKey(campaignId, view), và dùng ở mọi chỗ.
- Vẫn giữ tính chất: đổi target ID (cùng campaign, cùng kind, cùng text) không đổi kết quả.
- Cập nhật comment SPEC-AMBIGUITY và README (giải thích khóa RNG và hash thay đổi).

# NGHIỆM THU
1. Test mới: 2 campaign không cạn ngân sách, mỗi campaign 1 target cùng kind+text, cùng sự thật
   ngầm → chuỗi click theo giờ KHÁC nhau. Tổng impression 40 ngày chênh nhau ≤ 15%
   (cùng phân phối, khác mẫu).
2. Test mới: cùng campaign, đổi target ID (giữ kind+text) → facts giống hệt nhau.
3. Test mới: cùng campaign và target, đổi hoa/thường hoặc khoảng trắng của text → kết quả
   giống hệt nhau (nhờ normalizeText).
4. Test cũ vẫn pass. Nếu hash/fixture kỳ vọng phải đổi thì cập nhật và giải thích trong README.
5. npm run typecheck và npm test pass.
Kết thúc: liệt kê file đã sửa và kết quả npm test.
```
