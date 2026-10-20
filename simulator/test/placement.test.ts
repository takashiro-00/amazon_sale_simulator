import { it,expect } from 'vitest';
import { fixture } from './step4-fixture.js';
import { FactIndex } from '../src/data/facts.js';
import { MetricsReader } from '../src/data/metrics.js';
import { registry } from '../src/rules/registry.js';
import { firstMatchWins } from '../src/engine/priority.js';
import { usd } from '../src/domain/money.js';
function placement(topClicks=30,topOrders=3,topSpend=5,restClicks=30,restOrders=0){const c=fixture();const fs=c.metrics.facts('c','2026-10-01','2026-10-17');const f=fs[0]!;return {...c,metrics:new MetricsReader(new FactIndex([...fs,...(['TOP','REST_OF_SEARCH'] as const).map(p=>({...f,placement:p,clicks:p==='TOP'?topClicks:restClicks,orders:p==='TOP'?topOrders:restOrders,spendMicros:usd(p==='TOP'?String(topSpend):'1'),salesMicros:usd(p==='TOP'&&topOrders?'100':'0')}))]),c.clock.now(),c.config)};}
const run=(id:string,c:ReturnType<typeof placement>)=>firstMatchWins({group:'PLACEMENT',id:'c'},[registry.find(r=>r.id===id)!],c);
it('R18 evaluates REST CVR zero literally, preserves target base',()=>{const d=run('R18',placement());expect(d?.after.campaigns.c?.topOfSearchPct).toBe(10);expect(d?.after.targets.t?.baseBidMicros).toBe(usd('1'));});
it('R18 cap rejection returns null and TOS_CAP audit',()=>{const c=placement();const state={...c.state,campaigns:{c:{...c.state.campaigns.c!,topOfSearchPct:60}}};expect(run('R18',{...c,state})).toBeNull();expect(c.audit.events.at(-1)?.reasons).toContain('TOS_CAP');});
it('R19 infinite ACoS lowers ToS, including zero-order TOP',()=>{const c=placement(20,0,17);expect(run('R19',{...c,state:{...c.state,campaigns:{c:{...c.state.campaigns.c!,topOfSearchPct:10}}}})?.after.campaigns.c?.topOfSearchPct).toBe(0);});
it('placement boundaries and minimum post days',()=>{expect(run('R18',placement(29))).toBeNull();expect(run('R19',placement(20,0,17))).toBeNull();const c=placement();expect(run('R18',{...c,state:{...c.state,campaignMemory:{c:{...c.state.campaignMemory.c!,lastChangeAt:{budget:null,status:null,placement:'2026-10-15T07:00Z'}}}}})).toBeNull();});
