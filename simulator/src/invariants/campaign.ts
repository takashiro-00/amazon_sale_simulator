import type { EngineState, Decision } from '../engine/types.js';
import type { SimConfig } from '../../config/defaults.js';
import { currentTag } from '../api/tags.js';
import { isGraceBlocked } from '../engine/cooldown.js';
import { instant, date } from '../time/clock.js';
export function assertCampaignInvariants(state: EngineState, id: string, config: SimConfig, decision?: Decision, at?: string): void {
    const c = state.campaigns[id]!, m = state.campaignMemory[id]!;
    if (!c || !m)
        throw new Error('MISSING_CAMPAIGN_MEMORY');
    const tags = c.name.match(/\[\s*(?:MANAGE|ALERT)\s*\]/gi) ?? [];
    if (tags.length > 1 || currentTag(c.name) !== (m.tag === 'PAUSED_AUTO' ? 'NORMAL' : m.tag))
        throw new Error('CAMPAIGN_TAG_MISMATCH');
    if (!Number.isInteger(m.budgetTierIndex) || c.dailyBudgetMicros !== config.budgetLadder[m.budgetTierIndex])
        throw new Error('CAMPAIGN_BUDGET_MISMATCH');
    if (m.tag === 'PAUSED_AUTO' && (c.status !== 'PAUSED' || m.budgetTierIndex !== 0 || !m.requiresUserConfirmToEnable))
        throw new Error('INVALID_PAUSED_AUTO');
    if ((m.preTagTierIndex !== null) !== (['MANAGE', 'ALERT'].includes(m.tag)))
        throw new Error('INVALID_PRE_TAG_TIER');
    if (m.preTagTierIndex !== null && (!Number.isInteger(m.preTagTierIndex) || !config.budgetLadder[m.preTagTierIndex]))
        throw new Error('INVALID_PRE_TAG_TIER');
    if (m.tag === 'NORMAL' && m.r06bPhase !== 'NONE')
        throw new Error('INVALID_R06B_PHASE');
    if (m.r06bPhase === 'STEP1_WAITING' && !['MANAGE', 'ALERT'].includes(m.tag))
        throw new Error('INVALID_R06B_PHASE');
    instant(m.createdAt);
    if (m.lastR09CheckDate)
        date(m.lastR09CheckDate, config.marketplace.zone);
    if (Object.keys(m.budgetByDate).length > 35)
        throw new Error('BUDGET_HISTORY_TOO_LONG');
    for (const [day, budget] of Object.entries(m.budgetByDate)) {
        date(day, config.marketplace.zone);
        if (!config.budgetLadder.includes(budget))
            throw new Error('INVALID_BUDGET_HISTORY');
    }
    for (const [tid, t] of Object.entries(state.targets))
        if (state.targetEntities[tid]?.campaignId === id && (!Number.isFinite(t.tagReductionFactor) || t.tagReductionFactor < .7 || t.tagReductionFactor > 1))
            throw new Error('INVALID_TAG_FACTOR');
    const old = decision?.before.campaignMemory[id];
    if (old && decision && at && isGraceBlocked(decision.ruleId, old, at))
        throw new Error('DECISION_DURING_GRACE');
}
