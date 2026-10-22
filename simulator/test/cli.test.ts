import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
it('builds a Node CLI with deterministic JSONL and summary artifacts', () => {
    const out = mkdtempSync(join(tmpdir(), 'sim-cli-'));
    try {
        execFileSync('npm', ['run', 'build'], { stdio: 'pipe' });
        for (const folder of ['a', 'b'])
            execFileSync(process.execPath, ['dist/src/cli/sim.js', 'scenarios/golden-winner.json', '--out', join(out, folder)], { stdio: 'pipe' });
        expect(readFileSync(join(out, 'a/facts.jsonl'), 'utf8')).toBe(readFileSync(join(out, 'b/facts.jsonl'), 'utf8'));
        const summary = JSON.parse(readFileSync(join(out, 'a/summary.json'), 'utf8'));
        expect(summary.trueTotals.orders).toBeGreaterThan(0);
        expect(readFileSync(join(out, 'a/port-calls.jsonl'), 'utf8')).toContain('updateCampaign');
    }
    finally {
        rmSync(out, { recursive: true, force: true });
    }
}, 30000);
it('campaign CLI writes decisions, audit, notifications and timeline',()=>{
 const out=mkdtempSync(join(tmpdir(),'sim-campaign-cli-'));
 try{
 execFileSync('npm',['run','build'],{stdio:'pipe'});
 execFileSync(process.execPath,['dist/src/cli/sim.js','scenarios/golden-winner.json','--rules','campaign','--out',out],{stdio:'pipe'});
 expect(readFileSync(join(out,'timeline.md'),'utf8')).toContain('R02');
 expect(readFileSync(join(out,'decisions.jsonl'),'utf8')).toContain('R01');
 expect(readFileSync(join(out,'audit.jsonl'),'utf8')).toContain('NOT_SCHEDULED');
 expect(readFileSync(join(out,'notifications.jsonl'),'utf8')).toBe('');
 }finally{rmSync(out,{recursive:true,force:true});}
},30000);
