import { DEFAULT_CONFIG } from '../../config/defaults.js';
export interface EdgeResult { id: string; type: string; status?: string; pass?: boolean | null; metrics?: Record<string, unknown>; explanation: string; evidence?: string[] }
export interface MonteCarloInput { name: string; summary: Record<string, unknown>; runs: Record<string, unknown>[] }
export interface ReportInput { edges: EdgeResult[]; monteCarlo: MonteCarloInput[]; findings?: string; v32?: {experiments:{name:string;summary:Record<string,unknown>}[];edges:unknown[];results?:string} }
const escape = (x: unknown) => String(x ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const metricLabel = (key:string) => key.replace(/^premature/, 'premature (rule-relative)');
const display = (x: unknown): string => typeof x === 'number' ? (Number.isFinite(x) ? String(Math.round(x * 10000) / 10000) : String(x)) : typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x ?? 'null');
function flatten(value: unknown, prefix = ''): Record<string, number> {
  if (typeof value === 'number' && Number.isFinite(value)) return { [prefix]: value };
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).flatMap(([k, v]) => Object.entries(flatten(v, prefix ? `${prefix}.${k}` : k))));
}
function histogram(values: number[], label: string): string {
  const bins = Array.from({ length: 10 }, () => 0), min = Math.min(...values), max = Math.max(...values);
  for (const value of values) bins[Math.min(9, Math.floor((value - min) / (max - min || 1) * 10))]!++;
  const peak = Math.max(1, ...bins);
  return `<svg viewBox="0 0 440 160" role="img" aria-label="${escape(label)}"><title>${escape(label)} (${values.length} observations)</title>${bins.map((n, i) => `<rect x="${20 + i * 40}" y="${130 - n / peak * 100}" width="34" height="${n / peak * 100}" fill="currentColor"><title>${n}</title></rect>`).join('')}<text x="20" y="150">${escape(display(values.length ? min : null))}</text><text x="350" y="150">${escape(display(values.length ? max : null))}</text></svg>`;
}
const flagMeaning: Record<string, string> = {
  dailyReadPolicy: 'Giữ snapshot đọc đầu tiên theo run ID để replay sau crash.', offLadderBudgetPolicy: 'Quy đổi budget sửa tay về bậc gần nhất trong ladder.', mcTierScope: 'Thời gian đạt tier là lần đầu có campaign trong account đạt bậc.', wastedSpendThresholdPolicy: 'Phân bổ theo tỷ lệ spend ngày vượt ngưỡng N2.', incompleteRecoveryWindow: 'Loại quan sát D2 chưa có đủ 14 ngày theo dõi sau tag.',
  placementWindow: 'Cửa sổ placement tối đa 14 ngày, tối thiểu 7 ngày chín.', hourlyScope: 'Phạm vi bằng chứng hourly.', r14CountResetAfterFlag: 'Reset số lần R14 khi cờ hết hạn.', changeDayCountsAsPost: 'Tính ngày thay đổi vào cửa sổ sau thay đổi.', tagRulesGatedByCooldown: 'Áp dụng cooldown cho rule tag.', crossLevelBidPolicy: 'Ưu tiên khi campaign và target cùng đổi bid.', tosCapIncludesHourly: 'Tính hệ số giờ vào trần ToS.', windowResetScope: 'Phạm vi reset cửa sổ.', r09BudgetRestore: 'Bậc budget khôi phục khi gỡ tag.', r06bWindow: 'Cửa sổ đo cho R06B.', anchorResetPolicy: 'Chính sách chụp lại anchor bid.', r06bOverwritesPreTagTier: 'Cho phép R06B ghi đè bậc trước tag.', registryIds: 'Giữ toàn bộ 24 ID rule được liệt kê.', emptyBidRangePolicy: 'Từ chối decision khi khoảng bid rỗng.', repeatedHourPolicy: 'Dùng UTC bucket phân biệt giờ DST lặp.', missingZeroOrderDays: 'Ngày thiếu dữ liệu không chứng minh zero orders.', driftPolicy: 'Chọn Amazon hoặc engine làm nguồn giá trị khi drift.', staleReadPolicy: 'Chính sách bảo vệ read cũ sau write đã ack.',
};
export function renderReport(input: ReportInput): { html: string; markdown: string } {
  const html: string[] = [], md: string[] = [];
  const heading = (title: string) => { html.push(`<h2>${escape(title)}</h2>`); md.push(`\n## ${title}\n`); };
  const paragraph = (value: string) => { html.push(`<p>${escape(value)}</p>`); md.push(value, ''); };
  const table = (headers: string[], rows: unknown[][]) => { html.push(`<div class="scroll"><table><thead><tr>${headers.map(h => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${escape(typeof c==='string'?metricLabel(c):display(c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); md.push(`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.map(c => (typeof c==='string'?metricLabel(c):display(c)).replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ')} |`), ''); };
  heading('Tóm tắt');
  const invariants = input.edges.filter(e => e.type.includes('INVARIANT'));
  paragraph(`24 ID rule (R01–R21 cùng R04B, R06B, R21B). Edge case INVARIANT: ${invariants.filter(e => e.pass === true || e.status === 'PASS').length} PASS / ${invariants.filter(e => e.pass === false || e.status === 'FAIL').length} FAIL; ${input.monteCarlo.length} bộ Monte Carlo.`);
  heading('Edge case');
  table(['ID', 'Loại', 'Kết quả', 'Số đo', 'Giải thích'], [...input.edges].sort((a, b) => a.id.localeCompare(b.id, 'en')).map(e => [e.id, e.type, e.status ?? (e.pass === true ? 'PASS' : e.pass === false ? 'FAIL' : 'MEASURE'), e.metrics ?? {}, e.explanation]));
  heading('Monte Carlo');
  paragraph('wrongZeroOrder đo đơn thật trong cửa sổ quyết định; wrongZeroOrderPauseRunRate là tỷ lệ seed có pause sai. premature (rule-relative) gọi lại rule với config biến thể, chỉ tham khảo và không dùng kết luận v3.2.');
  for (const mc of input.monteCarlo) {
    paragraph(mc.name);
    paragraph(`Seeds: ${display(mc.summary.seeds)}; ngày: ${display(mc.summary.days)}; tỷ lệ seed có pause sai: ${display(mc.summary.wrongZeroOrderPauseRunRate)}; premature (rule-relative) pause rate: ${display(mc.summary.prematurePauseRunRate)}; thời gian ms: ${display(mc.summary.durationMs)}.`);
    const metrics = mc.summary.metrics as Record<string, Record<string, unknown>> | undefined;
    table(['Chỉ số', 'p5', 'p50', 'p95', 'mean', 'min', 'max'], Object.entries(metrics ?? {}).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, v]) => [key, v.p5, v.p50, v.p95, v.mean, v.min, v.max]));
    for (const key of ['wrongZeroOrder', 'wrongZeroOrderPause', 'actionDelayDays', 'premature', 'flipFlops', 'profit', 'timeToTier']) {
      const values = mc.runs.flatMap(run => { const metric = (run.metrics ?? run) as Record<string, unknown>; const v = metric[key]; const numbers = Object.values(flatten(v)); return key === 'profit' ? numbers : key === 'timeToTier' ? numbers : numbers.length ? [numbers.reduce((a, b) => a + b, 0)] : []; });
      html.push(`<h3>${escape(`${mc.name}: ${metricLabel(key)}`)}</h3>`, histogram(values, `${mc.name}: ${metricLabel(key)}`));
      md.push(`Histogram ${metricLabel(key)}: ${values.length} quan sát; min=${display(values.length ? Math.min(...values) : null)}, max=${display(values.length ? Math.max(...values) : null)}.`, '');
    }
    if (mc.summary.compare) { paragraph('So sánh cùng seed'); const comparison = mc.summary.compare as Record<string, unknown>; paragraph(`Override: ${display(comparison.override)}`); table(['Chỉ số', 'Chênh lệch'], Object.entries(flatten(comparison.diff)).sort(([a], [b]) => a.localeCompare(b, 'en'))); }
  }
  if(input.v32){
    heading('Thử nghiệm v3.2');
    paragraph('Baseline v3.1 mặc định; mỗi biến thể dùng cùng tập seed. Delta = biến thể − baseline; tỷ lệ tốt hơn là kiểm định cặp mô tả, không phải p-value.');
    for(const experiment of input.v32.experiments){
      heading(experiment.name);
      const summary=experiment.summary as {metrics:Record<string,{p50:number;mean:number}>;variants?:{name:string;summary:{metrics:Record<string,{p50:number;mean:number}>};diff:Record<string,{p50:number;mean:number}>;paired:Record<string,{betterRate:number}>}[]};
      for(const variant of summary.variants??[]){
        paragraph(variant.name);
        paragraph(`wrongZeroOrderPauseRunRate: baseline=${display((experiment.summary as Record<string,unknown>).wrongZeroOrderPauseRunRate)}; biến thể=${display((variant.summary as unknown as Record<string,unknown>).wrongZeroOrderPauseRunRate)}`);
        const keys=Object.keys(summary.metrics).filter(k=>/^(wrongZeroOrder|actionDelay|premature|profit|wastedSpend|flipFlops|timeToTier)/.test(k));
        table(['Metric','Baseline p50','Baseline mean','Biến thể p50','Biến thể mean','Delta p50','Delta mean'],keys.map(key=>[key,summary.metrics[key]?.p50,summary.metrics[key]?.mean,variant.summary.metrics[key]?.p50,variant.summary.metrics[key]?.mean,variant.diff[key]?.p50,variant.diff[key]?.mean]));
        table(['Metric','Tỷ lệ seed tốt hơn'],Object.entries(variant.paired??{}).map(([k,v])=>[k,v.betterRate]));
      }
    }
    heading('Edge bật/tắt v3.2');
    for(const edge of input.v32.edges){html.push(`<pre>${escape(JSON.stringify(edge,null,2))}</pre>`);md.push('```json',JSON.stringify(edge,null,2),'```');}
    if(input.v32.results){heading('Kết luận v3.2');html.push(`<pre>${escape(input.v32.results)}</pre>`);md.push(input.v32.results);}
  }
  heading('Phát hiện về spec v3.1');
  paragraph('Bằng chứng Bước 3–4 được giữ nguyên từ README; số đo Bước 5 nằm trong bảng edge và Monte Carlo ở trên. Các đề xuất sau không thay đổi rule.');
  if (input.findings) { html.push(`<pre>${escape(input.findings)}</pre>`); md.push(input.findings, ''); }
  table(['Phát hiện', 'Bằng chứng', 'Đề xuất spec'], [
    ['B1 phụ thuộc pha lịch', 'Golden Bước 3: ALERT ngày 18 / 22 / 23 theo anchor; R06 ngày 24 cả ba pha.', 'Quy định rõ ưu tiên R05/R08 và ngày anchor.'],
    ['R05 reset có thể cản R07', 'Đọc số liệu B2 trong bảng edge; không suy diễn mức ảnh hưởng khi thiếu số đo.', 'Làm rõ cửa sổ tích lũy và điều kiện reset khi giảm budget.'],
    ['E6 harvest làm nguồn bị R06', 'Bước 4: W_post 10-05–10-07 có 33 click, $23.287437, 0 đơn; R06 ngày 8.', 'Xem xét grace hoặc cửa sổ riêng sau harvest.'],
    ['R04B thực tế mỗi 8 ngày', 'Golden Bước 3: ngày 20 / 28 / 36; smoke ngày 21 / 29 / 37.', 'Phân biệt 7 ngày chín và 7 ngày lịch.'],
    ['Pause sớm do attribution', 'wrongZeroOrder.R06 / wrongZeroOrderPauseRunRate trong Monte Carlo; premature (rule-relative) chỉ tham khảo.', 'Đánh giá maturity lag theo độ trễ thực tế trước khi sửa ngưỡng.'],
  ]);
  heading('Flag ambiguity');
  table(['Flag', 'Mặc định', 'Ý nghĩa'], Object.entries(DEFAULT_CONFIG.ambiguity).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, value]) => [`ambiguity.${key}`, value, flagMeaning[key] ?? 'Chính sách xử lý điểm chưa rõ của spec; xem config/defaults.ts.']));
  return { html: `<!doctype html>\n<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulator — v3.2</title><style>:root{color-scheme:light dark;--bg:#fff;--fg:#17202a;--line:#cdd6dd;--accent:#2869aa}@media(prefers-color-scheme:dark){:root{--bg:#111820;--fg:#e3ebf3;--line:#435363;--accent:#7bb9f5}}body{margin:2rem auto;padding:0 1rem;max-width:1100px;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui}h1,h2,h3{line-height:1.25}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid var(--line);padding:.5rem;text-align:left;vertical-align:top}td{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}svg{width:100%;max-width:520px;color:var(--accent)}svg text{fill:var(--fg);font-size:12px}</style></head><body><h1>Simulator — v3.2</h1>${html.join('\n')}</body></html>\n`, markdown: '# Simulator — v3.2\n' + md.join('\n') + '\n' };
}
