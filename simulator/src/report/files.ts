import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { renderReport, type EdgeResult, type ReportInput } from './render.js';
/** Preserve the original findings as source text, without external links or rendering embedded markup. */
export function extractFindings(readme: string): string {
  const sections = readme.split(/(?=^#{2,3}\s)/m);
  return sections.filter(section => /^#{2,3}\s.*(?:Phát hiện|phát hiện)/.test(section)).join('\n').trim();
}
export function loadReport(edgeDirectory: string, mcDirectories: string[], readmePath?: string, v32Directory?: string): ReportInput {
  const edges = readdirSync(edgeDirectory).filter(file => file.endsWith('.json')).sort().map(file => JSON.parse(readFileSync(resolve(edgeDirectory, file), 'utf8')) as EdgeResult);
  const monteCarlo = mcDirectories.map(directory => ({ name: basename(resolve(directory)), summary: JSON.parse(readFileSync(resolve(directory, 'summary.json'), 'utf8')) as Record<string, unknown>, runs: readFileSync(resolve(directory, 'runs.jsonl'), 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as Record<string, unknown>) }));
  const v32=v32Directory&&existsSync(v32Directory)?{
    experiments:readdirSync(v32Directory,{withFileTypes:true}).filter(d=>d.isDirectory()&&existsSync(resolve(v32Directory,d.name,'summary.json'))).sort((a,b)=>a.name.localeCompare(b.name)).map(d=>({name:d.name,summary:JSON.parse(readFileSync(resolve(v32Directory,d.name,'summary.json'),'utf8'))})),
    edges:existsSync(resolve(v32Directory,'edge'))?readdirSync(resolve(v32Directory,'edge')).filter(f=>f.endsWith('.json')&&f!=='duration.json').sort().map(f=>JSON.parse(readFileSync(resolve(v32Directory,'edge',f),'utf8'))):[],
    ...(existsSync(resolve('docs/simulator/v3.2-results.md'))?{results:readFileSync(resolve('docs/simulator/v3.2-results.md'),'utf8')}:{})
  }:undefined;
  return { edges, monteCarlo, ...(v32?{v32}:{}), ...(readmePath ? { findings: extractFindings(readFileSync(readmePath, 'utf8')) } : {}) };
}
export function writeReport(input: ReportInput, directory: string): void {
  const report = renderReport(input);
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'report.html'), report.html);
  writeFileSync(resolve(directory, 'report.md'), report.markdown);
}
