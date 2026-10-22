import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const load = () => import('../core.mjs');
test('allowlist rejects writes and unknown paths before network', async () => {
  const { amazonRequest } = await load();
  for (const [api, method, path] of [['ads','PUT','/sp/campaigns'],['ads','POST','/v2/profiles'],['sp','DELETE','/reports/2021-06-30/reports/x'],['ads','GET','/unknown'],['ads','GET','/v2/profiles/../campaigns'],['lwa','POST','/auth/o2/token']]) {
    await assert.rejects(amazonRequest(api,method,path), /allowlist|refresh/i);
  }
});
test('DST and zero-divisor metrics', async () => {
  const { dayBounds, adsSummary } = await load();
  assert.match(dayBounds('2026-07-04').start, /-07:00$/);
  assert.match(dayBounds('2026-01-04').start, /-08:00$/);
  const a = adsSummary([{cost:10,sales7d:40,impressions:100,clicks:5}]);
  assert.equal(a.totals.ACoS,25); assert.equal(a.totals.ROAS,4);
  assert.equal(adsSummary([{cost:0,sales7d:0}]).totals.ACoS,null);
  assert.equal(adsSummary([{cost:0,sales7d:0}]).totals.ROAS,null);
});
test('setup merge preserves unrelated lines and permissions', async () => {
  const { mergeCredentials } = await import('../setup.mjs');
  const dir = await mkdtemp(join(tmpdir(),'reports-')); const path = join(dir,'.env');
  await mergeCredentials(path,{OTHER:'keep',SP_API_CLIENT_SECRET:'hidden'});
  await mergeCredentials(path,{AMAZON_ADS_REGION:'NA'});
  assert.match(await readFile(path,'utf8'), /OTHER=keep/);
  assert.equal((await stat(path)).mode & 0o777,0o600);
});
test('mock Amazon flows: duplicate, gzip, cache, resume, fatal, forbidden and redaction', async () => {
  const dir = await mkdtemp(join(tmpdir(),'amazon-flow-'));
  let base, scenario='ads', posts=0, polls=0, tokens=0; const requests=[];
  const server=createServer(async(req,res)=>{
    let raw=''; for await(const chunk of req) raw+=chunk;
    requests.push({path:req.url,headers:req.headers,body:raw});
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(req.url==='/auth/o2/token'){tokens++;return send(200,{access_token:'ACCESS_SECRET',expires_in:3600});}
    if(req.url==='/v2/profiles/p')return send(200,{timezone:'America/Los_Angeles'});
    if(req.url==='/reporting/reports' && req.method==='POST'){posts++;return send(425,{detail:'The report already exists: reportId: duplicate-123'});}
    if(req.url==='/reporting/reports/duplicate-123'){polls++;return send(200,scenario==='pending'?{status:'PROCESSING'}:{status:'COMPLETED',url:base+'/download'});}
    if(req.url==='/reports/2021-06-30/reports' && req.method==='POST'){posts++;if(scenario==='403')return send(403,{message:'ACCESS_SECRET client-secret refresh-secret'});return send(202,{reportId:'sales1'});}
    if(req.url==='/reports/2021-06-30/reports/sales1')return send(200,{processingStatus:scenario==='fatal'?'FATAL':'DONE',reportDocumentId:'doc1'});
    if(req.url==='/reports/2021-06-30/documents/doc1')return send(200,{url:base+'/download',compressionAlgorithm:'GZIP'});
    if(req.url==='/download'){
      assert.equal(req.headers.authorization,undefined);assert.equal(req.headers['x-amz-access-token'],undefined);
      res.end(gzipSync(JSON.stringify(scenario==='fatal'?{error:'bad ACCESS_SECRET refresh-secret'}:scenario==='sales'?{salesAndTrafficByDate:[{date:'2026-07-04',salesByDate:{orderedProductSales:{amount:12,currencyCode:'USD'},unitsOrdered:2,totalOrderItems:1},trafficByDate:{pageViews:10,sessions:5,buyBoxPercentage:99,unitSessionPercentage:40}}],salesAndTrafficByAsin:[{parentAsin:'ABC',salesByAsin:{orderedProductSales:{amount:12,currencyCode:'USD'}}}]}:[{campaignId:'c',campaignName:'test',cost:10,sales7d:40,impressions:100,clicks:5}])));return;
    }
    send(404,{});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {
    base=`http://127.0.0.1:${server.address().port}`;
    Object.assign(process.env,{ADS_API_BASE:base,SP_API_BASE:base,LWA_TOKEN_URL:base+'/auth/o2/token',AMAZON_ENV_PATH:join(dir,'missing')});
    const { createReporting }=await load();
    const values={AMAZON_ADS_CLIENT_ID:'id',AMAZON_ADS_CLIENT_SECRET:'client-secret',AMAZON_ADS_REFRESH_TOKEN:'refresh-secret',AMAZON_ADS_PROFILE_ID:'p',SP_API_CLIENT_ID:'sp',SP_API_CLIENT_SECRET:'client-secret',SP_API_REFRESH_TOKEN:'refresh-secret'};
    const app=createReporting({values,dataDir:dir,pollMs:1,maxPollMs:3});
    const ads=await app.ads({date:'2026-07-04'});assert.equal(ads.totals.ROAS,4);assert.equal(posts,1);
    await app.ads({date:'2026-07-04'});assert.equal(posts,1);
    scenario='pending';const pending=await app.ads({date:'2026-07-05'});assert.equal(pending.reportId,'duplicate-123');
    scenario='ads';assert.equal((await app.ads({date:'2026-07-05',reportId:pending.reportId})).totals.spend,10);
    scenario='sales';const sales=await app.sales({date:'2026-07-04'});assert.equal(sales.unitsOrdered,2);assert.equal(sales.topParentAsins[0].parentAsin,'ABC');
    assert.match(requests.find(x=>x.path==='/reports/2021-06-30/reports'&&x.body).body,/-07:00/);
    scenario='fatal';await assert.rejects(app.sales({date:'2026-01-04'}),e=>/FATAL/.test(e.message)&&!e.message.includes('ACCESS_SECRET')&&!e.message.includes('refresh-secret'));
    scenario='403';await assert.rejects(app.sales({date:'2026-01-05'}),/likely lacks.*role/i);
    assert.equal(tokens,2);
    assert.equal((await stat(join(dir,'2026-07-04-ads.json'))).mode&0o777,0o600);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
