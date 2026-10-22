import { RateLimitError,TransientServerError } from './faultyPort.js';
import type { BatchResult } from './port.js';
export function isApiError(e:unknown):boolean {
 return e instanceof RateLimitError||e instanceof TransientServerError||e instanceof Error&&/^(?:4\d\d|5\d\d|DUPLICATE_|CAMPAIGN_NOT_FOUND|TRANSIENT_ITEM_ERROR)/.test(e.message);
}
export function isTransientApiError(e:unknown):boolean {return e instanceof RateLimitError||e instanceof TransientServerError||e instanceof Error&&/^(429|5\d\d)/.test(e.message);}
export async function attemptApi<T>(fn:()=>Promise<T>,maxAttempts:number){
 let waitSeconds=0;
 for(let a=1;a<=maxAttempts;a++)try{return {ok:true as const,value:await fn(),waitSeconds};}catch(e){if(!isApiError(e))throw e;if(e instanceof RateLimitError)waitSeconds+=e.retryAfterSeconds;if(!isTransientApiError(e)||a===maxAttempts)return {ok:false as const,error:String(e),waitSeconds};}
 throw new RangeError('INVALID_MAX_ATTEMPTS');
}
export async function retryBatch<T>(items:readonly T[],id:(item:T)=>string,write:(items:readonly T[])=>Promise<readonly BatchResult[]>,maxAttempts:number){
 let pending=[...items],waitSeconds=0;const acked:string[]=[],failures:string[]=[];
 for(let a=1;a<=maxAttempts&&pending.length;a++){
  try{const results=await write(pending);pending=pending.filter(item=>{const r=results.find(r=>r.id===id(item));if(r?.ok){acked.push(r.id);return false;}if(r?.error&&!/TRANSIENT|429|5\d\d/.test(r.error)){failures.push(id(item));return false;}return true;});}
  catch(e){if(!isApiError(e))throw e;if(e instanceof RateLimitError)waitSeconds+=e.retryAfterSeconds;if(!isTransientApiError(e)){failures.push(...pending.map(id));pending=[];}}
 }
 return {acked,failures:[...failures,...pending.map(id)],waitSeconds};
}
