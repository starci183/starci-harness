// proves: HFS_AI_RETIRED_KEY@lite HFS_AI_RETIRED_KEY@full
// R344: the app's ai-router gateway has one virtual key, STARCI_AI_KEY; a tracked stack, env or doc file naming a retired AI key is refused.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { aiRetiredKeyFindings } from "../runtime/scripts/hfs/rules/ai-retired-key.mjs";
import { A15_CODES, FINDERS } from "../runtime/scripts/hfs/rules/a15-findings.mjs";

/** A scratch app holding `files` (path to text); removed when the test ends. */
const app = (t: { after: (fn: () => void) => void }, files: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hfs-ai-retired-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return { repoRoot: root, files: Object.keys(files) };
};

test("R344 is wired into app check", () => {
  assert.ok(FINDERS.includes(aiRetiredKeyFindings));
  assert.ok(A15_CODES.includes("HFS_AI_RETIRED_KEY"));
});

test("a stack, env or doc file naming a retired AI key is refused at its line, by name only", (t) => {
  const context = app(t, {
    ".starcistacks/application-stacks.yaml": "members:\n  - name: ai\n    keys: [STARCI_AI_KEY, OPENROUTER_API_KEY, OPENCLAW_AI_KEY]\n",
    ".starcistacks/production/infra/swarm/openclaw/entrypoint.sh": "#!/bin/sh\nexport KEY=\"$(cat \"$AI_API_KEY_FILE\")\"\n",
    ".starcistacks/production/infra/swarm/api.env.example": "AI_BASE_URL=http://api:8788/v1\nAI_ROUTER_ADMIN_TOKEN=\n",
    "docs/ai.md": "The api reads AI_API_KEY.\n",
  });
  const findings = aiRetiredKeyFindings(context);
  assert.deepEqual(
    findings.map((finding) => [finding.code, finding.path, finding.line, finding.name]),
    [
      ["HFS_AI_RETIRED_KEY", ".starcistacks/application-stacks.yaml", 3, "OPENCLAW_AI_KEY"],
      ["HFS_AI_RETIRED_KEY", ".starcistacks/production/infra/swarm/openclaw/entrypoint.sh", 2, "AI_API_KEY"],
      ["HFS_AI_RETIRED_KEY", ".starcistacks/production/infra/swarm/api.env.example", 2, "AI_ROUTER_ADMIN_TOKEN"],
      ["HFS_AI_RETIRED_KEY", "docs/ai.md", 1, "AI_API_KEY"],
    ],
  );
  assert.ok(findings.every((finding) => finding.message.includes("STARCI_AI_KEY")));
});

test("the one virtual key, provider keys, TypeScript, envelopes and history are not judged", (t) => {
  const context = app(t, {
    ".starcistacks/application-stacks.yaml": "keys: [STARCI_AI_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY]\n# MY_AI_API_KEY_LABEL is a label\n",
    "be/src/modules/integrations/ai/ai.config.ts": "export const name = \"AI_API_KEY\"\n",
    ".starcistacks/production/secrets/ai.enc.yaml": "AI_API_KEY: ENC[AES256_GCM,data:AA==]\n",
    "CHANGELOG.md": "- AI_API_KEY and OPENCLAW_AI_KEY are replaced by STARCI_AI_KEY\n",
  });
  assert.deepEqual(aiRetiredKeyFindings(context), []);
});

test("a file outside the check's scope is not judged", (t) => {
  const context = app(t, { "docs/ai.md": "OPENCLAW_AI_KEY\n" });
  assert.deepEqual(aiRetiredKeyFindings({ ...context, inScope: () => false }), []);
});
