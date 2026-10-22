import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parseEnvFile } from '../scripts/ads-auth.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const envPath = () => process.env.AMAZON_ENV_PATH || join(root, '.env.amazon');
const secrets = new Set();
export function remember(...values) { for (const value of values) if (value) secrets.add(String(value)); }
// Same raw, URI-encoded and form-encoded redaction used by ads-auth.mjs.
export function safe(value) {
  let text = String(value ?? '');
  for (const secret of [...secrets].sort((a,b)=>b.length-a.length)) {
    for (const form of [secret, encodeURIComponent(secret), new URLSearchParams({v:secret}).toString().slice(2)]) text = text.split(form).join('[redacted]');
  }
  return text.replace(/[\x00-\x1f\x7f]/g,' ');
}
export async function credentials() {
  let values = {};
  try { values = parseEnvFile(await readFile(envPath(),'utf8')); } catch(e) { if(e.code!=='ENOENT') throw new Error('Cannot read Amazon credential file.'); }
  for (const key of Object.keys(process.env)) if (/^(AMAZON_ADS_|SP_API_)/.test(key)) values[key]=process.env[key];
  for (const [key,value] of Object.entries(values)) if (/SECRET|TOKEN/.test(key)) remember(value);
  return values;
}
export async function atomicJson(path,value) { await atomicWrite(path,JSON.stringify(value,null,2)+'\n'); }
export async function atomicWrite(path,text) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temp=`${path}.${randomBytes(12).toString('hex')}.tmp`;
  await writeFile(temp,text,{mode:0o600,flag:'wx'});
  await rename(temp,path);
}
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
function localOverrides() {
  return ['ADS_API_BASE','SP_API_BASE','LWA_TOKEN_URL'].every(key=>{
    try { const u=new URL(process.env[key]);return u.hostname==='127.0.0.1' && u.protocol==='http:'; } catch { return false; }
  });
}
const rules={ads:[['GET',/^\/v2\/profiles(?:\/[A-Za-z0-9_-]+)?$/],['POST',/^\/reporting\/reports$/],['GET',/^\/reporting\/reports\/[A-Za-z0-9_-]+$/]],sp:[['POST',/^\/reports\/2021-06-30\/reports$/],['GET',/^\/reports\/2021-06-30\/(?:reports|documents)\/[A-Za-z0-9_-]+$/],['GET',/^\/sellers\/v1\/marketplaceParticipations$/]]};
export async function amazonRequest(api,method,path,opts={}) {
  // Validate the un-normalized path: URL normalization must never bypass the allowlist.
  if (api==='lwa') {
    const body=new URLSearchParams(opts.body);
    if(method!=='POST'||path!=='/auth/o2/token'||body.get('grant_type')!=='refresh_token') throw new Error('LWA allowlist permits token refresh only.');
  } else if(api==='download') {
    let u;try{u=new URL(path);}catch{throw new Error('Download URL rejected by allowlist.');}
    if(method!=='GET'||u.username||u.password||!(u.protocol==='https:'||(localOverrides()&&u.protocol==='http:'&&u.hostname==='127.0.0.1'))) throw new Error('Download URL rejected by allowlist.');
  } else if(!rules[api]?.some(([verb,pattern])=>method===verb&&pattern.test(path))) throw new Error('Request rejected by read-only allowlist.');
  const base=api==='ads'?(process.env.ADS_API_BASE||'https://advertising-api.amazon.com'):(process.env.SP_API_BASE||'https://sellingpartnerapi-na.amazon.com');
  const url=api==='download'?path:api==='lwa'?(process.env.LWA_TOKEN_URL||'https://api.amazon.com/auth/o2/token'):base.replace(/\/$/,'')+path;
  const init={method,headers:api==='download'?{}:opts.headers,body:method==='GET'?undefined:opts.body,redirect:'error'};
  for(let attempt=0;;attempt++) {
    let response;
    try {response=await fetch(url,{...init,signal:AbortSignal.timeout(30_000)});} catch {throw new Error('Amazon network request failed or timed out.');}
    if(attempt<3 && (response.status===429||response.status>=500)) {
      const header=response.headers.get('retry-after');
      const delay=header?(Number.isFinite(Number(header))?Number(header)*1000:Math.max(0,Date.parse(header)-Date.now())):500*2**attempt;
      await response.arrayBuffer();await sleep(Number.isFinite(delay)?delay:500*2**attempt);continue;
    }
    return response;
  }
}
async function json(response) {
  let data;try {data=await response.json();}catch{throw new Error(`Invalid Amazon JSON (HTTP ${response.status}).`);}
  for(const key of ['access_token','refresh_token','client_secret','code']) if(typeof data?.[key]==='string')remember(data[key]);
  if(!response.ok){const error=new Error(safe(`Amazon HTTP ${response.status}: ${JSON.stringify(data)}`));error.status=response.status;error.data=data;throw error;}
  return data;
}
export function dateValid(date) {return /^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;}
export function yesterday(zone='America/Los_Angeles') {
  let parts;try{parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());}catch{return yesterday('America/Los_Angeles');}
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return new Date(Date.UTC(+p.year,+p.month-1,+p.day-1)).toISOString().slice(0,10);
}
export function dayBounds(date) {
  if(!dateValid(date))throw new Error('Invalid date; expected YYYY-MM-DD.');
  const offset=hour=>{
    const instant=new Date(`${date}T${hour}:00:00Z`);
    const name=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',timeZoneName:'longOffset'}).formatToParts(instant).find(p=>p.type==='timeZoneName').value;
    return name.replace('GMT','');
  };
  return {start:`${date}T00:00:00${offset('08')}`,end:`${date}T23:59:59${offset('23')}`};
}
const round=n=>Math.round((Number(n)||0)*100)/100;
const ratio=(a,b,scale=1)=>b?round(a/b*scale):null;
export function adsSummary(rows) {
  const metrics=row=>{const impressions=+row.impressions||0,clicks=+row.clicks||0,spend=+row.cost||0,sales7d=+row.sales7d||0;return {impressions,clicks,spend:round(spend),sales7d:round(sales7d),orders7d:round(row.purchases7d),units7d:round(row.unitsSoldClicks7d),CTR:ratio(clicks,impressions,100),CPC:ratio(spend,clicks),ACoS:ratio(spend,sales7d,100),ROAS:ratio(sales7d,spend)};};
  const totals={};for(const row of rows)for(const key of ['impressions','clicks','cost','sales7d','purchases7d','unitsSoldClicks7d'])totals[key]=(totals[key]||0)+(+row[key]||0);
  return {totals:metrics(totals),campaigns:rows.map(r=>({campaignId:r.campaignId,campaignName:r.campaignName,campaignStatus:r.campaignStatus,...metrics(r)})).sort((a,b)=>b.spend-a.spend)};
}
export function createReporting({values,dataDir=join(root,'reporting/data'),pollMs=Number(process.env.AMAZON_REPORT_POLL_MS||15000),maxPollMs=Number(process.env.AMAZON_REPORT_MAX_POLL_MS||240000)}={}) {
  const tokens=new Map();
  const config=async()=>{const v=values||await credentials();for(const [k,val] of Object.entries(v))if(/SECRET|TOKEN/.test(k))remember(val);return v;};
  async function token(api) {
    const v=await config(), prefix=api==='ads'?'AMAZON_ADS':'SP_API';
    for(const suffix of ['CLIENT_ID','CLIENT_SECRET','REFRESH_TOKEN'])if(!v[`${prefix}_${suffix}`])throw new Error(`${api}: not configured`);
    const cached=tokens.get(api);if(cached&&cached.until>Date.now())return cached.value;
    const data=await json(await amazonRequest('lwa','POST','/auth/o2/token',{headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:v[`${prefix}_CLIENT_ID`],client_secret:v[`${prefix}_CLIENT_SECRET`],refresh_token:v[`${prefix}_REFRESH_TOKEN`]})}));
    if(!data.access_token)throw new Error('Token endpoint returned no access token.');
    remember(data.access_token);tokens.set(api,{value:data.access_token,until:Date.now()+(Number(data.expires_in||3600)-60)*1000});return data.access_token;
  }
  async function request(api,method,path,body) {
    const v=await config(),access=await token(api);
    const headers=api==='ads'?{Authorization:`Bearer ${access}`,'Amazon-Advertising-API-ClientId':v.AMAZON_ADS_CLIENT_ID,'Amazon-Advertising-API-Scope':v.AMAZON_ADS_PROFILE_ID}:{'x-amz-access-token':access};
    if(body)headers['Content-Type']=api==='ads'?'application/vnd.createasyncreportrequest.v3+json':'application/json';
    try{return await json(await amazonRequest(api,method,path,{headers,body:body?JSON.stringify(body):undefined}));}catch(e){if(api==='sp'&&e.status===403)throw new Error('SP-API HTTP 403: the app likely lacks the role needed for the Sales and Traffic report.');throw e;}
  }
  async function document(url,compression) {
    const response=await amazonRequest('download','GET',url);if(!response.ok)throw new Error(`Report download HTTP ${response.status}.`);
    const bytes=Buffer.from(await response.arrayBuffer());try{return (compression==='GZIP'?gunzipSync(bytes):bytes).toString('utf8');}catch{throw new Error('Invalid compressed report document.');}
  }
  async function report(kind,args={}) {
    try {
      let date=args.date;
      if(!date){let zone='America/Los_Angeles';if(kind==='ads'){try{const v=await config();zone=(await request('ads','GET',`/v2/profiles/${v.AMAZON_ADS_PROFILE_ID}`)).timezone||zone;}catch{ /* timezone fallback */ }}date=yesterday(zone);}
      if(!dateValid(date))throw new Error('Invalid date; expected YYYY-MM-DD.');
      const path=join(dataDir,`${date}-${kind}.json`);
      if(!args.refresh){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('Cannot read report cache.');}}
      const api=kind==='ads'?'ads':'sp',prefix=kind==='ads'?'/reporting/reports':'/reports/2021-06-30/reports';
      let id=args.reportId;
      if(!id){
        const bounds=kind==='sales'?dayBounds(date):null,v=await config();
        const body=kind==='ads'?{name:`AussieGifty ${date}`,startDate:date,endDate:date,configuration:{adProduct:'SPONSORED_PRODUCTS',groupBy:['campaign'],columns:['date','campaignId','campaignName','campaignStatus','impressions','clicks','cost','sales7d','purchases7d','unitsSoldClicks7d'],reportTypeId:'spCampaigns',timeUnit:'DAILY',format:'GZIP_JSON'}}:{reportType:'GET_SALES_AND_TRAFFIC_REPORT',marketplaceIds:[v.SP_API_MARKETPLACE_ID||'ATVPDKIKX0DER'],dataStartTime:bounds.start,dataEndTime:bounds.end,reportOptions:{dateGranularity:'DAY',asinGranularity:'PARENT'}};
        try{id=(await request(api,'POST',prefix,body)).reportId;}catch(e){
          if(kind!=='ads'||e.status!==425)throw e;
          id=e.data?.reportId||String(e.data?.detail||'').match(/(?:(?:reportId|identifier)[\s:="']+|duplicate(?:\s+of)?\s*:\s*)([A-Za-z0-9_-]+)/i)?.[1];
          if(!id)throw new Error('Duplicate Ads report response did not contain a reportId.');
        }
      }
      if(!id||!/^[A-Za-z0-9_-]+$/.test(id))throw new Error('Invalid reportId.');
      const deadline=Date.now()+Math.min(maxPollMs,240000);let status;
      for(;;){
        status=await request(api,'GET',`${prefix}/${id}`);
        if(kind==='ads'&&status.status==='COMPLETED'||kind==='sales'&&status.processingStatus==='DONE')break;
        if(kind==='ads'&&['FAILURE','FAILED'].includes(status.status))throw new Error(`Ads report FAILURE: ${safe(status.failureReason||'generation failed')}`);
        if(kind==='sales'&&['FATAL','CANCELLED'].includes(status.processingStatus)){
          let detail='';if(status.processingStatus==='FATAL'&&status.reportDocumentId){const doc=await request('sp','GET',`/reports/2021-06-30/documents/${status.reportDocumentId}`);detail=await document(doc.url,doc.compressionAlgorithm);}
          throw new Error(`Sales report ${status.processingStatus}: ${safe(detail)}`);
        }
        if(Date.now()>=deadline)return {reportId:id,date,message:`Report is still processing. Call again with reportId ${id} and date ${date}.`};
        await sleep(Math.min(pollMs,Math.max(0,deadline-Date.now())));
      }
      let result;
      if(kind==='ads'){const rows=JSON.parse(await document(status.url,'GZIP'));if(!Array.isArray(rows))throw new Error('Invalid Ads report rows.');result=adsSummary(rows);}
      else {
        const doc=await request('sp','GET',`/reports/2021-06-30/documents/${status.reportDocumentId}`),data=JSON.parse(await document(doc.url,doc.compressionAlgorithm));
        const row=data.salesAndTrafficByDate?.find(r=>r.date===date);if(!row)throw new Error('Sales report contains no data for the requested date.');
        const s=row.salesByDate||{},t=row.trafficByDate||{};
        result={orderedProductSales:{amount:round(s.orderedProductSales?.amount),currency:s.orderedProductSales?.currencyCode},unitsOrdered:s.unitsOrdered,totalOrderItems:s.totalOrderItems,pageViews:t.pageViews,sessions:t.sessions,buyBoxPercentage:round(t.buyBoxPercentage),unitSessionPercentage:round(t.unitSessionPercentage),topParentAsins:(data.salesAndTrafficByAsin||[]).map(r=>({parentAsin:r.parentAsin,orderedProductSales:{amount:round(r.salesByAsin?.orderedProductSales?.amount),currency:r.salesByAsin?.orderedProductSales?.currencyCode}})).sort((a,b)=>b.orderedProductSales.amount-a.orderedProductSales.amount).slice(0,10)};
      }
      result={date,reportId:id,...result};await atomicJson(path,result);return result;
    }catch(e){throw new Error(safe(e.message));}
  }
  return {ads:args=>report('ads',args),sales:args=>report('sales',args),request,token};
}
