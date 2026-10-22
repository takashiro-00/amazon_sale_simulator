import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJSON, validJobId } from './config.js';
export function alive(pid) {if(!Number.isInteger(pid)||pid<=0) return false;try {process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}
export function session(config) {
 const file=path.join(config.stateDir,'session.json');
 // Publish a fully written session atomically, without replacing another process's session.
 if(!fs.existsSync(file)) {
  const temp=file+'.'+randomUUID()+'.tmp';
  try {fs.writeFileSync(temp,JSON.stringify({session_id:randomUUID(),started:false}),{flag:'wx',mode:0o600}); try {fs.linkSync(temp,file);} catch(e){if(e.code!=='EEXIST')throw e;}}
  finally {fs.unlinkSync(temp);}
 }
 const value=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.session_id)||typeof value.started!=='boolean') throw new Error('Invalid dedicated session state; manual repair required');
 return value;
}
export function markSessionStarted(config, value) {
 atomicJSON(path.join(config.stateDir,'session.json'),{...value,started:true});
}
export function readLock(config) {
 // An exclusive creator can be between open('wx') and its first write.
 for(let attempt=0;attempt<20;attempt++) {
  try {
   const text=fs.readFileSync(path.join(config.stateDir,'session.lock'),'utf8');
   if(text.length) return JSON.parse(text);
  } catch(e) {if(e.code==='ENOENT')return null;throw e;}
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);
 }
 throw new Error('Session lock is incomplete; manual repair required');
}
export function releaseLock(config,jobId) {
 const lock=readLock(config); if(lock?.job_id===jobId) fs.unlinkSync(path.join(config.stateDir,'session.lock'));
}
export function recoverLock(config) {
 const lock=readLock(config); if(!lock||alive(lock.runner_pid)) return lock;
 validJobId(lock.job_id);
 const file=path.join(config.jobsDir,lock.job_id+'.json');
 try {const job=JSON.parse(fs.readFileSync(file,'utf8')); if(['queued','running'].includes(job.status)) atomicJSON(file,{...job,status:'failed',is_error:true,error:'runner exited unexpectedly',finished_at:new Date().toISOString()});} catch(e){if(e.code!=='ENOENT')throw e;}
 releaseLock(config,lock.job_id); return null;
}
export function acquireLock(config,jobId) {
 const existing=recoverLock(config); if(existing) throw new Error('Dedicated session busy: '+existing.job_id);
 let fd;
 try {fd=fs.openSync(path.join(config.stateDir,'session.lock'),'wx',0o600);} catch(e) {
  if(e.code==='EEXIST') throw new Error('Dedicated session busy: '+(readLock(config)?.job_id || 'lock acquisition in progress')); throw e;
 }
 try {fs.writeFileSync(fd,JSON.stringify({job_id:jobId,runner_pid:process.pid,acquired_at:new Date().toISOString()}));}finally{fs.closeSync(fd);}
}
export function updateLock(config,jobId,pid) {
 const lock=readLock(config); if(lock?.job_id!==jobId)throw new Error('Session lock ownership lost');
 atomicJSON(path.join(config.stateDir,'session.lock'),{...lock,runner_pid:pid});
}
