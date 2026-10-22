import fs from 'node:fs';
import { spawn } from 'node:child_process';
const [mode,heartbeat]=process.argv.slice(2);
if(mode==='grandchild') {
 process.on('SIGTERM',()=>{});
 setInterval(()=>fs.appendFileSync(heartbeat,'.'),25);
} else if(mode==='tree') {
 spawn(process.execPath,[process.argv[1],'grandchild',heartbeat],{stdio:'ignore'});
 setInterval(()=>{},1000);
} else {
 console.log('x'.repeat(21000));
 console.log(Object.keys(process.env).some(n=>n==='CONTROL_PLANE_API_KEY'||n.startsWith('OPENAI_')||n.startsWith('TUNNEL_'))?'bad-env':'clean-env');
 console.log('token sensitive');console.error('Authorization sensitive');
 process.exitCode=mode==='fail'?7:0;
}
