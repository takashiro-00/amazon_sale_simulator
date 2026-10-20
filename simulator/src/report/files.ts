import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { renderReport, type EdgeResult, type ReportInput } from './render.js';
/** Preserve the original findings as source text, without external links or rendering embedded markup. */
export function extractFindings(readme: string): string {
  const sections = readme.split(/(?=^#{2,3}\s)/m);
  return sections.filter(section => /^#{2,3}\s.*(?:Phát hiện|phát hiện)/.test(section)).join('\n').trim();
}
export function loadReport(edgeDirectory: string, mcDirectories: string[], readmePath?: string): ReportInput {
  const edges = readdirSync(edgeDirectory).filter(file => file.endsWith('.json')).sort().map(file => JSON.parse(readFileSync(resolve(edgeDirectory, file), 'utf8')) as EdgeResult);
  const monteCarlo = mcDirectories.map(directory => ({ name: basename(resolve(directory)), summary: JSON.parse(readFileSync(resolve(directory, 'summary.json'), 'utf8')) as Record<string, unknown>, runs: readFileSync(resolve(directory, 'runs.jsonl'), 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as Record<string, unknown>) }));
  return { edges, monteCarlo, ...(readmePath ? { findings: extractFindings(readFileSync(readmePath, 'utf8')) } : {}) };
}
export function writeReport(input: ReportInput, directory: string): void {
  const report = renderReport(input);
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'report.html'), report.html);
  writeFileSync(resolve(directory, 'report.md'), report.markdown);
}
