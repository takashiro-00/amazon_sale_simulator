import { expect,it } from 'vitest';
import { fixture,run } from './step4-fixture.js';
import { executeDecision } from '../src/runner/executor.js';
import { InMemoryFakePort } from '../src/api/port.js';
import { RateLimitError,TransientServerError } from '../src/api/faultyPort.js';
import { usd } from '../src/domain/money.js';
it('commits campaign tag atomically and retains failed target memory without cooldown',async()=>{
 const c=fixture(3,1,5,.41),d=run('R07',c)!;
 class Broken extends InMemoryFakePort { override async updateTargets():Promise<never>{throw new TransientServerError();} }
 const r=await executeDecision(d,{port:new Broken(),config:c.config,hour:0,thresholds:c.thresholds});
 expect(r.state.campaignMemory.c?.tag).toBe('MANAGE');expect(r.state.campaigns.c?.name).toContain('[MANAGE]');
 expect(r.state.targets.t).toEqual(d.before.targets.t);expect(r.outcome).toBe('PARTIAL_APPLY');expect(r.failures).toHaveLength(1);
});
it('campaign failure retains name tag budget memory while successful target commits',async()=>{
 const c=fixture(3,1,5,.41),d=run('R07',c)!;
 class Broken extends InMemoryFakePort { override async updateCampaign(){throw new TransientServerError();} }
 const r=await executeDecision(d,{port:new Broken(),config:c.config,hour:0,thresholds:c.thresholds});
 expect(r.state.campaigns.c).toEqual(d.before.campaigns.c);expect(r.state.campaignMemory.c).toEqual(d.before.campaignMemory.c);expect(r.state.targets.t?.baseBidMicros).toBe(usd('.90'));
});
it('uses configured attempts and accumulates retry-after without advancing clock',async()=>{
 const c=fixture(3,1,5,.41),d=run('R07',c)!;let calls=0;
 class Limited extends InMemoryFakePort { override async updateCampaign(){calls++;throw new RateLimitError(17);} }
 const r=await executeDecision(d,{port:new Limited(),config:{...c.config,api:{...c.config.api,maxAttempts:2}},hour:0,thresholds:c.thresholds});
 expect(calls).toBe(2);expect(r.waitSeconds).toBe(34);expect(c.clock.now()).toBe('2026-10-19T07:00:00.000Z');
});
it('does not retry permanent API errors but lets TypeError escape',async()=>{
 const c=fixture(3,1,5,.41),d=run('R07',c)!;let calls=0;
 class Permanent extends InMemoryFakePort { override async updateCampaign(){calls++;throw new Error('400 INVALID_REQUEST');} }
 const r=await executeDecision(d,{port:new Permanent(),config:c.config,hour:0,thresholds:c.thresholds});expect(calls).toBe(1);expect(r.failures[0]?.error).toContain('400');
 class Bug extends InMemoryFakePort { override async updateCampaign(){throw new TypeError('bug');} }
 await expect(executeDecision(d,{port:new Bug(),config:c.config,hour:0,thresholds:c.thresholds})).rejects.toThrow(TypeError);
});
it('hourly API errors preserve sent bid and retry at next boundary',async()=>{
 const { submitBoundary }=await import('../src/rules/hourly/analysis.js');const c=fixture(),sent=new Map([['t',usd('1')]]),done=new Set<string>();let fails=true;
 class Port extends InMemoryFakePort {override async updateTargets(...args:Parameters<InMemoryFakePort['updateTargets']>){if(fails)throw new RateLimitError(60);return super.updateTargets(...args);}}
 const p=new Port(),state={...c.state,targets:{t:{...c.state.targets.t!,baseBidMicros:usd('.8')}}};
 await expect(submitBoundary(c.clock.now(),state,c.thresholds,p,sent,done,c.config)).resolves.toBeUndefined();expect(sent.get('t')).toBe(usd('1'));fails=false;
 await submitBoundary('2026-10-19T08:00Z',state,c.thresholds,p,sent,done,c.config);expect(sent.get('t')).toBe(usd('.8'));
});
it('partial batch retries only failed entities using stable keys',async()=>{
 const c=fixture(3,1,5,.41),d=run('R07',c)!,seen:string[]=[];let failed=false;
 class Port extends InMemoryFakePort {override async updateTargets(...args:Parameters<InMemoryFakePort['updateTargets']>){seen.push(args[2]);if(!failed){failed=true;return args[0].map(u=>({id:u.target.id,ok:false,error:'TRANSIENT_ITEM_ERROR'}));}return super.updateTargets(...args);}}
 const r=await executeDecision(d,{port:new Port(),config:c.config,hour:0,thresholds:c.thresholds});expect(r.outcome).toBe('APPLIED');expect(seen).toHaveLength(2);expect(seen[0]).toBe(seen[1]);
});
it('failed final R09 restore retains pending recovery for the unacknowledged target',async()=>{
 const c=fixture(),ctx={...c,state:{...c.state,campaignMemory:{c:{...c.state.campaignMemory.c!,bidRestorePending:true}},targets:{t:{...c.state.targets.t!,tagReductionFactor:.99,baseBidMicros:usd('.99')}}}},d=run('R09',ctx)!;
 class Broken extends InMemoryFakePort {override async updateTargets():Promise<never>{throw new TransientServerError();}}
 const r=await executeDecision(d,{port:new Broken(),config:c.config,hour:0,thresholds:c.thresholds});expect(r.state.targets.t?.tagReductionFactor).toBe(.99);expect(r.state.campaignMemory.c?.bidRestorePending).toBe(true);
});
it('target outbound remains safe when the accompanying ToS decrease fails',async()=>{
 const c=fixture(),before={...c.state,campaigns:{c:{...c.state.campaigns.c!,topOfSearchPct:200}}},d={runId:'run',objectRef:{group:'CAMPAIGN' as const,id:'c'},ruleId:'R09' as const,before,after:{...before,campaigns:{c:{...before.campaigns.c!,topOfSearchPct:0}},targets:{t:{...before.targets.t!,baseBidMicros:usd('1.08')}}},baseBidTargetIds:['t'],paramsVersion:c.paramsVersion},sent=new Map<string,number>();
 class Broken extends InMemoryFakePort {override async updatePlacement():Promise<never>{throw new TransientServerError();}}
 await executeDecision(d,{port:new Broken(),config:c.config,hour:0,thresholds:c.thresholds,sent});expect(sent.get('t')!*(1+2)).toBeLessThanOrEqual(c.thresholds.t!.Bid_max*1.5);
});
it('weekly hourly analysis exposes observed evidence and actual factors for measurements',async()=>{
 const {analyzeHours}=await import('../src/rules/hourly/analysis.js'),c=fixture(),records:unknown[]=[];
 analyzeHours(c,undefined,r=>records.push(r));expect(records).toHaveLength(24);expect(records[0]).toMatchObject({targetId:'t',hour:0,before:1,after:1,clicks:0,impressions:0});
});
it('campaign failure still commits placement acknowledgement and its cooldown',async()=>{
 const c=fixture(3,1,5,.41),original=run('R07',c)!,d={...original,after:{...original.after,campaigns:{c:{...original.after.campaigns.c!,topOfSearchPct:50}},campaignMemory:{c:{...original.after.campaignMemory.c!,cooldownUntil:{...original.after.campaignMemory.c!.cooldownUntil,placement:'2026-10-26'},lastChangeAt:{...original.after.campaignMemory.c!.lastChangeAt,placement:c.clock.now()}}}}};
 class Broken extends InMemoryFakePort {override async updateCampaign():Promise<never>{throw new TransientServerError();}}
 const p=new Broken();await InMemoryFakePort.prototype.updateCampaign.call(p,c.state.campaigns.c!,'seed');const r=await executeDecision(d,{port:p,config:c.config,hour:0,thresholds:c.thresholds});
 expect(r.state.campaignMemory.c?.tag).toBe('NORMAL');expect(r.state.campaigns.c?.topOfSearchPct).toBe(50);expect(r.state.campaignMemory.c?.cooldownUntil.placement).toBe('2026-10-26');expect(r.state.campaignMemory.c?.cooldownUntil.budget).toBe(d.before.campaignMemory.c?.cooldownUntil.budget);
});
it('every evaluated decision and audit snapshot identify the exact data asOf',()=>{
 const c=fixture(3,1,5,.41),d=run('R07',c)!;expect(d.asOf).toBe(c.metrics.asOf);expect(c.audit.events.at(-1)?.inputsSnapshot).toMatchObject({asOf:c.metrics.asOf});
});
