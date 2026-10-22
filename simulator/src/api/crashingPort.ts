import type { AmazonAdsPort,TargetUpdate,TargetEndpoint } from './port.js';
import type { Campaign,Target,NegativeKeyword } from '../domain/entities.js';
export class CrashError extends Error {constructor(){super('SIMULATED_PROCESS_CRASH');this.name='CrashError';}}
/** Remote writes survive a process loss before the caller can commit their acknowledgement. */
export class CrashingPort implements AmazonAdsPort {
 private count=0;private armed=true;
 constructor(readonly inner:AmazonAdsPort,readonly afterWrites:number){}
 disarm(){this.armed=false;}
 private async write<T>(fn:()=>Promise<T>):Promise<T>{const result=await fn();if(!Array.isArray(result)||result.some(x=>x.ok)){this.count++;if(this.armed&&this.count===this.afterWrites)throw new CrashError();}return result;}
 updateCampaign(c:Campaign,key:string){return this.write(()=>this.inner.updateCampaign(c,key));}
 updatePlacement(id:string,pct:number,key:string){return this.write(()=>this.inner.updatePlacement(id,pct,key));}
 updateTargets(u:readonly TargetUpdate[],e:TargetEndpoint,k:string){return this.write(()=>this.inner.updateTargets(u,e,k));}
 createKeywords(t:readonly Target[],k:string){return this.write(()=>this.inner.createKeywords(t,k));}
 createNegatives(n:readonly NegativeKeyword[],k:string){return this.write(()=>this.inner.createNegatives(n,k));}
 getCampaigns(ids:readonly string[],k?:string){return this.inner.getCampaigns(ids,k);}
 listTargets(id:string,k?:string){return this.inner.listTargets(id,k);}
 listKeywords(id:string,k:string){return this.inner.listKeywords(id,k);}
 listNegatives(id:string,k:string){return this.inner.listNegatives(id,k);}
}
