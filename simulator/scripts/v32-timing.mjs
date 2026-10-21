import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
const rows = [];
async function scan(directory) { for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${item.name}`;
    if (item.isDirectory())
        await scan(path);
    else if (item.name === 'summary.json') {
        const s = JSON.parse(await readFile(path, 'utf8'));
        if (typeof s.durationMs === 'number')
            rows.push({ path, endedAtMs:(await stat(path)).mtimeMs, durationMs: s.durationMs, runs: s.seeds * (1 + (s.variants?.length ?? 0) + (s.compare ? 1 : 0)) });
    }
} }
await scan('out/v32');
const edge = JSON.parse(await readFile('out/v32/edge/duration.json', 'utf8'));
rows.push({ path: 'out/v32/edge', durationMs: edge.durationMs, runs: edge.runs ?? 18 });
try {
    const extra = JSON.parse(await readFile('out/v32/extra-edge-duration.json', 'utf8'));
    rows.push({ path: 'out/v32/extra-edge-duration.json', ...extra });
}
catch (e) {
    if (e.code !== 'ENOENT')
        throw e;
}
try { const interrupted=JSON.parse(await readFile('out/v32/interrupted-runs.json','utf8'));rows.push(...interrupted.map(r=>({path:r.name+' (interrupted)',durationMs:r.durationMs,runs:null,reason:r.reason}))); } catch(e) { if(e.code!=='ENOENT')throw e; }
const totalMs = rows.reduce((n, r) => n + r.durationMs, 0);
let experimentSpanMs=null;try{const initial=JSON.parse(await readFile('out/v32/exploratory/premature-initial/summary.json','utf8'));const population=await stat('out/v32/P1-premature-population/summary.json');const began=population.birthtimeMs-initial.durationMs;experimentSpanMs=Math.max(...rows.filter(r=>r.endedAtMs).map(r=>r.endedAtMs))-began;}catch(e){if(e.code!=='ENOENT')throw e;}
await writeFile('out/v32/timing.json', JSON.stringify({ experimentSpanMs, definition: 'Sum of command durations plus the final edge suite; commands can overlap, so this is not wall time. Includes retained exploratory/recheck runs and recorded interrupted commands.', rows, totalMs }, null, 2) + '\n');
const path = 'README.md', readme = await readFile(path, 'utf8');
const marker = '### Thời gian chạy thử nghiệm v3.2';
const content = `${marker}\n\nTổng thời gian lệnh Monte Carlo đã lưu và bộ edge cuối: **${(totalMs / 1000).toFixed(3)} giây (${(totalMs / 60000).toFixed(2)} phút)**. Đây là tổng durationMs từng lệnh, gồm cả lượt kiểm tra lại/exploratory và lệnh dang dở được chạy lại, có ghi trong out/v32; không phải wall time vì có lệnh chạy song song. Chi tiết từng lệnh, số lượt và định nghĩa tại [out/v32/timing.json](out/v32/timing.json). Không tính build, Vitest hoặc đối chiếu hash vào tổng durationMs.\n\n${experimentSpanMs===null?'':`Khoảng thời gian lịch từ lệnh MC đầu tiên đến output MC cuối: **${(experimentSpanMs/60000).toFixed(2)} phút**, gồm cả khoảng chờ/triển khai giữa các lệnh; không phải thời gian CPU. Mốc đầu ước lượng từ birthtime summary đầu tiên trừ durationMs của lệnh đó.`}\n`;
await writeFile(path, readme.split(marker)[0].trimEnd() + '\n\n' + content);
console.log(totalMs);
