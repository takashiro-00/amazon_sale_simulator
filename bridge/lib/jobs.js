import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { VERSION, JOB_ID, atomicJSON, scrubEnv, validJobId } from './config.js';
import { session, acquireLock, updateLock, recoverLock, releaseLock, alive } from './session.js';
export const SENSITIVE_LINE=/key|token|secret|password|authorization|bearer/i;
export function redact(stderr,limit=2000) {return stderr.split(/\r?\n/).map(line=>SENSITIVE_LINE.test(line)?'[redacted]':line).join('\n').slice(-limit);}
export class Jobs {
 constructor(config,env=process.env) {this.config=config;this.env=env;session(config);}
 session(){return session(this.config);}
 read(id){validJobId(id); try{return JSON.parse(fs.readFileSync(path.join(this.config.jobsDir,id+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')throw new Error('Job not found');throw e;}}
 submit({message,detail='concise'}={}) {
  if(typeof message!=='string'||message.length<1||message.length>20000)throw new Error('Message must contain 1–20,000 characters');
  if(!['concise','detailed'].includes(detail))throw new Error('Invalid detail');
  const jobId='job_'+randomBytes(8).toString('hex'); const s=this.session();
  const file=path.join(this.config.jobsDir,jobId+'.json');
  const job={job_id:jobId,session_id:s.session_id,status:'queued',created_at:new Date().toISOString(),started_at:null,finished_at:null,message,detail,runner_pid:process.pid};
  atomicJSON(file,job);
  try {acquireLock(this.config,jobId);} catch(error) {fs.unlinkSync(file);throw error;}
  let child;
  try {
   const env=scrubEnv({...this.env,BRIDGE_PROJECT_ROOT:this.config.projectRoot,BRIDGE_STATE_DIR:this.config.stateDir,BRIDGE_CLAUDE_BIN:this.config.claudeBin,BRIDGE_JOB_TIMEOUT_MS:String(this.config.timeoutMs)});
   child=spawn(process.execPath,[fileURLToPath(new URL('../runner.js',import.meta.url)),jobId],{detached:true,stdio:'ignore',shell:false,env});
   child.on('error',()=>{try{atomicJSON(file,{...job,status:'failed',is_error:true,error:'Unable to launch runner',finished_at:new Date().toISOString()});releaseLock(this.config,jobId);}catch{ /* State remains recoverable on the next request. */ }});
   if(!child.pid)throw new Error('Unable to launch runner');
   // Runner reads its pid from the lock; do not rewrite its job record after launch.
   updateLock(this.config,jobId,child.pid); child.unref();
   return {job_id:jobId,session_id:s.session_id,status:'queued'};
  } catch(e) {releaseLock(this.config,jobId);throw e;}
 }
 async status({job_id,wait_seconds=0}={}) {
  validJobId(job_id); if(!Number.isInteger(wait_seconds)||wait_seconds<0||wait_seconds>60)throw new Error('wait_seconds must be an integer from 0 to 60');
  const deadline=Date.now()+wait_seconds*1000;
  let job;
  do {
   recoverLock(this.config); job=this.read(job_id);
   if(job.status==='running'&&!alive(job.runner_pid)) {
    job={...job,status:'failed',is_error:true,error:'runner exited unexpectedly',finished_at:new Date().toISOString()};
    atomicJSON(path.join(this.config.jobsDir,job_id+'.json'),job); releaseLock(this.config,job_id);
   }
   if(!['queued','running'].includes(job.status)||Date.now()>=deadline)break;
   await delay(Math.min(100,deadline-Date.now()));
  }while(true);
  const response=typeof job.response==='string'?job.response:'';
  return {job_id:job.job_id,status:job.status,created_at:job.created_at,started_at:job.started_at??null,finished_at:job.finished_at??null,session_id:job.session_id,response:response.slice(0,50000),truncated:response.length>50000,is_error:job.is_error??false,...(job.cost_usd!==undefined?{cost_usd:job.cost_usd}:{}),...(job.error?{error:job.error}:{})};
 }
 list({limit=10}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error('limit must be 1–50');
  return {jobs:this.all().sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||'')).slice(0,limit).map(j=>({job_id:j.job_id,status:j.status,created_at:j.created_at,started_at:j.started_at??null,finished_at:j.finished_at??null,message:(j.message||'').slice(0,120)}))};
 }
 all(){return fs.readdirSync(this.config.jobsDir).filter(n=>n.endsWith('.json')&&JOB_ID.test(n.slice(0,-5))).map(n=>this.read(n.slice(0,-5)));}
 async health() {
  const c=this.config; const lock=recoverLock(c); let exists=false,executable=false;
  try {exists=fs.statSync(c.claudeBin).isFile();fs.accessSync(c.claudeBin,fs.constants.X_OK);executable=exists;} catch { /* Report availability without environment details. */ }
  const run=args=>new Promise(resolve=>execFile(c.claudeBin,args,{timeout:5000,maxBuffer:65536,env:scrubEnv(this.env),shell:false},(error,stdout)=>resolve(error?null:stdout.trim())));
  const [version,authText]=executable?await Promise.all([run(['--version']),run(['auth','status'])]):[null,null];
  let auth=null; try {const a=JSON.parse(authText);auth={...(typeof a.loggedIn==='boolean'?{loggedIn:a.loggedIn}:{}),...(typeof a.authMethod==='string'?{authMethod:a.authMethod}:{})};}catch{ /* Do not expose raw auth output. */ }
  const counts={queued:0,running:0,succeeded:0,failed:0,timed_out:0}; for(const j of this.all())if(j.status in counts)counts[j.status]++;
  return {version:VERSION,project_root:c.projectRoot,state_dir:c.stateDir,node_version:process.version,claude_exists:exists,claude_executable:executable,claude_version:version,auth,session_id:this.session().session_id,busy:!!lock,running_job_id:lock?.job_id??null,jobs:counts};
 }
}
