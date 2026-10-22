#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('fake-claude 1.0'); process.exit(0); }
if (args[0] === 'auth') { console.log(JSON.stringify({loggedIn:true,authMethod:'fake',apiKey:'must never return'})); process.exit(0); }
let input=''; for await (const chunk of process.stdin) input+=chunk;
fs.appendFileSync(process.env.FAKE_RECORD, JSON.stringify({argv:args,stdin:input,env:Object.keys(process.env)})+'\n');
if (process.env.FAKE_IGNORE_INT) process.on('SIGINT',()=>{});
await new Promise(r=>setTimeout(r,Number(process.env.FAKE_DELAY || 0)));
if (process.env.FAKE_IN_USE && args.includes('--session-id')) { console.error(`Error: Session ID ${args[args.indexOf('--session-id')+1]} is already in use.`); process.exit(1); }
if (process.env.FAKE_FAIL) { console.error('normal failure\nAPI_TOKEN=private\nlast error'); process.exit(2); }
if (process.env.FAKE_BAD_JSON) { console.log('bad json'); process.exit(0); }
if (process.env.FAKE_NULL) { console.log('null'); process.exit(0); }
const id=args[args.indexOf(args.includes('--session-id')?'--session-id':'--resume')+1];
console.log(JSON.stringify({result: process.env.FAKE_RESPONSE || 'fake response',session_id:process.env.FAKE_WRONG_ID?'wrong':id,is_error:!!process.env.FAKE_IS_ERROR,total_cost_usd:0.01}));
