import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const commands=[];
const combined=['v32.r06CalendarGuard=true','v32.r08Daily=true','v32.postHarvestGraceDays=7','v32.hourlyExcludeCapped=true'];
for(const [name,scenario,extra] of [
 ['P1-premature-population','edge/premature-population',[['P2','v32.r06CalendarGuard=true'],['P3','v32.r08Daily=true'],['P4','v32.postHarvestGraceDays=7']]],
 ['storm','edge/attribution-storm-account',[['P3','v32.r08Daily=true']]],
 ['marginal','marginal-account',[['P2','v32.r06CalendarGuard=true']]],
 ['full','full-account',[['P2','v32.r06CalendarGuard=true'],['P4','v32.postHarvestGraceDays=7']]],
]){
 const args=['dist/src/cli/mc.js',`scenarios/${scenario}.json`,'--seeds','100','--workers','auto','--out',`out/v32-truth/${name}`];
 for(const k of [3,5,8])args.push('--variant',`P1-K${k}`,`v32.zeroOrderLagDays=${k}`);
 for(const [id,override] of extra)args.push('--variant',id,override);
 args.push('--variant','v32-combined',...combined);
 commands.push([process.execPath,...args]);
 console.log(`START ${name} ${new Date().toISOString()}`);
 await new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{stdio:['ignore','ignore','inherit']});p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(new Error(`EXIT:${code}`)));});
 console.log(`DONE ${name} ${new Date().toISOString()}`);
 await mkdir('out/v32-truth',{recursive:true});await writeFile('out/v32-truth/commands.json',JSON.stringify(commands,null,2)+'\n');
}
