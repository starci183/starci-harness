// rollback-guard.mjs - the guard of a manual rollback to an older release.
// A rollback restores service specs, never data (PROJECT-STACKS-6). A contract migration destroys what the code of the releases before the previous
// one still uses, so rolling back to such a release after a contract migration ran leaves it on a schema it cannot read. The journal knows both: each
// attempt that accepted a release carries an `accept` phase, and each attempt that applied contract migrations carries them in `contract`.
//   chain      the accepted releases in the order the journal accepted them (a rollback is one more entry)
//   a contract migration applied by the attempt that accepted chain[i] is safe for chain[i] and chain[i-1] (the deploy only runs it once the previous
//   release no longer uses what it drops), and unsafe for every release accepted for the last time before chain[i-1].
// A target the journal cannot place is refused as soon as any contract migration is recorded; `--data-acknowledged` is the owner's yes to the loss window.
import { refusal } from './errors.mjs';

/** The part of an attempt document the guard reads. */
interface Evidence { releaseId?: unknown; phases?: unknown; contract?: unknown }

/** What the guard found. */
export interface ContractFinding { blocked: boolean; migrations: string[]; reason: string }

const accepted = (document: Evidence): boolean => Array.isArray(document.phases) && document.phases.some((phase) => phase !== null && typeof phase === 'object' && (phase as { phase?: unknown }).phase === 'accept' && (phase as { verdict?: unknown }).verdict === 'ok');
const contractOf = (document: Evidence): string[] => (Array.isArray(document.contract) ? document.contract.filter((name): name is string => typeof name === 'string') : []);

/** Judges a rollback to `target` against the attempt documents of the journal (oldest first). */
export function contractFinding(documents: readonly Record<string, unknown>[], target: string): ContractFinding {
  const chain: string[] = [];
  const marks: { index: number; migrations: string[] }[] = [];
  for (const document of documents as readonly Evidence[]) {
    if (typeof document.releaseId !== 'string' || !accepted(document)) continue;
    chain.push(document.releaseId);
    const migrations = contractOf(document);
    if (migrations.length > 0) marks.push({ index: chain.length - 1, migrations });
  }
  if (marks.length === 0) return { blocked: false, migrations: [], reason: '' };
  const at = chain.lastIndexOf(target);
  const unsafe = marks.filter((mark) => at === -1 || at < mark.index - 1);
  if (unsafe.length === 0) return { blocked: false, migrations: [], reason: '' };
  const migrations = unsafe.flatMap((mark) => mark.migrations);
  const where = at === -1 ? `the journal has no record of release ${target} being accepted, and` : `release ${target} was accepted before the release that ran them, and`;
  return { blocked: true, migrations, reason: `${where} contract migration(s) ${migrations.join(', ')} ran since: the schema no longer fits that release` };
}

/** Refuses `STACK_ROLLBACK_CONTRACT` when the finding blocks and the owner did not acknowledge the data effect; returns the notice line when it did. */
export function enforceContractGuard(finding: ContractFinding, acknowledged: boolean): string[] {
  if (!finding.blocked) return [];
  if (!acknowledged) throw refusal('STACK_ROLLBACK_CONTRACT', `${finding.reason}. A rollback restores services, never data: restore the backup first, or pass --data-acknowledged to roll back anyway; nothing was changed`);
  return [`--data-acknowledged: rolling back past ${finding.migrations.join(', ')}; the schema may not fit this release`];
}
