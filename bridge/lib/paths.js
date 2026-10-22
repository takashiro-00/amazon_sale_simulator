import fs from 'node:fs';
import path from 'node:path';
export function inside(root,target) { const rel=path.relative(root,target); return rel==='' || (!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)); }
function deny(config,target,mode) {
 if(inside(config.stateDir,target)) throw new Error('Path denied: bridge state directory');
 const parts=path.relative(config.projectRoot,target).split(path.sep).map(p=>p.toLowerCase());
 for(let i=0;i<parts.length;i++) {
  const p=parts[i];
  if(['.git','.npmrc','.netrc','.pypirc','.aws','.ssh','.gnupg','.codex','auth.json'].includes(p)) throw new Error('Path denied: protected configuration');
  if(p==='.env'||(p.startsWith('.env.')&&!['.env.example','.env.sample'].includes(p))) throw new Error('Path denied: environment file');
  if(/\.(pem|key|p12|pfx|keystore|jks)$/.test(p)||/^id_(rsa|ecdsa|ed25519)/.test(p)) throw new Error('Path denied: private key');
  if(/credential|secret|token/.test(p)) throw new Error('Path denied: sensitive basename');
  if(p==='.docker'&&parts[i+1]==='config.json') throw new Error('Path denied: Docker configuration');
  if(p==='node_modules'&&mode!=='read') throw new Error('Path denied: node_modules');
  if(mode==='write'&&(['bridge','.claude'].includes(p)||p==='claude.md')) throw new Error('Path denied: bridge or Claude control files');
 }
}
export function resolvePath(config,input,{mode='read'}={}) {
 if(typeof input!=='string'||input.length===0||input.includes('\0')) throw new Error('Invalid path: empty or NUL');
 const lexical=path.resolve(config.projectRoot,input);
 if(!inside(config.projectRoot,lexical)) throw new Error('Path denied: outside project root');
 deny(config,lexical,mode);
 let ancestor=lexical; const suffix=[];
 while(true) {
  try { fs.lstatSync(ancestor); break; } catch(e) {
   if(e.code!=='ENOENT') throw e;
   suffix.unshift(path.basename(ancestor)); const parent=path.dirname(ancestor); if(parent===ancestor) throw e; ancestor=parent;
  }
 }
 const real=path.join(fs.realpathSync(ancestor),...suffix);
 if(!inside(config.projectRoot,real)) throw new Error('Path denied: symlink outside project root');
 deny(config,real,mode);
 return real;
}
