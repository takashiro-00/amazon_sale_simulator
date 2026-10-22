import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createReporting, amazonRequest, safe, dayBounds } from '../core.mjs';

test('report parsing and transitions with an in-process HTTP transport double', async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  const dir=await mkdtemp(join(tmpdir(),'transport-reports-'));
  const values={AMAZON_ADS_CLIENT_ID:'ads',AMAZON_ADS_CLIENT_SECRET:'client-secret-long',AMAZON_ADS_REFRESH_TOKEN:'refresh-secret-long',AMAZON_ADS_PROFILE_ID:'p',SP_API_CLIENT_ID:'sp',SP_API_CLIENT_SECRET:'sp-secret-long',SP_API_REFRESH_TOKEN:'sp-refresh-long'};
  let scenario='ads',posts=0,tokenCalls=0,retries=0;const bodies=[];
  const reply=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers});
  globalThis.fetch=async(url,init)=>{
    const path=new URL(url).pathname;
    if(path==='/auth/o2/token'){tokenCalls++;assert.equal(new URLSearchParams(init.body).get('grant_type'),'refresh_token');return reply({access_token:'token-secret-long',expires_in:3600});}
    if(path==='/reporting/reports'&&init.method==='POST'){
      posts++;const body=JSON.parse(init.body);assert.equal(body.configuration.reportTypeId,'spCampaigns');assert.equal(body.configuration.adProduct,'SPONSORED_PRODUCTS');assert.equal(body.startDate,body.endDate);assert.equal(init.headers['Content-Type'],'application/vnd.createasyncreportrequest.v3+json');return reply({detail:'The report with identifier: duplicate-123 was already requested.'},425);
    }
    if(path==='/reporting/reports/duplicate-123')return reply(scenario==='pending'?{status:'PROCESSING'}:{status:'COMPLETED',url:'https://documents.example/report'});
    if(path==='/reports/2021-06-30/reports'&&init.method==='POST'){
      posts++;bodies.push(JSON.parse(init.body));assert.equal(init.headers['x-amz-access-token'],'token-secret-long');if(scenario==='403')return reply({message:'token-secret-long'},403);return reply({reportId:'sales1'},202);
    }
    if(path==='/reports/2021-06-30/reports/sales1')return reply({processingStatus:scenario==='fatal'?'FATAL':scenario==='cancel'?'CANCELLED':'DONE',reportDocumentId:'doc1'});
    if(path==='/reports/2021-06-30/documents/doc1')return reply({url:'https://documents.example/report',compressionAlgorithm:'GZIP'});
    if(path==='/report'){
      assert.deepEqual(init.headers,{});assert.equal(init.redirect,'error');
      const data=scenario==='fatal'?'generation failed token-secret-long client-secret-long refresh-secret-long':JSON.stringify(scenario==='sales'?{salesAndTrafficByDate:[{date:'2026-07-04',salesByDate:{orderedProductSales:{amount:27.5,currencyCode:'USD'},unitsOrdered:3,totalOrderItems:2},trafficByDate:{pageViews:30,sessions:10,buyBoxPercentage:97.123,unitSessionPercentage:30}}],salesAndTrafficByAsin:[{parentAsin:'LOW',salesByAsin:{orderedProductSales:{amount:5,currencyCode:'USD'}}},{parentAsin:'HIGH',salesByAsin:{orderedProductSales:{amount:22.5,currencyCode:'USD'}}}]}:[{campaignId:'low',cost:3,sales7d:0,impressions:100,clicks:2},{campaignId:'high',cost:7,sales7d:40,impressions:100,clicks:3,purchases7d:2,unitsSoldClicks7d:3}]);
      return new Response(gzipSync(data));
    }
    if(path==='/v2/profiles'){retries++;return retries<4?reply({},retries===1?429:503,{'Retry-After':'0'}):reply([]);}
    throw new Error('Unexpected request');
  };
  const app=createReporting({values,dataDir:dir,pollMs:1,maxPollMs:2});
  const ads=await app.ads({date:'2026-07-04'});
  assert.equal(ads.totals.ACoS,25);assert.equal(ads.totals.ROAS,4);assert.equal(ads.totals.CTR,2.5);assert.equal(ads.totals.CPC,2);assert.equal(ads.campaigns[0].campaignId,'high');assert.equal(ads.campaigns[1].ACoS,null);
  await app.ads({date:'2026-07-04'});assert.equal(posts,1);
  await app.ads({date:'2026-07-04',refresh:true});assert.equal(posts,2);
  scenario='pending';const pending=await app.ads({date:'2026-07-05'});assert.equal(pending.reportId,'duplicate-123');const beforeResume=posts;
  scenario='ads';await app.ads({date:'2026-07-05',reportId:pending.reportId});assert.equal(posts,beforeResume);
  scenario='sales';const sales=await app.sales({date:'2026-07-04'});assert.equal(sales.orderedProductSales.amount,27.5);assert.equal(sales.topParentAsins[0].parentAsin,'HIGH');assert.equal(sales.buyBoxPercentage,97.12);
  assert.equal(bodies[0].dataStartTime,'2026-07-04T00:00:00-07:00');assert.equal(bodies[0].dataEndTime,'2026-07-04T23:59:59-07:00');assert.deepEqual(bodies[0].marketplaceIds,['ATVPDKIKX0DER']);
  scenario='fatal';await assert.rejects(app.sales({date:'2026-01-04'}),e=>/FATAL.*generation failed/.test(e.message)&&!e.message.includes('secret-long'));
  assert.equal(bodies[1].dataStartTime,'2026-01-04T00:00:00-08:00');
  scenario='cancel';await assert.rejects(app.sales({date:'2026-01-05'}),/CANCELLED/);
  scenario='403';await assert.rejects(app.sales({date:'2026-01-06'}),/likely lacks.*role/);
  assert.equal(tokenCalls,2);
  await amazonRequest('ads','GET','/v2/profiles');assert.equal(retries,4);
  assert.doesNotMatch(safe('client-secret-long token-secret-long refresh-secret-long'),/secret-long/);
  assert.equal(JSON.parse(await readFile(join(dir,'2026-07-04-sales.json'),'utf8')).unitsOrdered,3);
  await assert.rejects(amazonRequest('download','GET','http://example.com/report'),/allowlist/);
  assert.equal(dayBounds('2026-03-08').start,'2026-03-08T00:00:00-08:00');
  assert.equal(dayBounds('2026-03-08').end,'2026-03-08T23:59:59-07:00');
  assert.equal(dayBounds('2026-11-01').start,'2026-11-01T00:00:00-07:00');
  assert.equal(dayBounds('2026-11-01').end,'2026-11-01T23:59:59-08:00');
});
