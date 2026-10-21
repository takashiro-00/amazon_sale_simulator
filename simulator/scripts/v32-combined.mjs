import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const { selected } = JSON.parse(await readFile('out/v32/verdicts.json', 'utf8'));
if (!selected.length)
    throw new Error('NO_WINNING_PROPOSAL');
const commands = [];
for (const [name, scenario] of [['marginal', 'marginal-account'], ['full', 'full-account'], ['storm', 'edge/attribution-storm-account'], ['premature-population', 'edge/premature-population']]) {
    const args = ['dist/src/cli/mc.js', `scenarios/${scenario}.json`, '--seeds', '100', '--workers', 'auto', '--out', `out/v32/combined-${name}`, '--variant', 'v32-combined', ...selected];
    commands.push([process.execPath, ...args]);
    await new Promise((resolve, reject) => { const p = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'] }); p.once('error', reject); p.once('exit', code => code === 0 ? resolve() : reject(new Error(`COMBINED_EXIT:${code}`))); });
    console.log(`combined ${name} complete`);
}
await writeFile('out/v32/combined-commands.json', JSON.stringify(commands, null, 2) + '\n');
