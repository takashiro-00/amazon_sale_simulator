import { it, expect } from 'vitest';
import { fixture, run } from './step4-fixture.js';
it('audit stores changed fields and only reads for the evaluated rule',()=>{
 const c=fixture(); const d=run('R02',c)!; expect(d).not.toBeNull();
 const event=c.audit.events.find(e=>e.outcome==='MATCHED')!;
 expect(event.before).not.toEqual(d.before);
 expect(event.inputsSnapshot).toMatchObject({reads:expect.any(Array),paramsVersion:c.paramsVersion,now:c.clock.now(),configHash:expect.any(String)});
 expect((event.inputsSnapshot as {reads:unknown[]}).reads.length).toBeGreaterThan(0);
 expect(event.inputsSnapshot).not.toHaveProperty('state');expect(event.inputsSnapshot).not.toHaveProperty('factsAsOf');
});
it('matched level drops unmatched events but keeps errors and matches',()=>{
 const c=fixture();const ctx={...c,config:{...c.config,audit:{level:'matched' as const}}};
 run('R06',ctx);run('R02',ctx);
 expect(c.audit.events.map(e=>e.outcome)).toEqual(['MATCHED']);
});
it('audit iterators preserve event order and JSONL',()=>{
 const c=fixture();run('R06',c);run('R02',c);
 expect([...c.audit]).toEqual(c.audit.events);
 expect([...c.audit.jsonLines()].join('')).toBe(c.audit.serializeJSONL());
});
