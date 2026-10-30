// loosening-budgets.mjs - the numeric budgets of the canon, pinned in knowledge/hfs/design-truths.yaml (`budgets`), judged on the tree as it stands.
// A budget is a ceiling (a file, a function, a feature may not be bigger) or a floor (a duplicate block is at least this large to count): raising a
// ceiling or lowering a floor in the slot manifests loosens the gate, and so does a budget that is gone. The pin names the file, the ruleParams node
// and the numbers, and the per-slot `budget` maps; the check reads each file's YAML and compares.
import { parseYaml } from '../../engine/yaml.mjs';

/** A pin of the design-truths manifest `budgets` list: the ruleParams node and the numbers it must hold, and the per-slot `budget` ceilings. */
export interface BudgetPin {
  params?: { under?: string; ceilings?: Record<string, number>; floors?: Record<string, number>; equals?: Record<string, unknown> };
  slots?: Record<string, Record<string, number>>;
}
// reason: the slot manifest is YAML parsed from disk; the budget checks read it by dotted path.
type BudgetDocument = any;

// reason: same dotted-path read of parsed YAML as BudgetDocument.
const at = (node: unknown, dotted?: string): any => (dotted ? dotted.split('.').reduce<any>((value, key) => value?.[key], node) : node);
const isNumber = (value: unknown): value is number => typeof value === 'number';

function paramRecords(doc: BudgetDocument, params: NonNullable<BudgetPin['params']>): string[] {
  const base = at(doc, params.under);
  const found: string[] = [];
  for (const [key, max] of Object.entries(params.ceilings ?? {})) {
    const value = at(base, key);
    if (!isNumber(value) || value > max) found.push(`${key} ${value ?? 'missing'}, the ceiling is ${max}`);
  }
  for (const [key, min] of Object.entries(params.floors ?? {})) {
    const value = at(base, key);
    if (!isNumber(value) || value < min) found.push(`${key} ${value ?? 'missing'}, the floor is ${min}`);
  }
  for (const [key, want] of Object.entries(params.equals ?? {})) {
    if (at(base, key) !== want) found.push(`${key} ${at(base, key) ?? 'missing'}, the canon says ${want}`);
  }
  return found;
}

function slotRecords(doc: BudgetDocument, slots: BudgetPin['slots']): string[] {
  const found: string[] = [];
  for (const [id, ceilings] of Object.entries(slots ?? {})) {
    const slot = (doc.slots ?? []).find((entry: { id?: unknown }) => entry.id === id);
    for (const [key, max] of Object.entries(ceilings)) {
      const value = slot?.budget?.[key];
      if (!isNumber(value) || value > max) found.push(`slot ${id} budget ${key} ${value ?? 'missing'}, the ceiling is ${max}`);
    }
  }
  return found;
}

/** What the YAML `text` of a pinned file holds against its pin: the details of every budget raised, lowered or gone (an unreadable file is one). */
export function budgetRecords(text: string, pin: BudgetPin): string[] {
  let doc: BudgetDocument;
  try { doc = parseYaml(text); } catch { return ['the file is not readable YAML, so its budgets cannot be judged']; }
  return [...(pin.params ? paramRecords(doc, pin.params) : []), ...slotRecords(doc, pin.slots)];
}
