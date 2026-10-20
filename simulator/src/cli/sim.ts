import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { compactDecision } from '../audit/log.js';
import { runAccountLoop, accountTimelineMarkdown, runCampaignLoop, timelineMarkdown } from '../runner/campaignLoop.js';
import { readFileSync, mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { validateScenario } from '../scenario/schema.js';
import { date, instant, SimClock } from '../time/clock.js';
import { MarketDriver, applyManualEdits, summarize } from '../market/driver.js';
import { MemoryFactSink } from '../market/reporting.js';
import { eventContext } from '../market/events.js';
import { InMemoryFakePort } from '../api/port.js';
import { FaultyFakePort, RateLimitError, TransientServerError } from '../api/faultyPort.js';
import type { Target, Campaign } from '../domain/entities.js';
import { micros } from '../domain/money.js';
function* decisionRows(rows: readonly import('../engine/types.js').Decision[]) { for (const row of rows) yield compactDecision(row); }
async function writeJSONL(path: string, rows: Iterable<unknown>) {
    const stream = createWriteStream(path);
    const done = finished(stream);
    // Attach rejection handling immediately, including errors while waiting for drain.
    void done.catch(() => {});
    try {
        for (const row of rows) if (!stream.write(JSON.stringify(row) + '\n')) await once(stream, 'drain');
        stream.end(); await done;
    } catch (error) { stream.destroy(); throw error; }
}
async function main() {
    const args = process.argv.slice(2), input = args[0], flag = args.indexOf('--out');
    if (!input || flag < 0 || !args[flag + 1])
        throw new Error('Usage: npm run sim -- scenarios/file.json --out out/name');
    const s = validateScenario(JSON.parse(readFileSync(resolve(input), 'utf8'))), out = resolve(args[flag + 1]!);
    const rules = args.indexOf('--rules');
    if (rules >= 0) {
        if (args[rules + 1] === 'all') {
            const result = await runAccountLoop({ scenario: s });
            mkdirSync(out, { recursive: true });
            for(const [name,rows] of Object.entries({decisions:decisionRows(result.decisions),audit:result.audit,notifications:result.notifications,'port-calls':result.portCalls}))
                await writeJSONL(resolve(out,`${name}.jsonl`),rows);
            writeFileSync(resolve(out,'timeline.md'),accountTimelineMarkdown(result));
            const summary={seed:s.seed,days:s.days,decisions:result.decisions.length,targets:result.targets,apiCalls:Object.fromEntries([...new Set(result.portCalls.map(c=>c.op))].map(op=>[op,result.portCalls.filter(c=>c.op===op).length]))};
            writeFileSync(resolve(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
            process.stdout.write(JSON.stringify(summary,null,2)+'\n');return;
        }
        if (args[rules + 1] !== 'campaign') throw new Error('Unsupported --rules value');
        const result = await runCampaignLoop({ scenario: s });
        mkdirSync(out, { recursive: true });
        for (const [name, rows] of Object.entries({ facts: result.facts, decisions: decisionRows(result.decisions), audit: result.audit, notifications: result.notifications, 'port-calls': result.portCalls }))
            await writeJSONL(resolve(out, `${name}.jsonl`), rows);
        writeFileSync(resolve(out, 'timeline.md'), timelineMarkdown(result.timeline));
        const summary = { seed: s.seed, days: s.days, decisions: result.decisions.length, notifications: result.notifications.length, campaigns: result.state.campaigns };
        writeFileSync(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
        process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
        return;
    }
    const start = date(s.startDate, s.marketplace.zone), end = start.plus({ days: s.days }), clock = new SimClock(start.toUTC().toISO()!), sink = new MemoryFactSink(), driver = new MarketDriver(s, sink), view = driver.initialView();
    const port = new FaultyFakePort(new InMemoryFakePort(), clock, s.seed, () => eventContext(s, clock.now()).apiFault);
    const campaign = (c: typeof view.campaigns[number]): Campaign => ({ id: c.id, asin: c.asin, type: c.type, targetingKind: c.type === 'AUTO' ? 'AUTO' : 'KEYWORD', status: c.status, name: c.name, dailyBudgetMicros: micros(Math.round(c.budget * 1e6)), topOfSearchPct: c.topOfSearchPct });
    const target = (t: typeof view.campaigns[number]['targets'][number], c: typeof view.campaigns[number]): Target => ({ id: t.id, campaignId: c.id, adGroupId: `${c.id}:group`, kind: t.kind, ...(t.kind === 'KEYWORD' ? { matchType: t.matchType ?? 'EXACT' as const } : {}), status: t.status, text: t.text, bidMicros: micros(Math.round(t.bid * 1e6)) });
    // Seed external console state before enabling API faults. These are setup writes, not rules.
    port.configure({});
    for (const c of view.campaigns) {
        await port.updateCampaign(campaign(c), `seed:${c.id}`);
        for (const t of c.targets) {
            const item = target(t, c);
            if (t.kind === 'KEYWORD')
                await port.createKeywords([item], `seed:${t.id}`);
            else
                await port.updateTargets([{ target: item, bidMicros: item.bidMicros }], '/sp/targets', `seed:${t.id}`);
        }
    }
    let previous = start.minus({ hours: 1 }).toUTC().toISO()!;
    for (let at = start; at < end; at = at.plus({ hours: 1 })) {
        const iso = at.toUTC().toISO()!, delta = instant(iso).diff(instant(clock.now()), 'hours').hours;
        clock.advanceHours(delta);
        const before = structuredClone(view);
        applyManualEdits(s, view, previous, iso);
        port.configure({});
        for (const c of view.campaigns) {
            const old = before.campaigns.find(x => x.id === c.id)!;
            if (JSON.stringify({ ...old, targets: [] }) !== JSON.stringify({ ...c, targets: [] }))
                await port.updateCampaign(campaign(c), `manual:${c.id}:${iso}`);
            for (const t of c.targets) {
                if (JSON.stringify(old.targets.find(x => x.id === t.id)) !== JSON.stringify(t)) {
                    const item = target(t, c);
                    await port.updateTargets([{ target: item, bidMicros: item.bidMicros }], t.kind === 'KEYWORD' ? '/sp/keywords' : '/sp/targets', `manual:${t.id}:${iso}`);
                }
            }
        }
        port.configure(eventContext(s, iso).apiFault);
        // Static CLI probes read visibility; orchestration/retries of rule writes belong to Step 5.
        for (const c of view.campaigns) {
            try {
                await port.listKeywords(c.id, `observe:${c.id}:${iso}`);
            }
            catch (e) {
                if (!(e instanceof RateLimitError) && !(e instanceof TransientServerError))
                    throw e;
            }
        }
        driver.step(iso, view);
        previous = iso;
    }
    driver.flush(end.plus({ days: 15 }).toUTC().toISO()!);
    mkdirSync(out, { recursive: true });
    await writeJSONL(resolve(out, 'facts.jsonl'), sink.facts);
    await writeJSONL(resolve(out, 'port-calls.jsonl'), port.calls);
    const summary = summarize(s, sink.facts, driver.truth);
    writeFileSync(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}
main().catch(e => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
});
