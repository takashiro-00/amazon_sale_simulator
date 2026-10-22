import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const run=promisify(execFile);
const scripts=fileURLToPath(new URL('../scripts/',import.meta.url));
for (const {name,key,valid} of [
 {name:'long key with surrounding whitespace',key:` \t\nsk-proj-${'x'.repeat(160)}\r\n\t `,valid:true},
 {name:'too-short key',key:'sk-short',valid:false},
 {name:'missing prefix',key:'x'.repeat(168),valid:false},
]) {
 test(`store tunnel key: ${name}`,async t=>{
  const {state,env}=setup(t);
  fs.writeFileSync(path.join(state,'clipboard'),key);
  const stubs={
   pbpaste:'cat "$BRIDGE_STATE_DIR/clipboard"',
   pbcopy:'wc -c > "$BRIDGE_STATE_DIR/clipboard-cleared"',
   // Persist only argument count and lengths, never argument values.
   security:'printf "%s\\n" "$#" > "$BRIDGE_STATE_DIR/security-count"\nfor arg in "$@"; do printf "%s\\n" "${#arg}"; done > "$BRIDGE_STATE_DIR/security-lengths"',
  };
  for (const [name,body] of Object.entries(stubs)) {
   fs.writeFileSync(path.join(state,name),`#!/bin/bash\nset -euo pipefail\n${body}\n`,{mode:0o700});
  }
  env.PATH=state+path.delimiter+process.env.PATH;
  env.USER='test-user';
  const result=await new Promise((resolve,reject)=>{
   execFile('/bin/bash',[path.join(scripts,'store-tunnel-key.sh')],{env},(error,stdout,stderr)=>{
    if (error && typeof error.code!=='number') return reject(error);
    resolve({code:error?.code ?? 0,stdout,stderr});
   });
  });
  assert.equal(result.stdout.includes(key.trim()),false,'stdout must not expose key');
  assert.equal(result.stderr.includes(key.trim()),false,'stderr must not expose key');
  if (valid) {
   assert.equal(result.code,0);
   assert.equal(result.stdout,'Stored key (168 characters)\n');
   assert.equal(result.stderr,'');
   assert.equal(fs.readFileSync(path.join(state,'security-count'),'utf8'),'8\n');
   assert.equal(fs.readFileSync(path.join(state,'security-lengths'),'utf8'),'20\n2\n2\n31\n2\n9\n2\n168\n');
   assert.equal(fs.readFileSync(path.join(state,'clipboard-cleared'),'utf8').trim(),'0');
  } else {
   assert.notEqual(result.code,0);
   assert.equal(result.stdout,'');
   assert.match(result.stderr,/must start with.*sk-.*at least 40 characters/i);
   assert.equal(fs.existsSync(path.join(state,'security-count')),false);
   assert.equal(fs.existsSync(path.join(state,'clipboard-cleared')),false);
  }
 });
}
function setup(t) {
 const state=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-scripts-'));
 t.after(()=>fs.rmSync(state,{recursive:true,force:true}));
 return {state,env:{...process.env,BRIDGE_STATE_DIR:state,BRIDGE_TUNNEL_BIN:'/usr/bin/true'}};
}
test('dry run prints unix-socket command without accessing keychain or launching',async t=>{
 const {state,env}=setup(t);
 fs.writeFileSync(path.join(state,'tunnel-id'),'tunnel_abc123\n');
 // A forbidden executable ensures an accidental Keychain call fails the test.
 fs.writeFileSync(path.join(state,'security'),'#!/bin/bash\ntouch "$BRIDGE_STATE_DIR/keychain-called"\nexit 99\n',{mode:0o700});
 env.PATH=state+path.delimiter+process.env.PATH;
 const {stdout}=await run('bash',[path.join(scripts,'start-bridge.sh'),'--dry-run'],{env});
 assert.match(stdout,/<from-keychain>/);
 assert.match(stdout,/--control-plane\.tunnel-id tunnel_abc123/);
 assert.match(stdout,/--health\.unix-socket/);
 assert.match(stdout,/--mcp\.command/);
 assert.equal(fs.existsSync(path.join(state,'keychain-called')),false);
 assert.equal(fs.existsSync(path.join(state,'tunnel.pid')),false);
});
test('stop terminates only the recorded process and is idempotent',async t=>{
 const {state,env}=setup(t);
 const child=spawn('/bin/sleep',['60']);
 const survivor=spawn('/bin/sleep',['60']);
 t.after(()=>{child.kill('SIGKILL');survivor.kill('SIGKILL');});
 const exited=new Promise(resolve=>child.once('exit',resolve));
 fs.writeFileSync(path.join(state,'tunnel.pid'),String(child.pid));
 await run('bash',[path.join(scripts,'stop-bridge.sh')],{env});
 await exited;
 assert.equal(fs.existsSync(path.join(state,'tunnel.pid')),false);
 assert.doesNotThrow(()=>process.kill(survivor.pid,0));
 await run('bash',[path.join(scripts,'stop-bridge.sh')],{env});
});
