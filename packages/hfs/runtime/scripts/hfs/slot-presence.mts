// slot-presence.mts - the presence of a slot for one profile, shared by the HFS slot resolver, declaration validation, sync and
// the rule parameters. A both-sides slot whose presence differs by side names the side's own presence in `sidePresence`
// ({be, fe}); every other slot has one presence. A forbidden slot is external; a slot a side may hold is tracked there.
import { isPlainObject } from '../../engine/plain-object.mjs';
import type { Parsed, RuleParams, Slot, SlotPresence } from './manifest-shape.mjs';

/** The presence of `slot` for `profile`: its `sidePresence` entry for that side, else the slot's own presence. */
export function presenceOf(slot: Pick<Slot, 'sidePresence' | 'presence'>, profile: string): SlotPresence {
  const sides = slot.sidePresence;
  return isPlainObject(sides) ? ((sides as Record<string, SlotPresence>)[profile] ?? slot.presence) : slot.presence;
}

/** The slot as `profile` sees it: its side's presence, and the tracking that presence implies. */
export function effectiveSlot(slot: Slot, profile: string): Slot {
  if (slot.sidePresence === undefined) return slot;
  const { sidePresence: _sides, ...base } = slot;
  const presence = presenceOf(slot, profile);
  let tracked = slot.tracked;
  if (presence === 'forbidden') tracked = 'external';
  else if (tracked === 'external') tracked = 'tracked';
  return { ...base, presence, tracked };
}

/** A deep-frozen copy of one profile's rule parameters. */
export function frozenRuleParams(params: RuleParams): RuleParams {
  const deepFreeze = (value: Parsed): Parsed => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); } return Object.freeze(value); };
  return deepFreeze(structuredClone(params));
}
