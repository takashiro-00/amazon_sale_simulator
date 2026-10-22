import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createReporting, credentials, safe, dateValid } from './core.mjs';

const server=new McpServer({name:'amazon-reports',version:'1.0.0'});
const app=createReporting();
const schema={date:z.string().refine(dateValid,'Expected a valid YYYY-MM-DD date').optional(),reportId:z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),refresh:z.boolean().optional()};
for(const [name,method,description] of [
  ['get_daily_ads_report','ads','Read AussieGifty US Sponsored Products daily campaign metrics. Defaults to yesterday in the Ads profile timezone.'],
  ['get_daily_sales_report','sales','Read AussieGifty US Sales and Traffic daily metrics. Defaults to yesterday in America/Los_Angeles.'],
])server.registerTool(name,{description,inputSchema:schema,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:true}},async args=>{
  try{return {content:[{type:'text',text:safe(JSON.stringify(await app[method](args),null,2))}]};}
  catch(e){return {isError:true,content:[{type:'text',text:safe(e.message)}]};}
});
try {await credentials();await server.connect(new StdioServerTransport());}
catch(e){console.error(safe(e.message));process.exitCode=1;}
