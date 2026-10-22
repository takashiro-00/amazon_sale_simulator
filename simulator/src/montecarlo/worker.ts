import { parentPort } from 'node:worker_threads';
import { runSeed } from './metrics.js';
import type { SimConfig } from '../../config/defaults.js';
import type { Scenario } from '../scenario/schema.js';
parentPort?.on('message',async(task:{scenario:Scenario;config:SimConfig;seed:number})=>{try{parentPort!.postMessage({result:await runSeed(task.scenario,task.config,task.seed)});}catch(e){parentPort!.postMessage({error:e instanceof Error?e.stack:String(e)});}});
