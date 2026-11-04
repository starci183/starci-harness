// `cli queues resume [--job <id>]` of a lite app (BE-RESILIENCE-2): the operator's resume of parked jobs. The cli process has no Redis,
// so the command asks the running app through the outbox (ParkedJobResumeRequestsService writes one row on the sweep queue) and the app's
// sweep resumes. It is rendered once both halves exist: by `add job` when the cli app is there, by `add cli` when platform/jobs is.
import fs from 'node:fs';
import path from 'node:path';
import { addModuleImport } from './add-compose.mjs';
import { ScaffoldError } from './service.mjs';
import { byCodeUnit } from '../report/order.mjs';

const GROUP = 'be/src/features/cli/queues';

const QUEUES_CLI = `import { Command, CommandRunner } from "nest-commander"
import { ResumeCli } from "./subs/resume.cli"

@Command({ name: "queues", description: "The queue and job commands", subCommands: [ResumeCli] })
/** \`cli queues\`: the queues group; its commands are the sub-commands (\`cli queues resume\`). */
export class QueuesCli extends CommandRunner {
    /** Without a sub-command the group shows its help. */
    run(): Promise<void> {
        return this.command.help()
    }
}
`;

const QUEUES_CLI_SPEC = `import { Test } from "@nestjs/testing"
import { QueuesCli } from "./queues.cli"

describe("QueuesCli", () => {
    it("shows the help of the group, and runs nothing else, when no sub-command is named", async () => {
        const moduleRef = await Test.createTestingModule({ providers: [QueuesCli] }).compile()
        const group = moduleRef.get(QueuesCli)
        const help = jest.fn()
        Object.defineProperty(group, "command", { value: { help } })

        await expect(Promise.resolve(group.run())).resolves.toBeUndefined()

        expect(help).toHaveBeenCalledTimes(1)
    })
})
`;

const QUEUES_MODULE = `import { Module } from "@nestjs/common"
import { QueuesCli } from "./queues.cli"
import { ConfigurableModuleClass } from "./queues.module-definition"
import { ResumeCli } from "./subs/resume.cli"

@Module({ providers: [QueuesCli, ResumeCli] })
/** The queues group: its command and its sub-commands; the work is the jobs capability's resume requests. */
export class QueuesModule extends ConfigurableModuleClass {}
`;

const QUEUES_DEFINITION = `import { defineConfigurableModule } from "@starci/nest-kit"
import type { QueuesOptions } from "./queues.options"

/** The configurable-module base of the queues module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } = defineConfigurableModule<QueuesOptions>()
`;

const QUEUES_OPTIONS = `/** The queues module takes no options yet. */
export type QueuesOptions = Record<string, never>
`;

const RESUME_CLI = `import { CommandRunner, Option, SubCommand } from "nest-commander"
import { ParkedJobResumeRequestsService } from "@modules/platform/jobs"

/** The options of \`cli queues resume\`. */
export interface ResumeOptions {
    /** The parked job to resume; without it every parked job is resumed. */
    readonly job?: string
}

@SubCommand({ name: "resume", description: "Resume a parked job, or every parked job" })
/** \`cli queues resume [--job <id>]\`: asks the running app to resume through the jobs capability's resume requests; no decision here. */
export class ResumeCli extends CommandRunner {
    constructor(private readonly requests: ParkedJobResumeRequestsService) {
        super()
    }

    /** \`--job <id>\`: the parked job to resume. */
    @Option({ flags: "--job <id>", description: "The parked job to resume" })
    parseJob(value: string): string {
        return value
    }

    /** Writes the resume request of the named job, or of every parked job. */
    async run(_passed: Array<string>, options?: ResumeOptions): Promise<void> {
        await this.requests.request(options?.job)
    }
}
`;

const RESUME_CLI_SPEC = `import { mock } from "@starci/jest-preset"
import { Test } from "@nestjs/testing"
import { ParkedJobResumeRequestsService } from "@modules/platform/jobs"
import { ResumeCli } from "./resume.cli"

const build = async () => {
    const requests = mock<ParkedJobResumeRequestsService>()
    const moduleRef = await Test.createTestingModule({
        providers: [ResumeCli, { provide: ParkedJobResumeRequestsService, useValue: requests }],
    }).compile()
    return { command: moduleRef.get(ResumeCli), requests }
}

describe("ResumeCli", () => {
    it("asks for the resume of the named job once", async () => {
        const { command, requests } = await build()

        await expect(command.run([], { job: "job-7" })).resolves.toBeUndefined()

        expect(requests.request).toHaveBeenCalledWith("job-7")
        expect(requests.request).toHaveBeenCalledTimes(1)
    })

    it("asks for every parked job when no job is named, and takes --job as given", async () => {
        const { command, requests } = await build()

        await command.run([])

        expect(requests.request).toHaveBeenCalledWith(undefined)
        expect(command.parseJob("job-7")).toBe("job-7")
    })
})
`;

const FILES: ReadonlyArray<readonly [string, string]> = [
  [`${GROUP}/queues.cli.ts`, QUEUES_CLI],
  [`${GROUP}/queues.cli.spec.ts`, QUEUES_CLI_SPEC],
  [`${GROUP}/queues.module.ts`, QUEUES_MODULE],
  [`${GROUP}/queues.module-definition.ts`, QUEUES_DEFINITION],
  [`${GROUP}/queues.options.ts`, QUEUES_OPTIONS],
  [`${GROUP}/subs/resume.cli.ts`, RESUME_CLI],
  [`${GROUP}/subs/resume.cli.spec.ts`, RESUME_CLI_SPEC],
];

/** The registrations the cli app's platform group gains: the outbox writer and the jobs capability's resume requests. */
const PLATFORM_IMPORTS: ReadonlyArray<readonly [string, string]> = [
  ['import { JobsModule } from "@modules/platform/jobs"', 'JobsModule.register({ isGlobal: true, requestsOnly: true, connection: PRIMARY_ENTITY_MANAGER })'],
  ['import { QueueModule } from "@modules/platform/queue"', 'QueueModule.register({ isGlobal: true, outboxOnly: true })'],
];

const readText = (file: string): string => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

/** Adds the resume requests and the outbox writer to the cli app's platform group, once. */
function composeCliPlatform(root: string): string {
  const relative = 'be/apps/cli/src/compose/platform.ts';
  const file = path.join(root, ...relative.split('/'));
  if (!fs.existsSync(file)) throw new ScaffoldError('HFS_ADD_WIRE_MISSING', `the queues cli group registers its capabilities in ${relative}, which does not exist`);
  let text = readText(file);
  const closing = text.lastIndexOf('\n]');
  if (closing < 0) throw new ScaffoldError('HFS_ADD_WIRE_INVALID', `${relative} has no platformModules array`);
  const entries = PLATFORM_IMPORTS.filter(([, entry]) => !text.includes(entry)).map(([, entry]) => `    ${entry},`);
  if (entries.length) text = `${text.slice(0, closing)}\n${entries.join('\n')}${text.slice(closing)}`;
  const database = /^import \{([^}]*)\} from "@modules\/platform\/database"$/m.exec(text);
  if (!database) throw new ScaffoldError('HFS_ADD_WIRE_INVALID', `${relative} does not import @modules/platform/database`);
  const names = database[1]!.split(',').map(name => name.trim()).filter(Boolean);
  if (!names.includes('PRIMARY_ENTITY_MANAGER')) {
    text = text.replace(database[0], `import { ${[...names, 'PRIMARY_ENTITY_MANAGER'].sort(byCodeUnit).join(', ')} } from "@modules/platform/database"`);
  }
  const lines = text.split('\n');
  for (const [importLine] of PLATFORM_IMPORTS) {
    if (lines.includes(importLine)) continue;
    const lastImport = lines.reduce((last, line, index) => line.startsWith('import ') ? index : last, -1);
    lines.splice(lastImport + 1, 0, importLine);
  }
  fs.writeFileSync(file, lines.join('\n'));
  return relative;
}

/** Registers the queues group in the cli feature root, once. */
function registerGroup(root: string): string {
  const relative = 'be/src/features/cli/cli.module.ts';
  const file = path.join(root, ...relative.split('/'));
  if (!fs.existsSync(file)) throw new ScaffoldError('HFS_ADD_WIRE_MISSING', `the queues cli group registers in ${relative}, which does not exist`);
  const lines = readText(file).split('\n');
  addModuleImport(lines, { importLine: 'import { QueuesModule } from "./queues/queues.module"', entry: 'QueuesModule.register({})', relative, noun: 'cli' });
  fs.writeFileSync(file, lines.join('\n'));
  return relative;
}

/**
 * Renders `cli queues resume` once a lite app has both its cli app and its jobs platform; answers the files it wrote or changed, and
 * nothing when either half is missing or the group exists (an existing group is the app's, never overwritten).
 */
export function ensureLiteQueuesCli(root: string): string[] {
  const cliApp = path.join(root, 'be', 'apps', 'cli', 'src', 'main.ts');
  const jobs = path.join(root, 'be', 'src', 'modules', 'platform', 'jobs', 'index.ts');
  if (!fs.existsSync(cliApp) || !fs.existsSync(jobs) || fs.existsSync(path.join(root, ...GROUP.split('/')))) return [];
  for (const [relative, body] of FILES) {
    const target = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  return [...FILES.map(([relative]) => relative), registerGroup(root), composeCliPlatform(root)];
}
