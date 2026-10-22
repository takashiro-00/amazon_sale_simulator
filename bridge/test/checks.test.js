import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const base=path.dirname(fileURLToPath(import.meta.url));
async function setup(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-check-'));
 const checks=path.join(dir,'checks.json');
 const fixture=path.join(base,'fixtures/check.js');
 const definitions=Object.fromEntries(['pass','fail','tree'].map(name=>[name,{cwd:'.',argv:[process.execPath,fixture,name,path.join(dir,'heartbeat')],timeout_seconds:1,description:name}]));
 fs.writeFileSync(checks,JSON.stringify(definitions));
 const env={...process.env,BRIDGE_PROJECT_ROOT:dir,BRIDGE_STATE_DIR:path.join(dir,'state'),BRIDGE_CHECKS_FILE:checks,CONTROL_PLANE_API_KEY:'hidden-control',OPENAI_API_KEY:'hidden-openai'};
 const connect=async()=>{const client=new Client({name:'check-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(base,'../server.js')],env,stderr:'pipe'}));t.after(()=>client.close());return client;};
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const client=await connect();
 return {dir,client,connect,call:async(name,args={})=>{const r=await client.callTool({name,arguments:args});return {...r,value:JSON.parse(r.content[0].text)};}};
}
test('allowlisted checks list, reject unknown and injected inputs, scrub env, redact and return exits',async t=>{
 const {call}=await setup(t);
 const list=await call('project_list_checks');assert.equal(list.isError,undefined);assert.equal(list.value.checks.length,3);
 assert.equal((await call('project_run_check',{name:'unknown'})).isError,true);
 assert.equal((await call('project_run_check',{name:'pass',argv:['injected']})).isError,true);
 const r=(await call('project_run_check',{name:'pass'})).value;
 assert.equal(r.exit_code,0);assert.equal(r.timed_out,false);assert.equal(r.signal,null);
 assert.match(r.stdout_tail,/clean-env/);assert.ok(!r.stdout_tail.includes('hidden'));assert.ok(!r.stdout_tail.includes('sensitive'));assert.match(r.stdout_tail,/\[redacted\]/);assert.match(r.stderr_tail,/\[redacted\]/);assert.ok(r.stdout_tail.length<=20000);
 assert.equal((await call('project_run_check',{name:'fail'})).value.exit_code,7);
});
test('timeout kills process group including resistant grandchild and rejects overlap across servers',async t=>{
 const {dir,client,connect}=await setup(t);const other=await connect();
 const running=client.callTool({name:'project_run_check',arguments:{name:'tree'}});
 const heartbeat=path.join(dir,'heartbeat');
 for(let i=0;i<100&&!fs.existsSync(heartbeat);i++)await new Promise(r=>setTimeout(r,20));
 assert.ok(fs.existsSync(heartbeat));
 const overlap=await other.callTool({name:'project_run_check',arguments:{name:'pass'}});assert.equal(overlap.isError,true);assert.match(overlap.content[0].text,/busy|running/i);
 const r=JSON.parse((await running).content[0].text);assert.equal(r.timed_out,true);assert.ok(r.duration_ms<6000);
 const before=fs.readFileSync(heartbeat,'utf8');await new Promise(r=>setTimeout(r,200));assert.equal(fs.readFileSync(heartbeat,'utf8'),before);
});

test('startup rejects invalid allowlists and cwd escapes; stale check lock recovers',async t=>{
 const { Checks }=await import('../lib/checks.js');
 const { loadConfig }=await import('../lib/config.js');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-check-validation-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'checks.json');
 const env={BRIDGE_PROJECT_ROOT:dir,BRIDGE_STATE_DIR:path.join(dir,'state'),BRIDGE_CHECKS_FILE:file};
 const config=loadConfig(env);
 const good={cwd:'.',argv:[process.execPath,path.join(base,'fixtures/check.js'),'pass'],timeout_seconds:1,description:'fixture'};
 const load=(value)=>{fs.writeFileSync(file,JSON.stringify(value));return new Checks(config,env);};
 for(const value of [null,[],{'bad_name':good},{ok:{...good,cwd:'..'}},{ok:{...good,cwd:'state'}},{ok:{...good,argv:['node']}},{ok:{...good,argv:[file]}},{ok:{...good,timeout_seconds:0}},{ok:{...good,timeout_seconds:101}},{ok:{...good,timeout_seconds:1.5}}])assert.throws(()=>load(value));
 fs.symlinkSync(os.tmpdir(),path.join(dir,'escape'));
 assert.throws(()=>load({ok:{...good,cwd:'escape'}}),/denied/);
 const checks=load({ok:good});
 fs.writeFileSync(path.join(config.stateDir,'check.lock'),JSON.stringify({id:'stale',runner_pid:2147483647,name:'ok'}));
 assert.equal((await checks.run({name:'ok'})).exit_code,0);
 assert.equal(fs.existsSync(path.join(config.stateDir,'check.lock')),false);
});
