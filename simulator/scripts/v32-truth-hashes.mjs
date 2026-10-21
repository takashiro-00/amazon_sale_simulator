import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runAccountLoop} from '../dist/src/runner/accountLoop.js';
const previous=JSON.parse(await readFile('test/fixtures/v32-step6-legacy-hashes.json','utf8'));
const rows=[];
for(const row of previous){
 const scenario=JSON.parse(await readFile(`scenarios/${row.name}.json`,'utf8'));
 const r=await runAccountLoop({scenario});
 const checks=Object.fromEntries(Object.entries(row.checks).map(([field,old])=>[field,{legacy:old,current:createHash('sha256').update(JSON.stringify(r[field])).digest('hex')}]));
 rows.push({name:row.name,pass:Object.values(checks).every(c=>c.legacy===c.current),checks});
 console.log(row.name,rows.at(-1).pass);
}
await mkdir('out/v32-truth',{recursive:true});await writeFile('out/v32-truth/legacy-hashes.json',JSON.stringify(rows,null,2)+'\n');
if(rows.some(r=>!r.pass))throw new Error('LEGACY_HASH_MISMATCH');
