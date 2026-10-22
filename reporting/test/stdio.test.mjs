import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const server=fileURLToPath(new URL('../server.mjs',import.meta.url));
const missing=join(tmpdir(),`absent-amazon-${process.pid}`);
const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(AMAZON_ADS_|SP_API_)/.test(k)));
test('MCP lists exactly two read-only tools and errors do not leak secrets to output or stderr',async()=>{
  const env={...cleanEnv,AMAZON_ENV_PATH:missing,AMAZON_ADS_CLIENT_SECRET:'PRIVATE_SECRET',AMAZON_ADS_REFRESH_TOKEN:'PRIVATE_REFRESH'};
  const transport=new StdioClientTransport({command:process.execPath,args:[server],env,stderr:'pipe'});
  let stderr='';transport.stderr?.on('data',chunk=>stderr+=chunk);
  const client=new Client({name:'test',version:'1'});
  try{
    await client.connect(transport);
    const {tools}=await client.listTools();
    assert.deepEqual(tools.map(t=>t.name).sort(),['get_daily_ads_report','get_daily_sales_report']);
    assert.ok(tools.every(t=>t.annotations.readOnlyHint));
    const result=await client.callTool({name:'get_daily_ads_report',arguments:{date:'2026-07-04',refresh:true}});
    assert.equal(result.isError,true);assert.doesNotMatch(JSON.stringify(result)+stderr,/PRIVATE_SECRET|PRIVATE_REFRESH/);
  }finally{await client.close();}
});
test('setup check independently reports both missing configurations and exits nonzero',async()=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('../setup.mjs',import.meta.url)),'check'],{env:{...cleanEnv,AMAZON_ENV_PATH:missing}});
  let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  assert.equal(code,1);assert.match(out,/Ads: not configured/);assert.match(out,/SP-API: not configured/);assert.equal(err,'');
});

test('SP setup accepts environment credentials, preserves other keys and writes mode 600',async()=>{
  const { mkdtemp, writeFile, readFile, stat }=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'sp-setup-')),path=join(dir,'.env.amazon');
  await writeFile(path,'# preserve this comment\nUNRELATED=value\nAMAZON_ADS_PROFILE_ID=123\n');
  const child=spawn(process.execPath,[fileURLToPath(new URL('../setup.mjs',import.meta.url)),'sp'],{env:{...cleanEnv,AMAZON_ENV_PATH:path,SP_API_CLIENT_ID:'client',SP_API_CLIENT_SECRET:'SETUP_PRIVATE_SECRET',SP_API_REFRESH_TOKEN:'SETUP_PRIVATE_REFRESH'}});
  let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  assert.equal(code,0);assert.doesNotMatch(output,/SETUP_PRIVATE/);
  const contents=await readFile(path,'utf8');assert.match(contents,/# preserve this comment\nUNRELATED=value\nAMAZON_ADS_PROFILE_ID=123/);assert.match(contents,/SP_API_MARKETPLACE_ID=ATVPDKIKX0DER/);assert.match(contents,/SP_API_REGION=NA/);assert.equal((await stat(path)).mode&0o777,0o600);
});
