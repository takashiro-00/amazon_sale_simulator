import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolvePath } from './paths.js';
const MiB=1048576;
function integer(n,fallback,min,max) { n??=fallback; if(!Number.isInteger(n)||n<min||n>max) throw new Error('Invalid numeric limit'); return n; }
function textFile(target) {
 const fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try {
  const stat=fs.fstatSync(fd); if(!stat.isFile()) throw new Error('Path is not a regular file');
  if(stat.size>MiB) throw new Error('File exceeds 1 MiB');
  const buffer=fs.readFileSync(fd); if(buffer.length>MiB) throw new Error('File exceeds 1 MiB');
  if(buffer.subarray(0,8192).includes(0)) throw new Error('Binary file rejected');
  return buffer.toString('utf8');
 } finally { fs.closeSync(fd); }
}
function atomicWrite(config,input,content,createDirs=false) {
 if(typeof content!=='string'||Buffer.byteLength(content)>2*MiB) throw new Error('Content exceeds 2 MiB or is not text');
 let target=resolvePath(config,input,{mode:'write'});
 if(createDirs) fs.mkdirSync(path.dirname(target),{recursive:true});
 target=resolvePath(config,input,{mode:'write'});
 if(fs.existsSync(target)&&!fs.statSync(target).isFile()) throw new Error('Path is not a regular file');
 const temp=path.join(path.dirname(target),'.bridge-write-'+randomUUID());
 try {
  fs.writeFileSync(temp,content,{flag:'wx',mode:0o600});
  if(resolvePath(config,input,{mode:'write'})!==target) throw new Error('Path changed during write');
  fs.renameSync(temp,target);
 } finally { try { fs.unlinkSync(temp); } catch(e) { if(e.code!=='ENOENT') throw e; } }
 return {path:path.relative(config.projectRoot,target),bytes:Buffer.byteLength(content)};
}
export function createFiles(config) {
 function walk(input='.',recursive=false,max=2000) {
  const start=resolvePath(config,input,{mode:'list'}); const entries=[]; const seen=new Set();
  function visit(dir) {
   const real=fs.realpathSync(dir); if(seen.has(real)) return; seen.add(real);
   for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if(entries.length>=max) return;
    const raw=path.join(dir,entry.name); let target;
    try { target=resolvePath(config,raw,{mode:'list'}); } catch { continue; }
    let stat; try {stat=fs.statSync(target);} catch {continue;}
    const rel=path.relative(config.projectRoot,raw);
    entries.push({path:rel,type:stat.isDirectory()?'directory':'file'});
    if(recursive&&stat.isDirectory()) visit(raw);
   }
  }
  if(fs.statSync(start).isDirectory()) visit(start); else entries.push({path:path.relative(config.projectRoot,start),type:'file'});
  return entries;
 }
 return {
  list({path:input='.',recursive=false,max_entries=500}={}) {return {entries:walk(input,recursive,integer(max_entries,500,1,2000))};},
  read({path:input,start_line=1,max_lines}={}) {
   const lines=textFile(resolvePath(config,input)).split('\n');
   const start=integer(start_line,1,1,Number.MAX_SAFE_INTEGER); const max=integer(max_lines,lines.length,1,Number.MAX_SAFE_INTEGER);
   return {content:lines.slice(start-1,start-1+max).join('\n'),total_lines:lines.length};
  },
  search({query,path:input='.',max_results=100}={}) {
   if(typeof query!=='string'||!query.length) throw new Error('Query must not be empty');
   const max=integer(max_results,100,1,500); const results=[]; let bytes=0;
   // Stream traversal so a large tree does not consume a tunnel payload or unbounded memory.
   const seen=new Set(); let stopped=false;
   function visit(raw) {
    if(stopped) return; let target,stat;
    try {target=resolvePath(config,raw,{mode:'list'});stat=fs.statSync(target);} catch {return;}
    if(stat.isDirectory()) {
     if(seen.has(target)) return; seen.add(target);
     for(const name of fs.readdirSync(target)) {visit(path.join(raw,name));if(stopped)break;}
    } else if(stat.isFile()) {
     let content; try {content=textFile(target);} catch {return;}
     const lines=content.split('\n');
     for(let i=0;i<lines.length;i++) if(lines[i].includes(query)) {
      const value=`${path.relative(config.projectRoot,raw)}:${i+1}: ${lines[i]}`;
      const size=Buffer.byteLength(JSON.stringify(value)); if(bytes+size>4*MiB) {stopped=true;break;}
      results.push(value); bytes+=size; if(results.length>=max){stopped=true;break;}
     }
    }
   }
   resolvePath(config,input,{mode:'list'}); visit(path.resolve(config.projectRoot,input)); return {results,truncated:stopped};
  },
  write({path:input,content,create_dirs=false}={}) {return atomicWrite(config,input,content,create_dirs);},
  edit({path:input,old_string,new_string,replace_all=false}={}) {
   if(typeof old_string!=='string'||old_string.length===0||typeof new_string!=='string') throw new Error('Edit strings must be text; old_string must not be empty');
   const content=textFile(resolvePath(config,input,{mode:'write'}));
   const pieces=content.split(old_string); if(pieces.length===1) throw new Error('Exact string not found');
   if(pieces.length>2&&!replace_all) throw new Error('Exact string found more than once');
   return atomicWrite(config,input,pieces.join(new_string));
  }
 };
}
