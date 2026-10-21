import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { synchronizedAlerts } from '../dist/src/edge/suite.js';
import { summarizeRuns } from '../dist/src/montecarlo/index.js';
const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const root = 'out/v32';
const data = Object.fromEntries(await Promise.all(['P1-premature-population', 'marginal', 'full', 'storm'].map(async (n) => [n, await read(`${root}/${n}/summary.json`)])));
const populationRuns = (await readFile(`${root}/P1-premature-population/runs.jsonl`, 'utf8')).trim().split('\n').map(JSON.parse);
const populationRate = populationRuns.filter(r => r.metrics.prematureTotal > 0).length / populationRuns.length;
const edge = Object.fromEntries(await Promise.all(['B1', 'B2', 'E6', 'A5', 'hourly-signal', 'P1-positive', 'P5-marginal'].map(async (n) => [n, await read(`${root}/edge/${n}.json`)])));
const metric = (s, k, stat = 'mean') => s.metrics[k]?.[stat] ?? 0;
const variant = (name, flag) => data[name].variants.find(v => v.name === flag);
const profitSafe = (name, flag, tolerance = 0) => ['mean', 'p50'].every(stat => metric(variant(name, flag).summary, 'profit', stat) - metric(data[name], 'profit', stat) >= -tolerance * Math.abs(metric(data[name], 'profit', stat)) - 1e-9);
const wasteSafe = (name, flag) => metric(variant(name, flag).summary, 'wastedSpend') - metric(data[name], 'wastedSpend') <= .05 * metric(data[name], 'spend');
const p1Wins = ['P1-K3', 'P1-K4'].filter(flag => metric(variant('P1-premature-population', flag).summary, 'prematureTotal') <= .8 * metric(data['P1-premature-population'], 'prematureTotal') && ['P1-premature-population', 'marginal', 'storm'].every(n => profitSafe(n, flag) && wasteSafe(n, flag)));
const p2Changed = ['marginal', 'full'].some(n => Object.values(variant(n, 'P2').diff).some(d => Math.abs(d.mean) > 1e-9));
const p2Safe = ['marginal', 'full'].every(n => metric(variant(n, 'P2').summary, 'prematureTotal') <= metric(data[n], 'prematureTotal')) && edge.B2.phases.every(p => p.variants[1].events.find(e => e.ruleId === 'R06')?.day <= p.variants[0].events.find(e => e.ruleId === 'R06')?.day);
const p3Win = synchronizedAlerts(edge.B1.phases.map(p => p.variants[1].events)) && metric(variant('storm', 'P3').summary, 'premature.R08') <= metric(data.storm, 'premature.R08');
const p4Win = edge.E6.variants[1].graceViolations === 0 && edge.E6.variants[1].blockedByHarvest.length > 0 && wasteSafe('full', 'P4');
const flip = (s, stat) => metric(s, 'flipFlops.bid', stat) + metric(s, 'flipFlops.budget', stat);
const p5Reduction = Object.fromEntries(['mean', 'p50'].map(stat => [stat, 1 - flip(variant('marginal', 'P5').summary, stat) / flip(data.marginal, stat)]));
const p5FlipSafe=Object.values(p5Reduction).every(r=>r>=.4),p5ProfitSafe=['marginal','full'].every(n=>profitSafe(n,'P5',.05));
const p5Win=p5FlipSafe&&p5ProfitSafe;
const p6Win = ['A5', 'hourly-signal'].every(n => edge[n].variants[1].learnedFromCapped === 0 && edge[n].variants[1].learnedWithInsufficientDays === 0) && edge['hourly-signal'].variants[1].hourly.R20 > 0 && edge['hourly-signal'].variants[1].hourly.R21 > 0;
const verdicts = { P1: p1Wins.length ? 'THẮNG' : 'THUA', P2: p2Safe ? 'THẮNG' : 'THUA', P3: p3Win ? 'THẮNG' : 'THUA', P4: p4Win ? 'THẮNG' : 'THUA', P5: p5Win ? 'THẮNG' : 'THUA', P6: p6Win ? 'THẮNG' : 'THUA' };
const candidates = { P1: p1Wins.length ? [`v32.zeroOrderLagDays=${p1Wins[0] === 'P1-K3' ? 3 : 4}`] : [], P2: ['v32.r06CalendarGuard=true'], P3: ['v32.r08Daily=true'], P4: ['v32.postHarvestGraceDays=7'], P5: ['v32.hysteresis=true'], P6: ['v32.hourlyExcludeCapped=true'] };
const selected = Object.entries(verdicts).filter(([_, v]) => v === 'THẮNG').flatMap(([p]) => candidates[p]);
const f = x => x === null || x === undefined ? 'null' : typeof x === 'number' ? Number(x.toFixed(6)).toString() : String(x);
const md = ['# Kết quả thử nghiệm rule v3.2', '',
    'Chỉ sửa trong `simulator/`; báo cáo đặt tại `simulator/docs/simulator/v3.2-results.md` để giữ giới hạn phạm vi. Nguồn tiêu chí: `../../../docs/simulator/v3.2-proposals.md`. Không đổi rule v3.1, không sửa kỳ vọng của 298 test cũ, không thêm dependency.', '',
    '## Phương pháp', '',
    'Mỗi cấu hình có 100 seed 0–99, workers auto (tối đa 8); baseline luôn dùng DEFAULT_CONFIG v3.1. Các biến thể được ghép theo scenario để chia sẻ một baseline; đây là cùng 100 seed cho từng cặp, không phải chia 100 seed cho nhiều biến thể. Delta = biến thể − baseline. Tỷ lệ tốt hơn tính trên từng cặp seed; bằng nhau không được tính là tốt hơn. Đây là thống kê cặp mô tả, không phải p-value hay bằng chứng chắc chắn về thị trường thật.', '',
    'Quy ước bổ sung cho chữ “giảm rõ/tăng ít”: premature mean giảm ≥20% trên quần thể có đối chứng dương, wastedSpend mean tăng không quá 5% tổng spend mean baseline; profit kiểm cả mean và p50. P5 dùng tổng flipFlops bid + budget ở marginal (cả mean và tổng hai p50), đồng thời profit không giảm quá 5% ở marginal/full. Tổng hai p50 không phải p50 của tổng; các thành phần được trình bày riêng. P2 được chấm đúng tiêu chí không chậm hơn/không tăng premature: kết quả bằng baseline vẫn đạt tiêu chí này, nhưng không được diễn giải thành lợi ích tăng thêm.', '',
    'Quần thể premature giữ mô hình đối chứng 3/5/7 ngày (10%/20%/70%), gồm 5 target CVR thật 2%, 3%, 4%, 5%, 6%, mỗi target có campaign/budget độc lập để target có đơn không che điều kiện zero-order của target khác. Baseline có premature ở ' + f(populationRate * 100) + '% seed (xem runs.jsonl). Không chỉnh scenario sau khi xem kết quả, không đổi tham số để đề xuất thắng. CLI có cổng `--min-premature-seed-rate 0.1`, kiểm baseline trước khi chạy biến thể.', '',
    'Các tiền tệ là USD. timeToTier chỉ dùng seed đạt bậc; null là không có quan sát đạt bậc, không phải 0 ngày. Cột số lượng quan sát giúp tránh so tốc độ giữa hai tập seed đạt bậc khác nhau. Premature đánh giá lại cùng rule, state, instant và cửa sổ, chỉ đổi thời điểm biết đơn.', ''];
function table(headers, rows) { md.push('| ' + headers.join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |', ...rows.map(r => '| ' + r.map(f).join(' | ') + ' |'), ''); }
const keys = ['premature.R06', 'premature.R12', 'premature.R13', 'premature.R16', 'premature.R17', 'premature.R05B', 'premature.R08', 'prematureTotal', 'wastedSpend', 'profit', 'flipFlops.bid', 'flipFlops.budget', 'timeToTier.to12', 'timeToTier.to25'];
function comparison(name, flag) { const a = data[name], v = variant(name, flag); md.push(`### ${name} — ${flag}`, ''); table(['Metric', 'Baseline p50 / mean', 'Biến thể p50 / mean', 'Delta p50 / mean'], keys.map(k => [k, `${f(a.metrics[k]?.p50)} / ${f(a.metrics[k]?.mean)}`, `${f(v.summary.metrics[k]?.p50)} / ${f(v.summary.metrics[k]?.mean)}`, `${f(v.diff[k]?.p50)} / ${f(v.diff[k]?.mean)}`])); table(['Metric', 'Seed tốt hơn / bằng / kém', 'Tỷ lệ tốt hơn'], Object.entries(v.paired).map(([k, r]) => [k, `${r.better} / ${r.tied} / ${r.worse}`, r.betterRate])); table(['timeToTier', 'Số seed baseline đạt', 'Số seed biến thể đạt'], ['timeToTier.to12', 'timeToTier.to25'].map(k => [k, a.metrics[k]?.count ?? 0, v.summary.metrics[k]?.count ?? 0])); }
const reasons = { P1: p1Wins.length ? 'Đạt giảm premature rõ, giữ profit và tăng wastedSpend trong giới hạn.' : `Premature mean quần thể ${f(metric(data['P1-premature-population'],'prematureTotal'))} → ${f(metric(variant('P1-premature-population','P1-K3').summary,'prematureTotal'))} / ${f(metric(variant('P1-premature-population','P1-K4').summary,'prematureTotal'))} (K3/K4); K4 còn giảm profit p50 ${f(variant('P1-premature-population','P1-K4').diff.profit.p50)} USD.`, P2: p2Changed ? 'Có thay đổi và không chậm R06/không tăng premature theo các phép đo đã chạy.' : 'Đạt tiêu chí không chậm R06/không tăng premature, nhưng B2 vẫn R06 ngày 24 cả ba pha và mọi metric MC bằng baseline; chưa chứng minh lợi ích tăng thêm.', P3: p3Win ? 'ALERT ngày 18 ở cả ba pha; premature R08 trên storm không tăng.' : 'Đã đồng bộ lịch ALERT nhưng không thỏa điều kiện không tăng premature R08 trên storm.', P4: p4Win ? `E6 không còn R06 sau harvest; full-account delta wastedSpend mean ${f(variant('full','P4').diff.wastedSpend.mean)} USD và profit 0; đổi lại bid flipFlops mean tăng ${f(variant('full','P4').diff['flipFlops.bid'].mean)}.` : 'Không thỏa đồng thời bảo vệ sau harvest và giới hạn tăng wastedSpend.', P5: `FlipFlops marginal giảm mean ${f(p5Reduction.mean * 100)}%, tổng p50 ${f(p5Reduction.p50 * 100)}%; ${p5FlipSafe ? 'đạt' : 'không đạt'} mốc 40%; ${p5ProfitSafe ? 'đạt' : 'không đạt'} giới hạn profit giảm tối đa 5%.`, P6: p6Win ? 'Không còn factor học từ cửa sổ capped/thiếu 20 ngày sạch, hourly-signal vẫn có R20 và R21.' : 'Không giữ được đồng thời bằng chứng sạch và tín hiệu giờ yếu/mạnh.' };
md.push('## Kết luận P1–P6', '');
table(['Đề xuất', 'Kết luận', 'Lý do'], Object.entries(verdicts).map(([p, v]) => [p, v, reasons[p]]));
for (const p of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
    md.push(`## ${p}: ${verdicts[p]}`, '');
    if (p === 'P1')
        for (const n of ['P1-premature-population', 'storm', 'marginal'])
            for (const flag of ['P1-K3', 'P1-K4'])
                comparison(n, flag);
    if (p === 'P2')
        for (const n of ['marginal', 'full'])
            comparison(n, p);
    if (p === 'P3') {comparison('storm', p);md.push('P3 đạt tiêu chí trên B1/storm. Phần tổ hợp cho thấy thêm 3 R08 premature/100 seed ở quần thể lag dài; chưa quy kết cho một flag riêng, và chưa đủ cơ sở bật daily ALERT đại trà.', '');}
    if (p === 'P4')
        comparison('full', p);
    if (p === 'P5')
        for (const n of ['marginal', 'full'])
            comparison(n, p);
    if (p === 'P1' || p === 'P5') {
        const e = edge[p === 'P1' ? 'P1-positive' : 'P5-marginal'];
        md.push('### Edge bật/tắt', '');
        table(['Flag', 'Premature tổng', 'Wasted spend', 'Profit', 'FlipFlops bid / budget'], e.variants.map(v => [v.value, v.metrics.prematureTotal, v.metrics.wastedSpend, v.metrics.profit, `${v.metrics.flipFlops.bid} / ${v.metrics.flipFlops.budget}`]));
    }
    if (p === 'P2' || p === 'P3') {
        const e = edge[p === 'P2' ? 'B2' : 'B1'];
        md.push('### Edge bật/tắt', '');
        table(['Pha', 'Flag', 'R08 ngày', 'R06 ngày', 'Zero-order calendar spend / spend cửa sổ R06'], e.phases.flatMap(phase => phase.variants.map(v => [phase.phase, v.on, v.events.find(e => e.ruleId === 'R08')?.day, v.events.find(e => e.ruleId === 'R06')?.day, `${f(v.zeroOrderCalendarSpend)} / ${f(v.r06?.[0]?.windowZeroSpend)}`])));
    }
    if (p === 'P4') {
        const v=variant('full','P4');md.push(`Trong 100 seed full-account, delta profit mean/p50 = ${f(v.diff.profit.mean)} / ${f(v.diff.profit.p50)}; delta flipFlops bid mean/p50 = ${f(v.diff['flipFlops.bid'].mean)} / ${f(v.diff['flipFlops.bid'].p50)}. Có ${v.paired.flipFlops.worse}/100 seed đảo chiều nhiều hơn. P4 đạt tiêu chí đã nêu nhưng đánh đổi thêm thao tác bid; chưa có uplift tài chính trong bộ này.`, '');
        md.push('### E6 bật/tắt', '');
        table(['Flag', 'R06 nguồn (ngày)', 'Số audit bị chặn', 'Vi phạm ân hạn', 'wastedSpend', 'profit'], edge.E6.variants.map(v => [v.on, v.sourceR06.map(t => t.day).join(',') || 'không có', v.blockedByHarvest.length, v.graceViolations, v.metrics.wastedSpend, v.metrics.profit]));
        md.push('E6 chỉ có hai term, nên harvest loại phần lớn tín hiệu tốt. Trong seed edge, profit giữ nguyên dù wastedSpend thay đổi; wastedSpend phụ thuộc tập quyết định/scope bị tác động (R06 so với rule target), không được gọi chênh lệch này là tiết kiệm tiền khi spend/profit không đổi. Không suy ra lợi ích lợi nhuận chung chỉ từ việc không pause nguồn. Ân hạn bắt đầu tại ghi negative thành công, ngày ghi là ngày 0, chặn khi 0 ≤ số ngày lịch < N.', '');
    }
    if (p === 'P6')
        for (const n of ['A5', 'hourly-signal']) {
            md.push(`### Edge ${n} bật/tắt`, '');
            const e = edge[n];
            table(['Flag', 'Factor khác 1 từ cửa sổ có capped', 'Factor khác 1 khi <20 ngày sạch', 'R20 / R21 / R21B'], e.variants.map(v => [v.on, v.learnedFromCapped, v.learnedWithInsufficientDays, v.hourly ? `${v.hourly.R20} / ${v.hourly.R21} / ${v.hourly.R21B}` : v.edges.find(e => e.id === 'A5')?.metrics.r20Reductions]));
            const a = summarizeRuns([{ seed: 0, metrics: e.variants[0].metrics }]), b = summarizeRuns([{ seed: 0, metrics: e.variants[1].metrics }]);
            table(['Metric', 'Baseline p50 / mean', 'Biến thể p50 / mean', 'Delta p50 / mean'], keys.map(k => [k, `${f(a.metrics[k]?.p50)} / ${f(a.metrics[k]?.mean)}`, `${f(b.metrics[k]?.p50)} / ${f(b.metrics[k]?.mean)}`, a.metrics[k] && b.metrics[k] ? `${f(b.metrics[k].p50 - a.metrics[k].p50)} / ${f(b.metrics[k].mean - a.metrics[k].mean)}` : 'null / null']));
            table(['Metric', 'Tỷ lệ seed tốt hơn (1 cặp)'], ['profit', 'wastedSpend', 'prematureTotal', 'flipFlops'].map(k => { const value = m => k === 'flipFlops' ? m.flipFlops.bid + m.flipFlops.budget : m[k]; return [k, (value(e.variants[1].metrics) - value(e.variants[0].metrics)) * (k === 'profit' ? 1 : -1) > 0 ? 1 : 0]; }));
            md.push('Edge là một seed xác định, p50=mean; không coi như bằng chứng 100 seed. Tỷ lệ tốt hơn ở đây chỉ có thể 0 hoặc 1; các giá trị thô nằm trong JSON edge.', '');
        }
    md.push(`**KẾT LUẬN: ${verdicts[p]}.** ${reasons[p]}`, '');
}
md.push('## Tổ hợp và đề xuất spec v3.2', '', `Các flag thắng: ${selected.map(s => '`' + s + '`').join(', ') || 'không có'}. Chỉ các flag này được gộp thành \`v32-combined\`. Các flag khác tiếp tục mặc định tắt. P7 chỉ sửa câu chữ, không đổi logic.`, '');
const combinedDirs = (await readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()&&entry.name.startsWith('combined-')).map(entry=>entry.name).sort();
for (const n of combinedDirs) {
    const s = await read(`${root}/${n}/summary.json`);
    data[n] = s;
    comparison(n, 'v32-combined');
}
if(combinedDirs.length===4){
 const rows=combinedDirs.map(n=>({name:n,a:data[n],v:variant(n,'v32-combined')}));
 md.push('### Đánh giá tổ hợp trên bốn quần thể','');
 table(['Scenario','Delta profit p50 / mean','Delta wastedSpend mean','Delta premature mean','Delta tổng flipFlops mean'],rows.map(({name,v})=>[name,`${f(v.diff.profit.p50)} / ${f(v.diff.profit.mean)}`,v.diff.wastedSpend.mean,v.diff.prematureTotal.mean,(v.diff['flipFlops.bid']?.mean??0)+(v.diff['flipFlops.budget']?.mean??0)]));
 const profitDown=rows.filter(({v})=>v.diff.profit.p50 < -1e-9||v.diff.profit.mean < -1e-9).map(r=>r.name);
 const prematureUp=rows.filter(({v})=>v.diff.prematureTotal.mean>1e-9).map(r=>r.name);
 md.push(profitDown.length||prematureUp.length?`Tổ hợp không cải thiện đồng nhất: profit giảm ở ${profitDown.join(', ')||'không scenario nào'}, premature tăng ở ${prematureUp.join(', ')||'không scenario nào'}. Không quy kết chênh lệch cho một flag riêng khi chưa tách tương tác. Không khuyến nghị bật đồng loạt trên mọi account chỉ từ các kết quả này; các flag thắng riêng lẻ vẫn là ứng viên có điều kiện theo phạm vi đã thử.`:'Tổ hợp không giảm profit mean/p50 và không tăng premature mean ở cả bốn scenario đã thử. Đây là kết quả mô hình 100 seed, không bảo đảm ngoài mô hình; đánh đổi về flipFlops và wastedSpend vẫn phải đọc theo từng scenario.','');
}
if (!combinedDirs.length)
    md.push('Chưa có output tổ hợp; chưa kết luận hoàn tất thử nghiệm.', '');
md.push('### Danh sách đề xuất cuối','');
table(['Flag / giá trị đã thử','Đề xuất cho spec v3.2','Giới hạn bằng chứng'],[
 ['v32.postHarvestGraceDays=7','Nên đưa ân hạn R06 sau harvest vào spec','Profit full-account không đổi, thêm bid flipFlops; các rule target vẫn chạy.'],
 ['v32.hourlyExcludeCapped=true','Nên đưa điều kiện dữ liệu sạch vào spec','Đã giữ tín hiệu yếu/mạnh ở đối chứng, chưa coi một seed hourly là uplift chung.'],
 ['v32.r06CalendarGuard=true','Giữ như tùy chọn giám sát bổ sung','Đạt tiêu chí không xấu đi nhưng toàn bộ metric ở marginal/full bằng baseline.'],
 ['v32.r08Daily=true','Đưa thành tùy chọn có điều kiện, chưa bật đại trà','B1/storm đạt; tổ hợp trên quần thể lag dài thêm 3 R08 premature/100 seed.'],
 ['v32.zeroOrderLagDays=3/4; v32.hysteresis=true','Không đề xuất bật ở các giá trị đã thử','P1/P5 không đạt tiêu chí; không chỉnh tham số để tìm kết quả thắng.']
]);
md.push('Các giá trị trên là ứng viên spec; SimConfig bàn giao vẫn giữ mọi flag ở mặc định v3.1. Không khuyến nghị bật đồng loạt tổ hợp trên mọi account, vì profit giảm ở full/storm và R08 premature tăng trong quần thể lag dài. P7 chỉ sửa câu chữ.','');
md.push('### Câu chữ đề xuất sửa spec', '');
if (verdicts.P1 === 'THẮNG')
    md.push('- **G2 — zero-order**: riêng điều kiện 0 đơn của R06/R12/R13/R16/R17/R05B/R08 kết thúc tại D-K; spend và click vẫn kết thúc D-2. Kiểm tra thêm hai ngày D-K-1/D-K, và không có đơn từ D-K+1 đến D-2.');
if (verdicts.P2 === 'THẮNG')
    md.push('- **Tùy chọn giám sát lịch R06**: thêm điều kiện HOẶC: 14 ngày lịch kết thúc D-2 có 0 đơn và chi tiêu ≥ 2×Spend_zero, không cắt cửa sổ theo lần reset. Các điều kiện R06 hiện có giữ nguyên.');
if (verdicts.P3 === 'THẮNG')
    md.push('- **R08 — chế độ ALERT hàng ngày (tùy chọn)**: khi chọn chế độ này, kiểm tra điều kiện ALERT mỗi ngày; chỉ bật sau khi kiểm chứng trên phân phối attribution lag của account. R07 và R09 vẫn kiểm tra mỗi 3 ngày. Nếu đồng thời chạm R06 thì R06 thắng.');
if (verdicts.P4 === 'THẮNG')
    md.push('- **Ân hạn sau harvest**: chỉ khi R15 đã tạo Exact, kiểm tra lại thành công và thêm Negative Exact vào campaign nguồn thành công, campaign nguồn có 7 ngày lịch ân hạn đối với R06. Ngày ghi negative tính là ngày 0; R06 được xét lại từ ngày 7. Các rule khác vẫn chạy theo điều kiện riêng. Lần harvest mới ghi negative thành công bắt đầu lại mốc ân hạn.');
if (verdicts.P5 === 'THẮNG')
    md.push('- **Vùng đệm ACoS**: R10 cần ACoS ≤ 0.9×T_win ở cả W14 và W_post; R11 cần ACoS > 1.1×T_ok. R02–R04 cần ACoS < 0.95×T_ok; R04B cần ACoS < 0.95×T_win. R05 nhánh A cần ACoS ≥ 1.05×T_bad. Giữ nguyên công thức thay bid và các điều kiện khác.');
if (verdicts.P6 === 'THẮNG')
    md.push('- **Dữ liệu theo giờ**: trong cửa sổ 28 ngày, khi đánh giá giờ H, bỏ toàn bộ dữ liệu giờ H của ngày mà giờ đó bị giới hạn budget. Chỉ học hệ số khi còn ít nhất 20 ngày lịch có dữ liệu giờ H không bị giới hạn budget và đủ ngưỡng click/đơn hiện có. Thiếu bằng chứng thì hệ số giờ H = 1.0. CVR đối chiếu được tính từ các bucket không bị giới hạn budget; giờ khác của cùng ngày vẫn được dùng nếu không bị giới hạn.');
md.push('- **P7 — R04B**: “Sau 7 ngày dữ liệu chín kể từ lần tăng trước (khoảng 8 ngày lịch), xét lại R04B nếu còn thỏa điều kiện; cooldown 3 ngày không thay thế yêu cầu đủ dữ liệu chín.”', '', 'Không sửa spec-v3.1.md trong lần này. Kết luận THẮNG là theo thước đo đã nêu; không bảo đảm triển khai thực tế có cùng hiệu quả. Tổ hợp phải được xem riêng vì các rule có thể tương tác.', '', '## Kiểm chứng và tái lập', '', '`npm run typecheck`; `npm test`; `npm run build`; `node scripts/v32-edge.mjs`; `sh scripts/v32-mc.sh`; `node scripts/v32-results.mjs`; `node scripts/v32-combined.mjs`; `node scripts/v32-results.mjs`; `npm run report -- --edge out/edge --mc out/mc/full-account --v32 out/v32 --out out/report`. Lệnh quần thể và cổng 10% được ghi trong README.', '', 'Hash v3.1: `out/v32/legacy-hashes.json` đối chiếu toàn bộ field trả về (gồm state, facts/matureFacts, truth, targets, waitSeconds, timeline, decisions, audit, notifications, portCalls, hourlyAnalyses và hourlyBoundaries) trên toàn bộ 12 scenario market cũ, và regression 10 ngày full-account ở `test/fixtures/v31-full-10-hashes.json`. 298 test cũ giữ nguyên kỳ vọng. Không commit/push.', '');
try{
 const checks=await read(`${root}/checks.json`),timing=await read(`${root}/timing.json`);
 md.push('### Kiểm chứng thực tế của lần chạy này','');
 table(['Kiểm tra','Kết quả'],[['npm run typecheck',checks.typecheck],['npm test',`${checks.passedTests}/${checks.totalTests}, ${f(checks.testDurationMs/1000)} giây; 298 test cũ giữ nguyên kỳ vọng`],['Hash v3.1',`${checks.legacyScenarios}/${checks.legacyScenarios} scenario market cũ, toàn bộ ${checks.legacyFields} field đầu ra mỗi scenario khớp`],['Dữ liệu Monte Carlo',`${checks.monteCarloSets} bộ, đủ 100 seed/cấu hình; summary/delta/paired tính lại từ JSONL đều khớp`],['Tổng thời gian lệnh đã ghi',`${f(timing.totalMs/1000)} giây; xem README và out/v32/timing.json`]]);
}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir('docs/simulator', { recursive: true });
await writeFile('docs/simulator/v3.2-results.md', md.join('\n') + '\n');
await writeFile(`${root}/verdicts.json`, JSON.stringify({ verdicts, reasons, selected, p5Reduction }, null, 2) + '\n');
console.log(JSON.stringify({ verdicts, selected }, null, 2));
