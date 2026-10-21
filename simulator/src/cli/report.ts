import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadReport, writeReport } from '../report/files.js';
export function reportMain(args: string[]): void {
  let edge: string | undefined, out: string | undefined, v32='out/v32';
  const mc: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i], value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--edge') edge = value;
    else if (flag === '--mc') mc.push(value);
    else if (flag === '--v32') v32=value;
    else if (flag === '--out') out = value;
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (!edge || !out || !mc.length) throw new Error('Usage: npm run report -- --edge out/edge --mc out/mc/name [--mc out/mc/other] --out out/report');
  writeReport(loadReport(resolve(edge), mc.map(directory => resolve(directory)), resolve('README.md'),resolve(v32)), resolve(out));
  process.stdout.write(`${resolve(out, 'report.html')}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { reportMain(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
