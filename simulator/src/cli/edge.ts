import {runEdgeSuite} from '../edge/suite.js';
const args=process.argv.slice(2);const out=args[args.indexOf('--out')+1]??'out/edge';
runEdgeSuite(out).then(rows=>{for(const r of rows)console.log(`${r.id}\t${r.status}\t${JSON.stringify(r.metrics)}`);if(rows.some(r=>r.pass===false))process.exitCode=1;}).catch(e=>{console.error(e);process.exitCode=1;});
