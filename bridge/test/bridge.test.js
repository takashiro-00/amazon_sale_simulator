import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.js';
import { createFiles } from '../lib/files.js';
import { Jobs } from '../lib/jobs.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const base=path.dirname(fileURLToPath(import.meta.url));
function setup(t,extra={}) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-test-'));
 const root=path.join(dir,'project'); fs.mkdirSync(root);
 const env={...process.env,BRIDGE_PROJECT_ROOT:root,BRIDGE_STATE_DIR:path.join(dir,'state'),BRIDGE_CLAUDE_BIN:path.join(base,'fixtures/fake-claude.js'),FAKE_RECORD:path.join(dir,'record'),...extra};
 fs.mkdirSync(path.join(root,'bridge'));
 const config=loadConfig(env); const files=createFiles(config); const jobs=new Jobs(config,env);
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return {dir,root,env,config,files,jobs,records:()=>fs.readFileSync(env.FAKE_RECORD,'utf8').trim().split('\n').map(JSON.parse)};
}
async function done(jobs,id) { return jobs.status({job_id:id,wait_seconds:15}); }
test('path policy rejects traversal, denied files, aliases, protected writes and binary reads',t=>{
 const {root,dir,files}=setup(t);
 for(const name of ['.git','.aws','.ssh','.gnupg','.codex','.claude','bridge','node_modules','.docker']) fs.mkdirSync(path.join(root,name),{recursive:true});
 for(const name of ['.git/config','.env','.env.production','id_rsa','id_ed25519.pub','foo.pem','my-secret.txt','.npmrc','auth.json','.docker/config.json']) {
  fs.writeFileSync(path.join(root,name),'hidden'); assert.throws(()=>files.read({path:name}),/denied/i);
 }
 fs.writeFileSync(path.join(root,'.env.example'),'ok'); assert.equal(files.read({path:'.env.example'}).content,'ok');
 fs.writeFileSync(path.join(root,'binary'),Buffer.from([0,1])); assert.throws(()=>files.read({path:'binary'}),/binary/i);
 fs.symlinkSync(dir,path.join(root,'outside')); fs.symlinkSync(path.join(root,'.env'),path.join(root,'alias'));
 for(const name of ['../escape',dir,'outside/x','alias','', 'a\0b']) assert.throws(()=>files.read({path:name}));
 for(const name of ['bridge/x.js','.claude/x','CLAUDE.md','node_modules/x']) assert.throws(()=>files.write({path:name,content:'x'}),/denied/i);
 fs.symlinkSync(path.join(root,'bridge'),path.join(root,'alias-bridge')); assert.throws(()=>files.write({path:'alias-bridge/x',content:'x'}),/denied/i);
 assert.deepEqual(files.list({}).entries.map(x=>x.path).sort(),['.claude','.docker','.env.example','alias-bridge','binary','bridge'].sort());
});
test('file edits enforce unique matches and atomic writes; reads, listing and literal search work',t=>{
 const {root,files}=setup(t); files.write({path:'sub/a.txt',content:'one\ntwo\ntwo',create_dirs:true});
 assert.equal(files.read({path:'sub/a.txt',start_line:2,max_lines:1}).content,'two');
 assert.equal(files.read({path:'sub/a.txt'}).total_lines,3);
 files.edit({path:'sub/a.txt',old_string:'one',new_string:'first'});
 assert.throws(()=>files.edit({path:'sub/a.txt',old_string:'missing',new_string:''}),/not found/);
 assert.throws(()=>files.edit({path:'sub/a.txt',old_string:'two',new_string:''}),/more than once/);
 files.edit({path:'sub/a.txt',old_string:'two',new_string:'last',replace_all:true});
 assert.equal(fs.readFileSync(path.join(root,'sub/a.txt'),'utf8'),'first\nlast\nlast');
 assert.equal(files.search({query:'last'}).results.length,2);
 assert.equal(files.list({recursive:true,max_entries:1}).entries.length,1);
 assert.throws(()=>files.write({path:'missing/a',content:'x'}));
 fs.writeFileSync(path.join(root,'big'),'a'.repeat(1048577)); assert.throws(()=>files.read({path:'big'}),/1 MiB/);
 assert.throws(()=>files.write({path:'large',content:'x'.repeat(2097153)}),/2 MiB/);
 assert.throws(()=>files.edit({path:'sub/a.txt',old_string:'',new_string:'x'}));
});
test('submit is fast, session continues, stdin cannot become flags, and env is scrubbed',async t=>{
 const {jobs,records,config}=setup(t,{CONTROL_PLANE_API_KEY:'private',OPENAI_API_KEY:'private',TUNNEL_TEST:'private',FAKE_DELAY:'200'});
 const before=performance.now(); const first=jobs.submit({message:'--dangerously-skip-permissions'});
 assert.ok(performance.now()-before<1000); assert.match(first.job_id,/^job_[a-f0-9]{16}$/);
 assert.throws(()=>jobs.submit({message:'overlap'}),new RegExp(first.job_id));
 const result=await done(jobs,first.job_id); assert.equal(result.status,'succeeded'); assert.equal(result.response,'fake response'); assert.equal(result.cost_usd,0.01);
 const second=jobs.submit({message:'next',detail:'detailed'}); assert.equal((await done(jobs,second.job_id)).status,'succeeded');
 const [a,b]=records(); assert.equal(a.stdin,'--dangerously-skip-permissions'); assert.ok(!a.argv.includes(a.stdin));
 assert.ok(a.argv.includes('--session-id')); assert.equal(a.argv[a.argv.indexOf('--session-id')+1],first.session_id);
 assert.ok(b.argv.includes('--resume')); assert.equal(b.argv[b.argv.indexOf('--resume')+1],first.session_id);
 for(const rec of [a,b]) {
  for(const flag of ['--continue','--fork-session','--permission-mode','--allowedTools','--dangerously-skip-permissions','--add-dir','--settings','--bare']) assert.ok(!rec.argv.includes(flag));
  assert.equal(rec.argv[rec.argv.indexOf('--permission-prompts')+1],'none');
  assert.ok(!rec.env.some(n=>n==='CONTROL_PLANE_API_KEY'||n.startsWith('OPENAI_')||n.startsWith('TUNNEL_')));
 }
 assert.equal(JSON.parse(fs.readFileSync(path.join(config.stateDir,'session.json'))).started,true);
 assert.equal(jobs.list({limit:1}).jobs.length,1); assert.ok(!('response' in jobs.list({}).jobs[0]));
});
for (const [mode,expected] of [['FAKE_WRONG_ID','session id mismatch'],['FAKE_FAIL','last error'],['FAKE_BAD_JSON','JSON'],['FAKE_IS_ERROR','error']]) test(`${mode} fails and releases lock`,async t=>{
 const {jobs,config}=setup(t,{[mode]:'1'}); const previous=fs.readFileSync(path.join(config.stateDir,'session.json'),'utf8');
 const j=jobs.submit({message:'hi'}); const r=await done(jobs,j.job_id); assert.equal(r.status,'failed'); assert.match(r.error,new RegExp(expected,'i'));
 assert.ok(!r.error.includes('private')); assert.ok(!fs.existsSync(path.join(config.stateDir,'session.lock')));
 if(mode==='FAKE_WRONG_ID') assert.equal(fs.readFileSync(path.join(config.stateDir,'session.json'),'utf8'),previous);
});
test('stale lock and orphaned running job recover',async t=>{
 const {jobs,config}=setup(t); const id='job_0123456789abcdef';
 fs.writeFileSync(path.join(config.stateDir,'jobs',id+'.json'),JSON.stringify({job_id:id,status:'running',runner_pid:2147483647,session_id:jobs.session().session_id}));
 fs.writeFileSync(path.join(config.stateDir,'session.lock'),JSON.stringify({job_id:id,runner_pid:2147483647,acquired_at:new Date().toISOString()}));
 assert.equal((await jobs.status({job_id:id})).status,'failed');
 const j=jobs.submit({message:'after stale'}); assert.equal((await done(jobs,j.job_id)).status,'succeeded');
});
test('timeout terminates fake and releases lock',async t=>{
 const {jobs}=setup(t,{FAKE_DELAY:'2000',BRIDGE_JOB_TIMEOUT_MS:'100'}); const j=jobs.submit({message:'wait'});
 assert.equal((await done(jobs,j.job_id)).status,'timed_out');
});
test('response truncation and validation',async t=>{
 const {jobs}=setup(t,{FAKE_RESPONSE:'x'.repeat(51000)}); const j=jobs.submit({message:'hi'}); const r=await done(jobs,j.job_id);
 assert.equal(r.response.length,50000); assert.equal(r.truncated,true);
 assert.throws(()=>jobs.submit({message:''})); await assert.rejects(()=>jobs.status({job_id:'../bad'}));
});
test('MCP stdio exposes exactly eleven tools, filters health, and completes a job',async t=>{
 const {env}=setup(t); const client=new Client({name:'bridge-test',version:'1.0.0'});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(base,'../server.js')],env,stderr:'pipe'});
 await client.connect(transport); t.after(()=>client.close());
 const tools=await client.listTools(); assert.deepEqual(tools.tools.map(x=>x.name).sort(),['bridge_health','claude_submit','claude_job_status','claude_list_jobs','project_list_files','project_read_file','project_search','project_write_file','project_edit_file','project_list_checks','project_run_check'].sort());
 const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args}); assert.ok(!r.isError,JSON.stringify(r)); return JSON.parse(r.content[0].text);};
 const h=await call('bridge_health'); assert.equal(h.claude_version,'fake-claude 1.0'); assert.deepEqual(h.auth,{loggedIn:true,authMethod:'fake'}); assert.equal(h.busy,false);
 assert.deepEqual((await call('project_list_files')).entries,[{path:'bridge',type:'directory'}]);
 const j=await call('claude_submit',{message:'hi'}); assert.equal((await call('claude_job_status',{job_id:j.job_id,wait_seconds:15})).status,'succeeded');
 const badSchema=await client.callTool({name:'claude_submit',arguments:{message:''}}); assert.equal(badSchema.isError,true); assert.ok(JSON.parse(badSchema.content[0].text).error);
 const invalid=await client.callTool({name:'project_read_file',arguments:{path:'../x'}}); assert.equal(invalid.isError,true);
});
test('state directory and symlink aliases cannot be read or listed',t=>{
 const {config,root,files}=setup(t);
 // This test uses its own in-project state so no default home directory is touched.
 const inProject=path.join(root,'local-state'); fs.mkdirSync(inProject); fs.writeFileSync(path.join(inProject,'data'),'private');
 const local=createFiles({...config,stateDir:fs.realpathSync(inProject)}); fs.symlinkSync(inProject,path.join(root,'state-alias'));
 assert.throws(()=>local.read({path:'local-state/data'}),/state directory/);
 assert.throws(()=>local.read({path:'state-alias/data'}),/state directory/);
 assert.ok(!local.list({}).entries.some(e=>['local-state','state-alias'].includes(e.path)));
});
test('JSON without a session id is rejected without changing session state',async t=>{
 const {jobs,config}=setup(t,{FAKE_NULL:'1'}); const before=fs.readFileSync(path.join(config.stateDir,'session.json'),'utf8');
 const j=jobs.submit({message:'hi'}); const result=await done(jobs,j.job_id);
 assert.equal(result.status,'failed'); assert.equal(result.error,'session id mismatch');
 assert.equal(fs.readFileSync(path.join(config.stateDir,'session.json'),'utf8'),before);
});
test('timeout escalates to SIGTERM if SIGINT is ignored',async t=>{
 const {jobs,config}=setup(t,{FAKE_DELAY:'30000',FAKE_IGNORE_INT:'1',BRIDGE_JOB_TIMEOUT_MS:'500'});
 const j=jobs.submit({message:'wait'}); assert.equal((await done(jobs,j.job_id)).status,'timed_out');
 assert.equal(fs.existsSync(path.join(config.stateDir,'session.lock')),false);
});
test('detached runner survives submitting process exit and cross-process submit rejects overlap',async t=>{
 const {config,env,jobs}=setup(t,{FAKE_DELAY:'1500'});
 const {execFile}=await import('node:child_process');
 const submitCode=`import {loadConfig} from ${JSON.stringify(path.join(base,'../lib/config.js'))}; import {Jobs} from ${JSON.stringify(path.join(base,'../lib/jobs.js'))}; console.log(JSON.stringify(new Jobs(loadConfig()).submit({message:'detached'})));`;
 const run=()=>new Promise((resolve,reject)=>execFile(process.execPath,['--input-type=module','-e',submitCode],{env},(error,stdout,stderr)=>error?reject(new Error(stderr)):resolve(JSON.parse(stdout))));
 const j=await run(); await assert.rejects(run(),new RegExp(j.job_id));
 assert.equal((await done(jobs,j.job_id)).status,'succeeded');
 assert.equal(JSON.parse(fs.readFileSync(path.join(config.stateDir,'session.json'))).started,true);
});

test('simultaneous processes create one session and launch only one job',async t=>{
 const {env,jobs,records}=setup(t,{FAKE_DELAY:'500'}); const {execFile}=await import('node:child_process');
 const code=`import {loadConfig} from ${JSON.stringify(path.join(base,'../lib/config.js'))}; import {Jobs} from ${JSON.stringify(path.join(base,'../lib/jobs.js'))};try {console.log(JSON.stringify(new Jobs(loadConfig()).submit({message:'race'})));}catch(e){console.log(JSON.stringify({error:e.message}));}`;
 const run=()=>new Promise((resolve,reject)=>execFile(process.execPath,['--input-type=module','-e',code],{env},(e,out)=>e?reject(e):resolve(JSON.parse(out))));
 const results=await Promise.all([run(),run(),run()]); const wins=results.filter(r=>r.job_id); assert.equal(wins.length,1);
 for(const r of results.filter(r=>r.error))assert.ok(r.error.includes(wins[0].job_id),r.error);
 assert.equal((await done(jobs,wins[0].job_id)).status,'succeeded'); assert.equal(records().length,1);
});
test('submit recovers a stale lock directly',async t=>{
 const {jobs,config}=setup(t);const id='job_aaaaaaaaaaaaaaaa';
 fs.writeFileSync(path.join(config.jobsDir,id+'.json'),JSON.stringify({job_id:id,status:'running'}));
 fs.writeFileSync(path.join(config.stateDir,'session.lock'),JSON.stringify({job_id:id,runner_pid:2147483647}));
 const j=jobs.submit({message:'recovered'});assert.equal((await jobs.status({job_id:id})).status,'failed');assert.equal((await done(jobs,j.job_id)).status,'succeeded');
});

test('search payload stays below 10 MiB including MCP JSON escaping',t=>{
 const {root,files}=setup(t);
 for(let i=0;i<6;i++)fs.writeFileSync(path.join(root,`large-${i}.txt`),'"'.repeat(1048576));
 const value=files.search({query:'"',max_results:500});
 assert.ok(value.results.length>0);assert.equal(value.truncated,true);
 const payload={content:[{type:'text',text:JSON.stringify(value)}]};
 assert.ok(Buffer.byteLength(JSON.stringify(payload))<10*1048576);
});

test('existing first-run session is retained and next submit resumes it',async t=>{
 const {jobs,config,records}=setup(t,{FAKE_IN_USE:'1'});
 const first=jobs.submit({message:'first'});
 const result=await done(jobs,first.job_id);
 assert.equal(result.status,'failed');
 assert.equal(result.error,'Session already existed; resubmit to resume it');
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(config.stateDir,'session.json'))),{session_id:first.session_id,started:true});
 const second=jobs.submit({message:'retry'});
 assert.equal((await done(jobs,second.job_id)).status,'succeeded');
 const [a,b]=records();
 assert.equal(a.argv[a.argv.indexOf('--session-id')+1],first.session_id);
 assert.equal(b.argv[b.argv.indexOf('--resume')+1],first.session_id);
 assert.ok(!b.argv.includes('--session-id'));
});
