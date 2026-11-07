import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

// The proof's verdict: a baseline only detects change, it is not an approved look. A failing picture is
// "changed", never "wrong"; a changed approved picture (proof/approved.json) needs a person.
export default class ChangeReporter implements Reporter {
  private readonly changed: string[] = [];
  private readonly approved: string[] = [];

  public onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== 'failed' && result.status !== 'timedOut') return;
    (test.title.includes('@approved') ? this.approved : this.changed).push(`${test.parent.project()?.name ?? ''} ${test.title}`);
  }

  public onEnd(_result: FullResult): void {
    if (this.changed.length + this.approved.length === 0) return;
    console.log(`\n${String(this.changed.length)} picture(s) changed against unreviewed baselines (they detect change, they do not say a look is wrong):`);
    for (const name of this.changed.slice(0, 40)) console.log(`  changed ${name}`);
    if (this.changed.length > 40) console.log(`  ... and ${String(this.changed.length - 40)} more in proof/report`);
    if (this.approved.length > 0) {
      console.log(`\n${String(this.approved.length)} APPROVED picture(s) changed; a person reviews these (npm run prove-render:approve):`);
      for (const name of this.approved) console.log(`  changed ${name}`);
    }
    console.log('\nLook at proof/report. If the change is wanted, refresh unreviewed baselines with: npm run prove-render:accept');
  }
}
