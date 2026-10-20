import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../../config/defaults.js';
import { validateScenario } from '../scenario/schema.js';
import { runMonteCarlo } from '../montecarlo/index.js';
const args=process.argv.slice(2),file=args.shift();if(!file)throw new Error('Usage: mc <scenario.json> --seeds 100 --workers auto --out out/mc/name [--compare key=value]');
const value=(flag:string,fallback:string)=>{const i=args.indexOf(flag);return i<0?fallback:args[i+1]??fallback;};
const workers=value('--workers','auto'),compare=args.flatMap((a,i)=>a==='--compare'?[args[i+1]!]:[]);
const result=await runMonteCarlo({scenario:validateScenario(JSON.parse(await readFile(file,'utf8'))),config:DEFAULT_CONFIG,seeds:Number(value('--seeds','100')),workers:workers==='auto'?'auto':Number(workers),out:value('--out','out/mc/default'),...(compare.length?{compare}:{})});
console.log(JSON.stringify(result.summary,null,2));
