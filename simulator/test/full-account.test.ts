import { it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateScenario } from '../src/scenario/schema.js';
import { runAccountLoop } from '../src/runner/accountLoop.js';
it('full-account 60 day fixed seed satisfies all Step 4 smoke expectations',async()=>{
 const s=validateScenario(JSON.parse(readFileSync('scenarios/full-account.json','utf8')));const r=await runAccountLoop({scenario:s});
 const bleeder=r.timeline.filter(t=>t.targetId==='bleeder').map(t=>t.ruleId),harvest=r.decisions.filter(d=>d.ruleId==='R15'),low=r.timeline.filter(t=>t.targetId==='low'&&t.ruleId==='R14');
 const measurements={bleeder,bleederStatus:r.state.targetEntities.bleeder?.status,negatives:r.state.negatives,harvest:harvest.map(d=>d.runId),verified:r.state.verifiedHarvests,lowRaises:low.length,targets:r.targets};
 expect(bleeder,JSON.stringify(measurements)).toContain('R12');expect(bleeder,JSON.stringify(measurements)).toContain('R13');expect(r.state.targetEntities.bleeder?.status,JSON.stringify(measurements)).toBe('PAUSED');
 expect(r.state.negatives?.auto?.some(n=>n.text==='free broken grinder'),JSON.stringify(measurements)).toBe(true);
 expect(harvest.length,JSON.stringify(measurements)).toBeGreaterThan(0);
 for(const d of harvest)expect(new Date(d.runId.split('|')[0]!).toLocaleDateString('en-US',{timeZone:'America/Los_Angeles',weekday:'long'})).toBe('Sunday');
 expect(r.state.verifiedHarvests?.some(p=>p.query==='portable coffee grinder'),JSON.stringify(measurements)).toBe(true);expect(r.state.negatives?.auto?.some(n=>n.text==='portable coffee grinder'&&n.harvestKeywordId),JSON.stringify(measurements)).toBe(true);
 expect(low.length,JSON.stringify(measurements)).toBeGreaterThan(0);let cycle=0;
 for(const [i,d] of r.decisions.filter(d=>d.ruleId==='R14'&&d.objectRef.id==='low').entries()){
  if(i)expect((Date.parse(d.runId.split('|')[0]!)-Date.parse(low[i-1]!.date))/86400000).toBeGreaterThanOrEqual(7);
  cycle++;expect(cycle).toBeLessThanOrEqual(3);
  if(d.after.targets.low!.lowImpressionFlagUntil!==d.before.targets.low!.lowImpressionFlagUntil&&d.after.targets.low!.lowImpressionFlagUntil)cycle=0;
 }
 for(const e of r.audit){
  if(e.outcome==='MATCHED'){expect(Object.keys(e.after as object).length).toBeGreaterThan(0);if(e.ruleId!=='R01')expect((e.inputsSnapshot as {reads:unknown[]}).reads.length).toBeGreaterThan(0);}
  if(e.outcome==='SKIPPED_NOOP'){expect(e.before).toEqual({});expect(e.after).toEqual({});expect((e.inputsSnapshot as {reads:unknown[]}).reads.length).toBeGreaterThan(0);}
 }
 const boundaryCalls=r.portCalls.filter(c=>c.idempotencyKey.startsWith('R21B:'));expect(new Set(boundaryCalls.map(c=>c.idempotencyKey)).size).toBe(boundaryCalls.length);
},15000);
