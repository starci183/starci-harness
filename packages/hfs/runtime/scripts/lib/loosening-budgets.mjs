// loosening-budgets.mjs - the numeric budgets of the canon, pinned in knowledge/hfs/design-truths.yaml (`budgets`), judged on the tree as it stands.
// A budget is a ceiling (a file, a function, a feature may not be bigger) or a floor (a duplicate block is at least this large to count): raising a
// ceiling or lowering a floor in the slot manifests loosens the gate, and so does a budget that is gone. The pin names the file, the ruleParams node
// and the numbers, and the per-slot `budget` maps; the check reads each file's YAML and compares.
import { parseYaml } from '../../engine/yaml.mjs';
// reason: same dotted-path read of parsed YAML as BudgetDocument.
const at = (node, dotted) => (dotted ? dotted.split('.').reduce((value, key) => value?.[key], node) : node);
const isNumber = (value) => typeof value === 'number';
function paramRecords(doc, params) {
    const base = at(doc, params.under);
    const found = [];
    for (const [key, max] of Object.entries(params.ceilings ?? {})) {
        const value = at(base, key);
        if (!isNumber(value) || value > max)
            found.push(`${key} ${value ?? 'missing'}, the ceiling is ${max}`);
    }
    for (const [key, min] of Object.entries(params.floors ?? {})) {
        const value = at(base, key);
        if (!isNumber(value) || value < min)
            found.push(`${key} ${value ?? 'missing'}, the floor is ${min}`);
    }
    for (const [key, want] of Object.entries(params.equals ?? {})) {
        if (at(base, key) !== want)
            found.push(`${key} ${at(base, key) ?? 'missing'}, the canon says ${want}`);
    }
    return found;
}
function slotRecords(doc, slots) {
    const found = [];
    for (const [id, ceilings] of Object.entries(slots ?? {})) {
        const slot = (doc.slots ?? []).find((entry) => entry.id === id);
        for (const [key, max] of Object.entries(ceilings)) {
            const value = slot?.budget?.[key];
            if (!isNumber(value) || value > max)
                found.push(`slot ${id} budget ${key} ${value ?? 'missing'}, the ceiling is ${max}`);
        }
    }
    return found;
}
/** What the YAML `text` of a pinned file holds against its pin: the details of every budget raised, lowered or gone (an unreadable file is one). */
export function budgetRecords(text, pin) {
    let doc;
    try {
        doc = parseYaml(text);
    }
    catch {
        return ['the file is not readable YAML, so its budgets cannot be judged'];
    }
    return [...(pin.params ? paramRecords(doc, pin.params) : []), ...slotRecords(doc, pin.slots)];
}
