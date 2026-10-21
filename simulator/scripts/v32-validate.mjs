import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { summarizeRuns, compareSummaries, pairedRates } from '../dist/src/montecarlo/index.js';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const runs = async (p) => (await readFile(p, 'utf8')).trim().split('\n').map(JSON.parse);
const equal = (a, b, label) => { if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`MISMATCH:${label}`); };
const directories = (await readdir('out/v32', { withFileTypes: true })).filter(d => d.isDirectory());
const checks = [];
for (const d of directories) {
    const dir = `out/v32/${d.name}`;
    let summary;
    try {
        summary = await read(`${dir}/summary.json`);
    }
    catch (e) {
        if (e.code === 'ENOENT')
            continue;
        throw e;
    }
    const baseline = await runs(`${dir}/runs.jsonl`);
    if (baseline.length !== 100)
        throw new Error(`SEED_COUNT:${dir}`);
    equal(baseline.map(r => r.seed), Array.from({ length: 100 }, (_, i) => i), dir + ':seeds');
    equal(summarizeRuns(baseline).metrics, summary.metrics, dir + ':baseline');
    for (const v of summary.variants ?? []) {
        const vr = await runs(`${dir}/${v.name}-runs.jsonl`);
        equal(vr.map(r => r.seed), baseline.map(r => r.seed), dir + ':pairing');
        equal(summarizeRuns(vr), v.summary, dir + ':summary');
        equal(compareSummaries(summary, v.summary), v.diff, dir + ':diff');
        equal(pairedRates(baseline, vr), v.paired, dir + ':paired');
    }
    checks.push({ directory: d.name, seeds: baseline.length, variants: summary.variants.map(v => v.name), pass: true });
}
const expected={
 'P1-premature-population':['P1-K3','P1-K4'],marginal:['P1-K3','P1-K4','P2','P5'],full:['P2','P4','P5'],storm:['P1-K3','P1-K4','P3'],
 'combined-marginal':['v32-combined'],'combined-full':['v32-combined'],'combined-storm':['v32-combined'],'combined-premature-population':['v32-combined']
};
for(const [name,names] of Object.entries(expected)){const result=checks.find(c=>c.directory===name);if(!result)throw new Error('MISSING_EXPERIMENT:'+name);equal(result.variants,names,'VARIANTS:'+name);}
const legacy = await read('out/v32/legacy-hashes.json');
if (legacy.length !== 12 || legacy.some(r => !r.pass))
    throw new Error('LEGACY_HASH_MISMATCH');
const files = [];
for (const base of ['src', 'config']) {
    for (const name of await readdir(base, { recursive: true })) {
        const path = `${base}/${name}`;
        if ((await stat(path)).isFile() && path.endsWith('.ts'))
            files.push(path);
    }
}
const sourceHashes = Object.fromEntries(await Promise.all(files.sort().map(async (p) => [p, createHash('sha256').update(await readFile(p)).digest('hex')])));
const scenarios = Object.fromEntries(await Promise.all(['marginal-account', 'full-account', 'edge/attribution-storm-account', 'edge/premature-population'].map(async (n) => [n, createHash('sha256').update(await readFile(`scenarios/${n}.json`)).digest('hex')])));
await writeFile('out/v32/verification.json', JSON.stringify({ checks, legacyHashChecks: legacy.length, sourceHashes, scenarios }, null, 2) + '\n');
console.log(`${checks.length} Monte Carlo sets verified; twelve legacy scenario hashes match`);
