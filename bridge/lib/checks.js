import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { scrubEnv } from './config.js';
import { resolvePath } from './paths.js';
import { alive } from './session.js';
import { redact, SENSITIVE_LINE } from './jobs.js';

// Track sensitive words across chunks, even on lines larger than the retained tail.
function outputTail() {
 let completed='',line='',context='',sensitive=false;
 return {
  add(chunk) {
   const pieces=chunk.split('\n');
   for(let i=0;i<pieces.length;i++) {
    const piece=pieces[i];
    sensitive ||= SENSITIVE_LINE.test(context+piece);
    context=(context+piece).slice(-20);
    line=(line+piece).slice(-20000);
    if(i<pieces.length-1) {
     completed=(completed+(sensitive?'[redacted]':line)+'\n').slice(-20000);
     line='';context='';sensitive=false;
    }
   }
  },
  value:()=> (completed+(sensitive?'[redacted]':redact(line,20000))).slice(-20000)
 };
}

export class Checks {
 constructor(config,env=process.env) {
  this.config=config;this.env=env;
  const file=env.BRIDGE_CHECKS_FILE || fileURLToPath(new URL('../checks.json',import.meta.url));
  const definitions=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!definitions||Array.isArray(definitions)||typeof definitions!=='object')throw new Error('Invalid checks allowlist');
  this.checks=new Map();
  for(const [name,value] of Object.entries(definitions)) {
   if(!/^[a-z0-9-]+$/.test(name)||!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid check definition');
   const {cwd,argv,timeout_seconds,description}=value;
   if(typeof cwd!=='string'||!Array.isArray(argv)||!argv.length||argv.some(a=>typeof a!=='string'||a.includes('\0'))||!path.isAbsolute(argv[0])||!Number.isInteger(timeout_seconds)||timeout_seconds<1||timeout_seconds>100||typeof description!=='string')throw new Error('Invalid check definition');
   const resolved=resolvePath(config,cwd);
   if(!fs.statSync(resolved).isDirectory())throw new Error('Check cwd must be a directory');
   fs.accessSync(argv[0],fs.constants.X_OK);
   if(!fs.statSync(argv[0]).isFile())throw new Error('Check executable must be a file');
   this.checks.set(name,{name,cwd,argv:[...argv],timeout_seconds,description,resolved});
  }
 }
 list() {return {checks:[...this.checks.values()].map(({name,description,cwd,timeout_seconds})=>({name,description,cwd,timeout:timeout_seconds}))};}
 acquire(name) {
  const file=path.join(this.config.stateDir,'check.lock');
  // Publish a complete record atomically, so readers never see an empty lock.
  const id=randomUUID(),temp=file+'.'+id+'.tmp';
  fs.writeFileSync(temp,JSON.stringify({id,name,runner_pid:process.pid}),{flag:'wx',mode:0o600});
  try {
   for(let attempt=0;attempt<3;attempt++) {
    try {fs.linkSync(temp,file);return ()=>{
     try {if(JSON.parse(fs.readFileSync(file,'utf8')).id===id)fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}
    };}catch(e){if(e.code!=='EEXIST')throw e;}
    let lock;
    try {lock=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
    if(alive(lock.runner_pid))throw new Error('Check already running (busy): '+lock.name);
    // Match the existing session lock’s stale-pid recovery policy.
    const stale=fs.statSync(file);
    try {if(fs.statSync(file).ino===stale.ino)fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}
   }
   throw new Error('Check already running (busy)');
  } finally {fs.unlinkSync(temp);}
 }
 async run(input) {
  if(!input||Object.keys(input).some(k=>k!=='name')||typeof input.name!=='string')throw new Error('Invalid check input: name only');
  const check=this.checks.get(input.name);if(!check)throw new Error('Unknown check name');
  const release=this.acquire(check.name);const started=performance.now();
  try {
   // Reapply path policy in case a local owner changed a symlink since startup.
   const cwd=resolvePath(this.config,check.cwd);
   const stdout=outputTail(),stderr=outputTail();
   return await new Promise((resolve,reject)=>{
    let timedOut=false,closed=false,escalated=false,exitCode=null,signal=null,spawnError;
    const child=spawn(check.argv[0],check.argv.slice(1),{cwd,shell:false,detached:true,env:scrubEnv(this.env),stdio:['ignore','pipe','pipe']});
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',s=>stdout.add(s));child.stderr.on('data',s=>stderr.add(s));
    const kill=sig=>{try {process.kill(-child.pid,sig);}catch(e){if(e.code!=='ESRCH')throw e;}};
    const finish=()=>{
     if(!closed||(timedOut&&!escalated))return;
     clearTimeout(timer);
     if(spawnError)return reject(new Error('Check process could not start'));
     resolve({name:check.name,exit_code:exitCode,signal,timed_out:timedOut,duration_ms:Math.round(performance.now()-started),stdout_tail:stdout.value(),stderr_tail:stderr.value()});
    };
    const timer=setTimeout(()=>{
     timedOut=true;kill('SIGTERM');
     setTimeout(()=>{kill('SIGKILL');escalated=true;
      // A descendant can retain pipes; bound cleanup independently of pipe closure.
      child.stdout.destroy();child.stderr.destroy();closed=true;finish();
     },3000);
    },check.timeout_seconds*1000);
    child.on('error',error=>{spawnError=error;});
    child.on('exit',(code,sig)=>{exitCode=code;signal=sig;});
    child.on('close',()=>{closed=true;finish();});
   });
  } finally {release();}
 }
}
