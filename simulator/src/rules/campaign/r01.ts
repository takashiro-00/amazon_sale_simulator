import type { RuleDefinition } from '../../engine/types.js';
import { createCampaignMemory } from '../../domain/state.js';
import { propose } from './shared.js';
export const evaluate: RuleDefinition['evaluate'] = (ref, ctx) => {
    const id = ref.id, c = ctx.state.campaigns[id], old = ctx.state.campaignMemory[id];
    if (!c || c.status !== 'ENABLED' || (old && !ctx.manualReenabledCampaignIds?.includes(id)))
        return null;
    // Reset/grace timestamps are owned by the engine, including a budget no-op on R01.
    const m = createCampaignMemory(ctx.clock.now(), ctx.config);
    return propose(id, ctx, { ...m, createdAt: old?.createdAt ?? m.createdAt, budgetByDate: old?.budgetByDate ?? {}, windowStartAt: old?.windowStartAt ?? m.windowStartAt, cooldownUntil: old?.cooldownUntil ?? m.cooldownUntil, lastChangeAt: old?.lastChangeAt ?? m.lastChangeAt }, 0, 'NORMAL');
};
