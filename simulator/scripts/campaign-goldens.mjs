// Reproduce the handwritten golden paths without changing the stochastic scenario.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { validateScenario } from '../dist/src/scenario/schema.js';
import { DEFAULT_CONFIG } from '../dist/config/defaults.js';
import { ScriptedMarket } from '../dist/src/market/scripted.js';
import { runCampaignLoop, timelineMarkdown } from '../dist/src/runner/campaignLoop.js';
const scenario = validateScenario(JSON.parse(readFileSync(new URL('../scenarios/golden-winner.json', import.meta.url), 'utf8')));
const win = (day, budget) => ({ clicks: 10, spendUsd: budget, orders: 2, salesUsd: budget / .2 });
const zero = () => ({ clicks: 5, spendUsd: 5, orders: 0, salesUsd: 0 });
const alert = (day, budget) => day < 14 ? win(day, budget) : zero();
const cases = {
 B1: { fn: win }, B2: { fn: zero },
 B3: { days: 55, fn: (day, budget) => day < 13 ? win(day, budget) : ({ clicks: 10, spendUsd: budget, orders: 2, salesUsd: budget / (day < 24 ? .4 : .18) }) },
 B4: { fn: alert }, 'B4-recovery': { fn: (day, budget) => day < 14 || day >= 18 ? win(day, budget) : zero() },
 B5: { fn: (day, budget) => ({ clicks: 10, spendUsd: budget, orders: 2, salesUsd: budget / .7 }) },
 'B5-recovery': { fn: (day, budget) => ({ clicks: 10, spendUsd: budget, orders: 2, salesUsd: budget / (day >= 7 ? .3 : .7) }) },
};
const save = (name, result) => {
 const out = new URL(`../out/${name}/`, import.meta.url); mkdirSync(out, { recursive: true });
 writeFileSync(new URL('timeline.md', out), timelineMarkdown(result.timeline));
 writeFileSync(new URL('timeline.json', out), JSON.stringify(result.timeline, null, 2) + '\n');
};
for (const [name, { fn, days = 40 }] of Object.entries(cases)) {
 const result = await runCampaignLoop({ scriptedMarket: new ScriptedMarket(scenario, ({ day, campaign }) => fn(day, campaign.budget)), days });
 save(name, result);
 console.log(name, result.timeline.map(t => `${t.day}:${t.ruleId}:$${t.after.budget}:${t.after.tag}`).join(' '));
}
const edgeRows = [];
for (let phase = 0; phase < 3; phase++) {
 const result = await runCampaignLoop({ scriptedMarket: new ScriptedMarket(scenario, ({ day, campaign }) => alert(day, campaign.budget)), config: { ...DEFAULT_CONFIG, every3DaysAnchorMode: 'global', every3DaysAnchor: `2026-10-0${phase + 1}` } });
 save(`edge-B1-${phase}`, result);
 edgeRows.push({ phase, R05: result.timeline.filter(t => t.ruleId === 'R05').map(t => t.day), ALERT: result.timeline.filter(t => t.ruleId === 'R08').map(t => t.day), R06: result.timeline.filter(t => t.ruleId === 'R06').map(t => t.day) });
}
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
writeFileSync(new URL('../out/edge-B1.json', import.meta.url), JSON.stringify(edgeRows, null, 2) + '\n');
console.log('edge B1', edgeRows);
