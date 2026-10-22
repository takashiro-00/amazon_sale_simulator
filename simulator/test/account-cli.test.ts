import { it,expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync,mkdtempSync,writeFileSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
it('CLI --rules all writes account artifacts and target summary',()=>{const dir=mkdtempSync(join(tmpdir(),'account-cli-'));try{const s=JSON.parse(readFileSync('scenarios/zero-order.json','utf8'));s.days=3;writeFileSync(join(dir,'s.json'),JSON.stringify(s));execFileSync('npm',['run','sim','--',join(dir,'s.json'),'--rules','all','--out',join(dir,'out')],{stdio:'pipe'});for(const n of ['decisions','audit','notifications','port-calls'])expect(existsSync(join(dir,'out',n+'.jsonl'))).toBe(true);const t=readFileSync(join(dir,'out','timeline.md'),'utf8');expect(t).toContain('search term');expect(t).toContain('initial bid');}finally{rmSync(dir,{recursive:true,force:true});}},20000);
