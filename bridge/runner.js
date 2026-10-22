import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig, atomicJSON, scrubEnv, validJobId } from './lib/config.js';
import { session, markSessionStarted, releaseLock, updateLock } from './lib/session.js';
import { redact } from './lib/jobs.js';
const config=loadConfig(); const id=validJobId(process.argv[2]); const file=path.join(config.jobsDir,id+'.json');
let job; let child; let timeout; let escalation; let timedOut=false;
const now=()=>new Date().toISOString();
try {
 job=JSON.parse(fs.readFileSync(file,'utf8')); updateLock(config,id,process.pid);
 job={...job,status:'running',runner_pid:process.pid,started_at:now()}; atomicJSON(file,job);
 const s=session(config);
 const instruction=job.detail==='detailed'?'Reply completely but without filler.':'You are answering a remote agent through a bridge. Reply concisely: at most about 150 words, no preamble, unless the request explicitly asks for more detail.';
 const args=['-p','--output-format','json',s.started?'--resume':'--session-id',s.session_id,'--permission-prompts','none','--append-system-prompt',instruction];
 const outFile=path.join(config.jobsDir,id+'.stdout'); const errFile=path.join(config.jobsDir,id+'.stderr');
 const out=fs.openSync(outFile,'w',0o600); const err=fs.openSync(errFile,'w',0o600);
 try {child=spawn(config.claudeBin,args,{cwd:config.projectRoot,shell:false,env:scrubEnv(process.env),stdio:['pipe',out,err]});}
 finally{fs.closeSync(out);fs.closeSync(err);}
 child.stdin.on('error',()=>{}); child.stdin.end(job.message);
 const exit=await new Promise((resolve,reject)=>{
  child.once('error',reject); child.once('close',(code,signal)=>resolve({code,signal}));
  timeout=setTimeout(()=>{timedOut=true;child.kill('SIGINT');escalation=setTimeout(()=>child.kill('SIGTERM'),10000);},config.timeoutMs);
 });
 clearTimeout(timeout);clearTimeout(escalation);
 const stdout=fs.readFileSync(outFile,'utf8');
 const stderr=fs.readFileSync(errFile,'utf8');
 let output; let parseError=false;
 try {output=JSON.parse(stdout);}catch{parseError=true;}
 // Redact complete lines before retaining the stderr tail.
 const summary=redact(stderr);
 const matching=output?.session_id===s.session_id;
 const failed=timedOut||exit.code!==0||parseError||output?.is_error||!matching;
 if(!s.started&&failed&&/already in use/i.test(stderr+'\n'+stdout)) {
  markSessionStarted(config,s);
  job={...job,status:'failed',is_error:true,error:'Session already existed; resubmit to resume it'};
 }
 else if(!parseError&&!matching) {job={...job,status:'failed',is_error:true,error:'session id mismatch'};}
 else {
  if(matching)markSessionStarted(config,s);
  if(timedOut)job={...job,status:'timed_out',is_error:true,error:'Job timed out'+(summary?': '+summary:'')};
  else if(exit.code!==0||parseError||output?.is_error)job={...job,status:'failed',is_error:true,error:(parseError?'Invalid Claude JSON output':exit.code!==0?'Claude exited unsuccessfully':'Claude reported an error')+(summary?': '+summary:'')};
  else job={...job,status:'succeeded',is_error:false};
 }
 if(typeof output?.result==='string')job.response=output.result;
 if(typeof output?.total_cost_usd==='number'&&Number.isFinite(output.total_cost_usd))job.cost_usd=output.total_cost_usd;
 job.finished_at=now(); atomicJSON(file,job);
} catch {
 if(job)atomicJSON(file,{...job,status:timedOut?'timed_out':'failed',is_error:true,error:timedOut?'Job timed out':'Runner could not execute Claude',finished_at:now()});
} finally {clearTimeout(timeout);clearTimeout(escalation);releaseLock(config,id);}
