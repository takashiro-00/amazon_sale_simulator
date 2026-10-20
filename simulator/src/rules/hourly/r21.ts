import type { RuleDefinition } from '../../engine/types.js';
import { analyzeHours } from './analysis.js';
import { stateEqual } from '../../engine/priority.js';
export const evaluate:RuleDefinition['evaluate']=(r,c)=>{if(!c.state.targets[r.id])return null;const s=analyzeHours(c,'R21');const next={...c.state,targets:{...c.state.targets,[r.id]:s.targets[r.id]!}};return stateEqual(next,c.state)?null:{proposedState:next};};
