import { it,expect } from 'vitest';
import { fixture } from './step4-fixture.js';
import { verifyHarvests } from '../src/runner/harvest.js';
import { InMemoryFakePort } from '../src/api/port.js';
import { FaultyFakePort } from '../src/api/faultyPort.js';
import type { EngineState } from '../src/engine/types.js';
it('invisible created keyword cannot cause negative until verified, then exactly once',async()=>{const c=fixture(),clock=c.clock as import('../src/time/clock.js').SimClock;const port=new FaultyFakePort(new InMemoryFakePort(),clock,1,{createSucceedsButInvisible:60});await port.createKeywords([{...c.state.targetEntities.t!,matchType:"EXACT"}],'create');
 let state:EngineState={...c.state,pendingHarvests:[{query:'k',sourceCampaignId:'c',sourceTargetId:'t',destCampaignId:'c',keywordId:'t',createdAt:clock.now()}]};const notes:unknown[]=[];
 state=await verifyHarvests(state,port,clock.now(),e=>notes.push(e));expect(state.negatives?.c??[]).toHaveLength(0);expect(state.pendingHarvests).toHaveLength(1);
 clock.advanceHours(1);state=await verifyHarvests(state,port,clock.now(),e=>notes.push(e));state=await verifyHarvests(state,port,clock.now(),e=>notes.push(e));expect(state.negatives?.c).toHaveLength(1);expect(port.calls.filter(x=>x.op==='createNegatives')).toHaveLength(1);
});
it('verification timeout never adds a negative',async()=>{const c=fixture();const notes:unknown[]=[];const s:EngineState={...c.state,pendingHarvests:[{query:'k',sourceCampaignId:'c',sourceTargetId:'t',destCampaignId:'c',keywordId:'t',createdAt:'2026-10-01T07:00Z'}]};const state=await verifyHarvests(s,new FaultyFakePort(new InMemoryFakePort(),c.clock,1),c.clock.now(),e=>notes.push(e));expect(state.pendingHarvests).toHaveLength(0);expect(state.negatives?.c??[]).toHaveLength(0);expect(notes).toMatchObject([{type:'R15_VERIFY_TIMEOUT'}]);});
it('verification contains generic API failures retries 503 and notifies exhausted negative writes',async()=>{
 const c=fixture(),s:EngineState={...c.state,pendingHarvests:[{query:'k',sourceCampaignId:'c',sourceTargetId:'t',destCampaignId:'c',keywordId:'t',createdAt:c.clock.now()}]},notes:import('../src/engine/types.js').NotificationLog[]=[];let calls=0;
 class Broken extends InMemoryFakePort {override async listKeywords(){return [{...c.state.targetEntities.t!,matchType:'EXACT' as const}];}override async createNegatives():Promise<never>{calls++;throw new Error('503 SERVICE_UNAVAILABLE');}}
 const r=await verifyHarvests(s,new Broken(),c.clock.now(),n=>notes.push(n));expect(calls).toBe(4);expect(r.pendingHarvests).toHaveLength(1);expect(r.negatives?.c??[]).toHaveLength(0);expect(notes[0]?.type).toBe('API_WRITE_FAILED');
});
