import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { mkdir,writeFile } from 'node:fs/promises';
import type { SimConfig } from '../../config/defaults.js';
import type { Scenario } from '../scenario/schema.js';
import { runSeed,type MonteCarloRun,type MetricValue } from './metrics.js';
export * from './metrics.js';
export interface Distribution {count:number;p5:number;p50:number;p95:number;mean:number;min:number;max:number}
export function flatten(value:Record<string,MetricValue>,prefix=''):Record<string,number|null>{const result:Record<string,number|null>={};for(const [k,v] of Object.entries(value)){const key=prefix?`${prefix}.${k}`:k;if(v!==null&&typeof v==='object')Object.assign(result,flatten(v,key));else result[key]=v;}return result;}
export function summarizeRuns(runs:readonly MonteCarloRun[]){
 const flattened=runs.map(r=>flatten(r.metrics)),keys=new Set(flattened.flatMap(r=>Object.keys(r))),columns=new Map<string,number[]>();for(const key of keys){const col:number[]=[];for(const row of flattened){const value=Object.hasOwn(row,key)?row[key]:0;if(value!==null&&value!==undefined)col.push(value);}columns.set(key,col);}
 const metrics:Record<string,Distribution>={};for(const [key,col] of columns){col.sort((a,b)=>a-b);if(!col.length)continue;const percentile=(p:number)=>{const i=(col.length-1)*p,lo=Math.floor(i),f=i-lo;return Number((col[lo]!*(1-f)+col[Math.ceil(i)]!*f).toPrecision(15));};metrics[key]={count:col.length,p5:percentile(.05),p50:percentile(.5),p95:percentile(.95),mean:col.reduce((a,b)=>a+b,0)/col.length,min:col[0]!,max:col.at(-1)!};}
 return {seeds:runs.length,metrics,wrongZeroOrderPauseRunRate:runs.filter(r=>(r.metrics.wrongZeroOrderPause as number)>0).length/Math.max(1,runs.length),prematurePauseRunRate:runs.filter(r=>(r.metrics.prematurePause as number)>0).length/Math.max(1,runs.length)};
}
export function compareSummaries(baseline:ReturnType<typeof summarizeRuns>,comparison:ReturnType<typeof summarizeRuns>):Record<string,Record<string,number>>{
 const diff:Record<string,Record<string,number>>={};for(const key of new Set([...Object.keys(baseline.metrics),...Object.keys(comparison.metrics)])){
  const a=baseline.metrics[key],b=comparison.metrics[key];if((!a||!b)&&!key.startsWith('notifications.'))continue;
  diff[key]=Object.fromEntries((['p5','p50','p95','mean','min','max'] as const).map(k=>[k,(b?.[k]??0)-(a?.[k]??0)]));
 }return diff;
}
export function applyOverrides(config:SimConfig,overrides:readonly string[]):SimConfig{
 const clone=structuredClone(config);for(const override of overrides){const eq=override.indexOf('=');if(eq<1)throw new Error(`INVALID_COMPARE:${override}`);const path=override.slice(0,eq).split('.');let obj=clone as unknown as Record<string,unknown>;for(const key of path.slice(0,-1)){if(['__proto__','constructor','prototype'].includes(key)||!Object.hasOwn(obj,key)||!obj[key]||typeof obj[key]!=='object')throw new Error(`UNKNOWN_CONFIG_PATH:${override}`);obj=obj[key] as Record<string,unknown>;}
  const key=path.at(-1)!;if(!Object.hasOwn(obj,key))throw new Error(`UNKNOWN_CONFIG_PATH:${override}`);const raw=override.slice(eq+1);let value:unknown;try{value=JSON.parse(raw);}catch{value=raw;}if(typeof value!==typeof obj[key]||Array.isArray(value)!==Array.isArray(obj[key]))throw new Error(`INVALID_CONFIG_TYPE:${override}`);obj[key]=value;
 }
 if(!Number.isInteger(clone.v32.zeroOrderLagDays)||clone.v32.zeroOrderLagDays<2||clone.v32.zeroOrderLagDays>clone.maxPostDays)throw new Error('INVALID_ZERO_ORDER_LAG');
 if(!Number.isInteger(clone.v32.postHarvestGraceDays)||clone.v32.postHarvestGraceDays<0)throw new Error('INVALID_HARVEST_GRACE');
 return clone;
}

export interface Variant {name:string;overrides:readonly string[]}
export function pairedRates(baseline:readonly MonteCarloRun[],variant:readonly MonteCarloRun[]){
 const rows=new Map(variant.map(r=>[r.seed,flatten(r.metrics)]));
 return Object.fromEntries(['profit','wastedSpend','premature','flipFlops'].map(key=>{
  let better=0,tied=0,worse=0;
  for(const r of baseline){const a=flatten(r.metrics),b=rows.get(r.seed);if(!b)throw new Error('UNPAIRED_SEED');
   const value=(row:Record<string,number|null>)=>key==='premature'?row.prematureTotal??0:key==='flipFlops'?(row['flipFlops.bid']??0)+(row['flipFlops.budget']??0):row[key]??0;
   const delta=(value(b)-value(a))*(key==='profit'?1:-1);if(delta>0)better++;else if(delta<0)worse++;else tied++;
  }return [key,{better,tied,worse,count:baseline.length,betterRate:better/baseline.length}];
 }));
}

export async function runMonteCarlo(options:{scenario:Scenario;config:SimConfig;seeds:number;workers?:number|'auto';out?:string;compare?:readonly string[];variants?:readonly Variant[];minPrematureSeedRate?:number}){
 if(!Number.isInteger(options.seeds)||options.seeds<1)throw new Error('INVALID_SEEDS');
 const workerCount=options.workers==='auto'||options.workers===undefined?Math.min(8,availableParallelism()):options.workers;
 if(!Number.isInteger(workerCount)||workerCount<1)throw new Error('INVALID_WORKERS');
 const collect=async(config:SimConfig)=>{const runs:MonteCarloRun[]=new Array(options.seeds);let next=0;
  // Source runs (Vitest) use the identical seed function; production workers execute compiled ESM.
  const compiled=import.meta.url.endsWith('.js');
  await Promise.all(Array.from({length:Math.min(workerCount,options.seeds)},async()=>{if(!compiled||workerCount===1){while(next<options.seeds){const i=next++;runs[i]=await runSeed(options.scenario,config,i);}return;}
   const worker=new Worker(new URL('./worker.js',import.meta.url),{execArgv:process.execArgv.filter(arg=>!arg.startsWith('--input-type'))});try{while(next<options.seeds){const i=next++;runs[i]=await new Promise<MonteCarloRun>((resolve,reject)=>{const message=(m:{result?:MonteCarloRun;error?:string})=>{cleanup();if(m.error)reject(new Error(m.error));else resolve(m.result!);};const error=(e:Error)=>{cleanup();reject(e);};const exited=(code:number)=>error(new Error(`MC_WORKER_EXIT:${code}`));const cleanup=()=>{worker.off('message',message);worker.off('error',error);worker.off('exit',exited);};worker.once('message',message);worker.once('error',error);worker.once('exit',exited);worker.postMessage({scenario:options.scenario,config,seed:i});});}}finally{await worker.terminate();}
  }));return runs;
 };
 const variants=options.variants??[];
 if(new Set(variants.map(v=>v.name)).size!==variants.length||variants.some(v=>!/^[A-Za-z0-9_-]+$/.test(v.name)||!v.overrides.length))throw new Error('INVALID_VARIANT');
 const variantResults: {name:string;overrides:readonly string[];summary:ReturnType<typeof summarizeRuns>;diff:Record<string,Record<string,number>>;paired:ReturnType<typeof pairedRates>}[]=[];
 const variantRuns:Record<string,MonteCarloRun[]>={};
 const started=performance.now(),runs=await collect(options.config),summary={...summarizeRuns(runs),days:options.scenario.days,durationMs:0,variants:variantResults,compare:undefined as undefined|{override:readonly string[];summary:ReturnType<typeof summarizeRuns>;diff:Record<string,Record<string,number>>;paired:ReturnType<typeof pairedRates>}};
 const prematureSeedRate=runs.filter(r=>(r.metrics.prematureTotal as number)>0).length/runs.length;
 if(options.minPrematureSeedRate!==undefined&&prematureSeedRate<options.minPrematureSeedRate)throw new Error(`INSUFFICIENT_PREMATURE_SIGNAL:${prematureSeedRate}`);
 let compareRuns:MonteCarloRun[]|undefined;if(options.compare?.length){compareRuns=await collect(applyOverrides(options.config,options.compare));const comparison=summarizeRuns(compareRuns);summary.compare={override:options.compare,summary:comparison,diff:compareSummaries(summary,comparison),paired:pairedRates(runs,compareRuns)};}
 for(const v of variants){const vr=await collect(applyOverrides(options.config,v.overrides)),vs=summarizeRuns(vr);variantRuns[v.name]=vr;variantResults.push({...v,summary:vs,diff:compareSummaries(summary,vs),paired:pairedRates(runs,vr)});}
 summary.durationMs=performance.now()-started;
 if(options.out){await mkdir(options.out,{recursive:true});await writeFile(`${options.out}/runs.jsonl`,runs.map(r=>JSON.stringify(r)).join('\n')+'\n');await writeFile(`${options.out}/summary.json`,JSON.stringify(summary,null,2)+'\n');if(compareRuns)await writeFile(`${options.out}/compare-runs.jsonl`,compareRuns.map(r=>JSON.stringify(r)).join('\n')+'\n');}
 if(options.out)for(const [name,vr] of Object.entries(variantRuns))await writeFile(`${options.out}/${name}-runs.jsonl`,vr.map(r=>JSON.stringify(r)).join('\n')+'\n');
 return {runs,summary,variantRuns,...(compareRuns?{compareRuns}:{})};
}
