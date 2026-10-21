import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { extractFindings, loadReport, writeReport } from '../src/report/files.js';
import { renderReport } from '../src/report/render.js';
describe('report renderer', () => {
  it('renders deterministic self-contained HTML and equivalent markdown evidence', () => {
    const input = { edges: [{ id: 'A1', type: 'MEASURE', metrics: { premature: 3 }, explanation: '<storm>' }, { id: 'E5', type: 'INVARIANT', pass: true, explanation: 'Unique entities' }], monteCarlo: [{ name: 'sample', summary: { metrics: { profit: { p5: -1, p50: 2, p95: 9 } } }, runs: [{ profit: 2, premature: { R06: 1 }, flipFlops: { budget: 1 }, timeToTier: { twelve: 3 } }] }] };
    const result = renderReport(input);
    expect(result).toEqual(renderReport(input));
    expect(result.html).toMatch(/^<!doctype html>/);
    expect(result.html).toContain('prefers-color-scheme');
    expect(result.html).toContain('<svg');
    expect(result.html).toContain('&lt;storm&gt;');
    expect(result.html).not.toMatch(/(?:src|href)=["'](?:https?:)?\/\//i);
    expect(result.html).not.toContain('<script');
    for (const title of ['Tóm tắt', 'Edge case', 'Monte Carlo', 'Phát hiện về spec v3.1', 'Flag ambiguity']) {
      expect(result.html).toContain(title); expect(result.markdown).toContain(title);
    }
    expect(result.markdown).toContain('E5');
    expect(result.markdown).toContain('PASS');
    expect(result.markdown).toContain('changeDayCountsAsPost');
    expect(result.html).toContain('p50');
  });
});

it('reads all result files and preserves measured evidence in both outputs', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'simulator-report-'));
  try {
    for (const name of ['edge', 'mc']) mkdirSync(resolve(root, name));
    writeFileSync(resolve(root, 'edge', 'E1.json'), JSON.stringify({ id: 'E1', type: 'INVARIANT', pass: false, explanation: 'API failure' }));
    writeFileSync(resolve(root, 'mc', 'summary.json'), JSON.stringify({ seeds: 1, metrics: { profit: { p5: 4, p50: 4, p95: 4 } }, compare: { override: 'ambiguity.x=false', diff: { profit: { mean: 2 } } } }));
    writeFileSync(resolve(root, 'mc', 'runs.jsonl'), JSON.stringify({ seed: 1, metrics: { profit: 4, premature: { R06: 1 }, flipFlops: { budget: 2, bid: 3 }, timeToTier: { to12: 8, to25: null } } }) + '\n');
    const report = loadReport(resolve(root, 'edge'), [resolve(root, 'mc')]);
    writeReport(report, resolve(root, 'out'));
    const html = readFileSync(resolve(root, 'out', 'report.html'), 'utf8');
    const markdown = readFileSync(resolve(root, 'out', 'report.md'), 'utf8');
    expect(html).toContain('profit.mean'); expect(markdown).toContain('FAIL');
    expect(markdown).toContain('ambiguity.x=false');
    expect(html).not.toContain('NaN'); expect(html).not.toContain('Infinity');
    expect(extractFindings('## Other\nignore\n### Phát hiện — B1\nevidence one\n### Other\nignore\n## Phát hiện Bước 4\nevidence two')).toContain('evidence one');
    expect(extractFindings('## Phát hiện Bước 4\nevidence two')).toContain('evidence two');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('labels premature as rule-relative and displays truth and delay metrics',()=>{
 const result=renderReport({edges:[],monteCarlo:[],v32:{edges:[],experiments:[{name:'truth',summary:{metrics:{wrongZeroOrderPause:{p50:1,mean:1},actionDelayDays:{p50:8,mean:8},prematureTotal:{p50:2,mean:2}},variants:[{name:'K8',summary:{metrics:{wrongZeroOrderPause:{p50:0,mean:0},actionDelayDays:{p50:9,mean:9},prematureTotal:{p50:3,mean:3}}},diff:{},paired:{}}]}}]}});
 expect(result.html).toContain('premature (rule-relative)');expect(result.html).toContain('wrongZeroOrderPause');expect(result.html).toContain('actionDelayDays');
});
