import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { prompt, waitForCode, buildAuthorizeUrl, pickUsProfiles, token as authorizationToken, sensitive } from '../scripts/ads-auth.mjs';
import { credentials, envPath, atomicWrite, safe, remember, createReporting, amazonRequest } from './core.mjs';

export async function mergeCredentials(path,updates) {
  let text='';try{text=await readFile(path,'utf8');}catch(e){if(e.code!=='ENOENT')throw new Error('Cannot read credential file.');}
  for(const [key,value] of Object.entries(updates))if(!/^[A-Z][A-Z0-9_]*$/.test(key)||/[\r\n\0]/.test(String(value))||String(value)!==String(value).trim())throw new Error('Invalid credential file value.');
  const remaining=new Set(Object.keys(updates));
  const lines=text.split(/\r?\n/).map(line=>{const key=line.slice(0,line.indexOf('=')).trim();if(Object.hasOwn(updates,key)){remaining.delete(key);return `${key}=${updates[key]}`;}return line;});
  for(const key of remaining)lines.push(`${key}=${updates[key]}`);
  await atomicWrite(path,lines.join('\n').replace(/\n*$/,'\n'));
}
async function ask(key,hidden=false) {
  const value=(process.env[key]??await prompt(`${key}: `,hidden)).trim();if(!value)throw new Error(`${key} must not be empty.`);
  if(hidden){remember(value);sensitive.add(value);}return value;
}
export async function main(command=process.argv[2]) {
  if(command==='sp'){
    const v={};for(const key of ['SP_API_CLIENT_ID','SP_API_CLIENT_SECRET','SP_API_REFRESH_TOKEN'])v[key]=await ask(key,key!=='SP_API_CLIENT_ID');
    Object.assign(v,{SP_API_MARKETPLACE_ID:process.env.SP_API_MARKETPLACE_ID||'ATVPDKIKX0DER',SP_API_REGION:'NA'});
    await mergeCredentials(envPath(),v);console.log('SP-API credentials saved.');return;
  }
  if(command==='ads'){
    const v={AMAZON_ADS_CLIENT_ID:await ask('AMAZON_ADS_CLIENT_ID'),AMAZON_ADS_CLIENT_SECRET:await ask('AMAZON_ADS_CLIENT_SECRET',true)};
    const state=randomBytes(32).toString('hex'),redirect='http://localhost:3000/callback';
    const code=await waitForCode(3000,state,buildAuthorizeUrl(v.AMAZON_ADS_CLIENT_ID,redirect,state));remember(code);sensitive.add(code);
    // Bootstrap authorization is isolated in the existing interactive auth CLI helper.
    // Reporting's LWA allowlist continues to accept refresh_token only.
    process.env.ADS_AUTH_TOKEN_URL=process.env.LWA_TOKEN_URL||'https://api.amazon.com/auth/o2/token';
    const data=await authorizationToken({grant_type:'authorization_code',code,redirect_uri:redirect,client_id:v.AMAZON_ADS_CLIENT_ID,client_secret:v.AMAZON_ADS_CLIENT_SECRET});
    remember(data.access_token,data.refresh_token);if(!data.refresh_token)throw new Error('Token response is missing a refresh token.');
    const response=await amazonRequest('ads','GET','/v2/profiles',{headers:{Authorization:`Bearer ${data.access_token}`,'Amazon-Advertising-API-ClientId':v.AMAZON_ADS_CLIENT_ID}});
    if(!response.ok)throw new Error(`Profiles endpoint HTTP ${response.status}.`);
    const profiles=await response.json();if(!Array.isArray(profiles))throw new Error('Invalid profiles response.');
    const us=pickUsProfiles(profiles);if(!us.length)throw new Error('No US profiles found.');let selected=us[0];
    if(process.env.AMAZON_ADS_PROFILE_ID){selected=us.find(p=>String(p.profileId)===process.env.AMAZON_ADS_PROFILE_ID);if(!selected)throw new Error('Configured profile is not a US profile.');}
    else if(us.length>1){us.forEach((p,i)=>console.log(safe(`${i+1}. ${p.profileId} | ${p.accountInfo?.name}`)));for(;;){const answer=await prompt('Choose a US profile number: ');if(/^\d+$/.test(answer)&&us[Number(answer)-1]){selected=us[Number(answer)-1];break;}}}
    Object.assign(v,{AMAZON_ADS_REFRESH_TOKEN:data.refresh_token,AMAZON_ADS_PROFILE_ID:String(selected.profileId),AMAZON_ADS_REGION:'NA'});
    await mergeCredentials(envPath(),v);console.log('Ads credentials saved.');return;
  }
  if(command==='check'){
    const v=await credentials(),app=createReporting({values:v});let failed=false;
    for(const api of ['ads','sp']){
      const prefix=api==='ads'?'AMAZON_ADS':'SP_API',required=['CLIENT_ID','CLIENT_SECRET','REFRESH_TOKEN',...(api==='ads'?['PROFILE_ID']:[])];
      if(required.some(k=>!v[`${prefix}_${k}`])){console.log(`${api==='ads'?'Ads':'SP-API'}: not configured`);failed=true;continue;}
      try{
        if(api==='ads'){const p=await app.request('ads','GET',`/v2/profiles/${v.AMAZON_ADS_PROFILE_ID}`);console.log(safe(`Ads: HTTP 200; name=${p.accountInfo?.name}; countryCode=${p.countryCode}; timezone=${p.timezone}`));}
        else{const p=await app.request('sp','GET','/sellers/v1/marketplaceParticipations');console.log(`SP-API: HTTP 200; ATVPDKIKX0DER present: ${Boolean(p.payload?.some(x=>x.marketplace?.id==='ATVPDKIKX0DER'))}`);}
      }catch(e){failed=true;console.error(safe(`${api}: ${e.message}`));}
    }
    if(failed)process.exitCode=1;return;
  }
  throw new Error('Usage: node reporting/setup.mjs <ads|sp|check>');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(safe(e.message));process.exitCode=1;});
