import { it,expect } from 'vitest';
import type { RuleContext } from '../src/engine/types.js';
import { fixture } from './step4-fixture.js';
import { FactIndex } from '../src/data/facts.js';
import { MetricsReader } from '../src/data/metrics.js';
import { registry } from '../src/rules/registry.js';
import { firstMatchWins } from '../src/engine/priority.js';
import { SimClock } from '../src/time/clock.js';
import { usd } from '../src/domain/money.js';
function search(clicks=30,orders=0,spend=21):RuleContext{const c=fixture();return {...c,clock:new SimClock('2026-10-18T07:00Z'),today:'2026-10-18',metrics:new MetricsReader(new FactIndex(c.metrics.facts('c','2026-10-01','2026-10-17').map((f,i)=>({...f,entityRef:'t:search:query',knownAt:'2026-10-18T07:00Z',clicks:i===1?clicks:0,orders:i===1?orders:0,spendMicros:usd(i===1?String(spend):'0'),salesMicros:usd(i===1&&orders?'100':'0')}))),'2026-10-18T07:00Z',c.config),state:{...c.state,targetEntities:{t:{...c.state.targetEntities.t!,matchType:'BROAD' as const}},negatives:{},pendingHarvests:[]}};}
const run=(id:string,c:ReturnType<typeof search>)=>firstMatchWins({group:'SEARCHTERM',id:'t:search:query',campaignId:'c',sourceTargetId:'t',query:'query'},[registry.find(r=>r.id===id)!],c);
it.each(['R16','R17'])('%s creates normalized negative once',id=>{const c=search();const d=run(id,c);expect(d?.after.negatives?.c?.[0]?.text).toBe('query');expect(run(id,{...c,runId:'next',decisions:[],state:{...d!.after,negatives:d!.after.negatives??{},pendingHarvests:[]}})).toBeNull();});
it('enabled same ASIN Exact prevents R16/R17 and explains why',()=>{const c=search();const state={...c.state,targetEntities:{...c.state.targetEntities,u:{...c.state.targetEntities.t!,id:'u',text:' QUERY ',matchType:'EXACT' as const}}};expect(run('R16',{...c,state})).toBeNull();expect(c.audit.events.at(-1)?.reasons).toContain('EXACT_KEYWORD_EXISTS');});
it('R15 Sunday creates a new Exact with CPC anchor and pending provenance',()=>{const c=search(20,2,10);const d=run('R15',c);const id=d?.after.pendingHarvests?.[0]?.keywordId;expect(id).toBeTruthy();expect(d?.after.targets[id!]?.anchorBidMicros).toBe(usd('.50'));expect(d?.after.negatives?.c??[]).toEqual([]);});
it.each(['R16','R17'])('%s below threshold',id=>expect(run(id,search(1,0,1))).toBeNull());
it('R15 rejects weekday, Exact source, missing destination and existing disabled Exact',()=>{for(const variant of ['weekday','source-exact','no-dest','existing'] as const){let c=search(20,2,10);if(variant==='weekday')c={...c,clock:new SimClock('2026-10-19T07:00Z'),today:'2026-10-19'};if(variant==='source-exact')c={...c,state:{...c.state,targetEntities:{t:{...c.state.targetEntities.t!,matchType:'EXACT'}}}};if(variant==='no-dest')c={...c,state:{...c.state,campaigns:{c:{...c.state.campaigns.c!,type:'AUTO'}}}};if(variant==='existing')c={...c,state:{...c.state,targetEntities:{...c.state.targetEntities,u:{...c.state.targetEntities.t!,id:'u',text:' QUERY ',matchType:'EXACT',status:'PAUSED'}}}};expect(run('R15',c)).toBeNull();if(variant==='no-dest')expect(c.audit.events.at(-1)?.reasons).toContain('NO_DESTINATION');}});
