import { zeroOrders } from '../zeroOrders.js';
import type { ObjectRef,RuleContext,Proposal } from '../../engine/types.js';
import { normalizeText } from '../../api/tags.js';
import { resolveWindow } from '../../data/windows.js';
export function query(r:ObjectRef){return normalizeText(r.query??r.id.split(':search:').slice(1).join(':search:'));}
export function searchWindow(r:ObjectRef,c:RuleContext){const w=resolveWindow({kind:'rolling',days:14,minRipeDays:1},c.today,{windowStartAt:c.state.targets[r.sourceTargetId??'']?.createdAt??'1900-01-01T00:00Z'},c.config);return c.metrics.campaignWindow(`${r.sourceTargetId}:search:${query(r)}`,w);}
export function exactExists(r:ObjectRef,c:RuleContext){const asin=c.state.campaigns[r.campaignId!]!.asin;return Object.values(c.state.targetEntities).some(e=>e.kind==='KEYWORD'&&e.matchType==='EXACT'&&e.status==='ENABLED'&&c.state.campaigns[e.campaignId]?.asin===asin&&normalizeText(e.text)===query(r));}
export function negativeExists(r:ObjectRef,c:RuleContext){return (c.state.negatives?.[r.campaignId!]??[]).some(n=>normalizeText(n.text)===query(r));}
export const diagnose=(r:ObjectRef,c:RuleContext)=>exactExists(r,c)?['EXACT_KEYWORD_EXISTS']:[];
export function negative(r:ObjectRef,c:RuleContext):Proposal{return {proposedState:{...c.state,negatives:{...c.state.negatives,[r.campaignId!]:[...(c.state.negatives?.[r.campaignId!]??[]),{campaignId:r.campaignId!,text:query(r),matchType:'NEGATIVE_EXACT'}]}}};}

export function zero(r:ObjectRef,c:RuleContext,orders:number){return zeroOrders(`${r.sourceTargetId}:search:${query(r)}`,c,orders,{kind:'rolling',days:14,minRipeDays:1},c.state.targets[r.sourceTargetId??'']?.createdAt??'1900-01-01T00:00Z');}
