import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
export const VERSION='1.0.0';
export const JOB_ID=/^job_[a-f0-9]{16}$/;
export function loadConfig(env=process.env) {
 const projectRoot=fs.realpathSync(env.BRIDGE_PROJECT_ROOT || fileURLToPath(new URL('../../',import.meta.url)));
 const stateDir=path.resolve(env.BRIDGE_STATE_DIR || path.join(os.homedir(),'.claude-chatgpt-bridge/amazon-ads-automation'));
 fs.mkdirSync(stateDir,{recursive:true,mode:0o700}); fs.chmodSync(stateDir,0o700);
 const jobsDir=path.join(fs.realpathSync(stateDir),'jobs'); fs.mkdirSync(jobsDir,{recursive:true,mode:0o700});
 const claudeBin=env.BRIDGE_CLAUDE_BIN || path.join(os.homedir(),'.local/bin/claude');
 if(!path.isAbsolute(claudeBin)) throw new Error('Claude binary must be absolute');
 const timeoutMs=Number(env.BRIDGE_JOB_TIMEOUT_MS || 1800000);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1) throw new Error('Invalid job timeout');
 return {projectRoot,stateDir:fs.realpathSync(stateDir),jobsDir,claudeBin,timeoutMs};
}
export function scrubEnv(env) {
 return Object.fromEntries(Object.entries(env).filter(([name])=>name!=='CONTROL_PLANE_API_KEY'&&!name.startsWith('OPENAI_')&&!name.startsWith('TUNNEL_')));
}
export function atomicJSON(target,value) {
 const temp=target+'.'+crypto.randomUUID()+'.tmp';
 try { fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600,flag:'wx'}); fs.renameSync(temp,target); }
 finally { try { fs.unlinkSync(temp); } catch(e) { if(e.code!=='ENOENT') throw e; } }
}
export function validJobId(id) { if(typeof id!=='string'||!JOB_ID.test(id)) throw new Error('Invalid job id'); return id; }
