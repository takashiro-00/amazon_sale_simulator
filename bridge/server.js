import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig, VERSION } from './lib/config.js';
import { createFiles } from './lib/files.js';
import { Jobs } from './lib/jobs.js';
import { Checks } from './lib/checks.js';
const config=loadConfig(); const checks=new Checks(config); const files=createFiles(config); const jobs=new Jobs(config);
const server=new McpServer({name:'claude-chatgpt-bridge',version:VERSION});
const inputPath=z.string().min(1).refine(p=>!p.includes('\0'),'NUL is not allowed');
const jobId=z.string().regex(/^job_[a-f0-9]{16}$/);
const handlers=new Map();
function tool(name,description,inputSchema,fn,strict=false) {
 const schema=strict?z.object(inputSchema).strict():z.object(inputSchema);
 const handler=async raw=>{
  try {
   const value=await fn(schema.parse(raw??{}));
   return {content:[{type:'text',text:JSON.stringify(value)}]};
  } catch(error) {
   // Do not echo filesystem paths, subprocess output, or input values in validation errors.
   const message=error instanceof z.ZodError
    ? 'Invalid tool input: '+error.issues.map(i=>i.path.join('.')+': '+i.message).join('; ')
    : error.code?`File operation failed (${error.code})`:error.message;
   return {isError:true,content:[{type:'text',text:JSON.stringify({error:message})}]};
  }
 };
 handlers.set(name,handler);
 server.registerTool(name,{description,inputSchema},handler);
}
tool('bridge_health','Report bridge, Claude binary/auth availability, dedicated session and job counts; never invokes a model.',{},()=>jobs.health());
tool('claude_submit','Submit a message to the dedicated Claude session asynchronously; rejects when busy.',{message:z.string().min(1).max(20000),detail:z.enum(['concise','detailed']).default('concise')},i=>jobs.submit(i));
tool('claude_job_status','Read a job result; optionally wait up to 60 seconds. Responses are limited to 50,000 characters.',{job_id:jobId,wait_seconds:z.number().int().min(0).max(60).default(0)},i=>jobs.status(i));
tool('claude_list_jobs','List recent job metadata and message previews, without response bodies.',{limit:z.number().int().min(1).max(50).default(10)},i=>jobs.list(i));
tool('project_list_files','List allowed project files and directories, hiding protected paths.',{path:inputPath.default('.'),recursive:z.boolean().default(false),max_entries:z.number().int().min(1).max(2000).default(500)},i=>files.list(i));
tool('project_read_file','Read a project text file up to 1 MiB, with optional 1-based line selection.',{path:inputPath,start_line:z.number().int().min(1).optional(),max_lines:z.number().int().min(1).optional()},i=>files.read(i));
tool('project_search','Search project text files for a literal string, skipping protected paths, binaries and files over 1 MiB.',{query:z.string().min(1),path:inputPath.default('.'),max_results:z.number().int().min(1).max(500).default(100)},i=>files.search(i));
tool('project_write_file','Atomically create or overwrite a project file up to 2 MiB, subject to protected path rules.',{path:inputPath,content:z.string().refine(s=>Buffer.byteLength(s)<=2097152,'Content exceeds 2 MiB'),create_dirs:z.boolean().default(false)},i=>files.write(i));
tool('project_edit_file','Atomically replace an exact string in a project text file; ambiguous matches require replace_all.',{path:inputPath,old_string:z.string().min(1),new_string:z.string().max(2097152),replace_all:z.boolean().default(false)},i=>files.edit(i));
tool('project_list_checks','List locally allowlisted checks and their timeouts.',{},()=>checks.list(),true);
tool('project_run_check','Run one named allowlisted check; no custom arguments. Rejects overlapping checks.',{name:z.string().regex(/^[a-z0-9-]+$/)},i=>checks.run(i),true);
// Keep the SDK's tool descriptions/schemas, but make validation failures JSON text.
server.server.setRequestHandler(CallToolRequestSchema,request=>{
 const handler=handlers.get(request.params.name);
 return handler?handler(request.params.arguments):{isError:true,content:[{type:'text',text:JSON.stringify({error:'Unknown tool'})}]};
});
await server.connect(new StdioServerTransport());
