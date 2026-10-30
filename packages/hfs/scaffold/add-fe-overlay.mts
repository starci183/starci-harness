// starci app add overlay <name> --kind modal|drawer [--form] [--app <fe app>] - one overlay owner in the canon's shape.
//
//   starci app add overlay invite-member --kind modal          features/overlays/InviteMemberOverlay: a Dialog
//   starci app add overlay edit-details --kind drawer --form   a Drawer from the trailing edge holding a one-column form
//
// The two shells an overlay owner may draw are Grammar's `Dialog` (a modal) and `Drawer` (contexts/ui/components
// dialog-drawer.md). The connected half (`"use client"`, an overlay entry of FE-BOUNDARY-2) owns whether it is open and resolves
// every label; the pure half takes `{ props, on }` of atoms (FE-FUNCTION-2). The decision group puts the way out first and the
// commit last (action-group.md `decision`, CTA-5), always in the shell's footer. With `--form`, the body holds a Form with an `id`
// whose fields sit in a one-column `FormGrid` (text-field.md `narrow`), and the footer's commit is `type="submit"` with
// `form="<id>"`, so it submits that form from outside it. The bodies are templates/fe/units/overlay/; the stories draw it closed and open. A page or layout owner mounts it.
import fs from 'node:fs';
import path from 'node:path';
import { ScaffoldError, camelOf, pascalOf } from './service.mjs';
import { addCatalogNamespaces, appOf, declarationOf, fill, humanOf, words, writeNew } from './add-fe-unit.mjs';

/** The shells an overlay may be: `--kind` to Grammar component. */
const SHELLS: Readonly<Record<string, string>> = Object.freeze({ modal: 'Dialog', drawer: 'Drawer' });

/** The copy of a new overlay, by catalog locale; any other locale takes the English words. */
/** The copy of one overlay locale. */
interface OverlayCopy {
  readonly open: string;
  readonly cancel: string;
  readonly submit: string;
  readonly description: string;
  readonly name: string;
}

const OVERLAY_COPY: Readonly<Record<string, OverlayCopy>> & { readonly en: OverlayCopy } = Object.freeze({
  en: { open: 'Open', cancel: 'Cancel', submit: 'Save', description: 'Describe the task this overlay holds.', name: 'Name' },
  vi: { open: 'Mở', cancel: 'Hủy', submit: 'Lưu', description: 'Mô tả việc mà lớp phủ này đảm nhận.', name: 'Tên' },
});

/** The variables of the overlay templates for one shell, with or without a form. */
function overlayVars({ nameKebab, shell, form }: { nameKebab: string, shell: string, form: boolean }): Record<string, string> {
  const decision = (indent: string, cancel: string, commit: string) => [
    `${indent}<Button intent="dismiss" onPress={${cancel}}>`,
    `${indent}    {props.props.cancelLabel}`,
    `${indent}</Button>`,
    `${indent}${commit}`,
    `${indent}    {props.props.submitLabel}`,
    `${indent}</Button>`,
  ].join('\n');
  const shellAttributes = shell === 'Drawer' ? '        placement="right"\n' : '';
  /** The shell's footer: the decision group, the way out first and the commit last. */
  const footer = (commit: string) => [
    '        footer={(close) => (',
    '            <>',
    decision('                ', 'close', commit),
    '            </>',
    '        )}',
    '',
  ].join('\n');
  if (form) {
    const formId = `${nameKebab}-form`;
    return {
      grammarImports: ['Button', shell, 'Form', 'FormGrid', 'Input'].sort().join(', '),
      labelMembers: '        readonly nameLabel: string\n',
      labelsResolved: '                nameLabel: t("name"),\n',
      labelsFixture: '    nameLabel: "Name",\n',
      submitMember: '        readonly submit: (input: FormData) => void\n',
      submitHandler: 'submit: () => setIsOpen(false)',
      submitFixture: 'submit: () => undefined',
      doc: `The ${shell} holding one form: its fields in one column in the body, the footer's way out first and the submit, which names the form, last.`,
      shellAttributes,
      footer: footer(`<Button type="submit" form="${formId}" intent="commit">`),
      body: [
        `        <Form id="${formId}" label={props.props.title} onSubmit={props.on.submit}>`,
        '            <FormGrid columns={1}>',
        `                <Input id="${nameKebab}-name" name="name" label={props.props.nameLabel} isRequired />`,
        '            </FormGrid>',
        '        </Form>',
      ].join('\n'),
    };
  }
  return {
    grammarImports: ['Button', shell, 'Text'].sort().join(', '),
    labelMembers: '        readonly description: string\n',
    labelsResolved: '                description: t("description"),\n',
    labelsFixture: '    description: "Describe the task this overlay holds.",\n',
    submitMember: '        readonly confirm: () => void\n',
    submitHandler: 'confirm: () => setIsOpen(false)',
    submitFixture: 'confirm: () => undefined',
    doc: `The ${shell} of one task: its sentence, and the footer's way out first and commit last.`,
    shellAttributes,
    footer: footer('<Button intent="commit" onPress={props.on.confirm}>'),
    body: '        <Text>{props.props.description}</Text>',
  };
}

/**
 * Generates one overlay owner in the app at `repoRoot`.
 *
 * @param {{ repoRoot: string, name: string, options?: { app?: string, kind?: string, form?: boolean } }} input - The app root, the overlay name and the options.
 * @returns {{ created: string[] }} The files written or extended, relative to the app root.
 */
export function addFeOverlay({ repoRoot, name, options = {} }: { repoRoot: string, name: string, options?: { app?: string | undefined, kind?: string | undefined, form?: boolean | undefined } }): { created: string[] } {
  const shell = options.kind === undefined ? undefined : SHELLS[options.kind];
  if (shell === undefined) throw new ScaffoldError('HFS_ADD_OVERLAY_KIND', `an overlay names its shell with --kind ${Object.keys(SHELLS).join('|')}; those are the only two`);
  const base = pascalOf(name);
  if (!/^[A-Z][A-Za-z0-9]*$/.test(base)) throw new ScaffoldError('HFS_ADD_NAME_INVALID', `${name} is not a unit name`);
  const Name = base.endsWith('Overlay') ? base : `${base}Overlay`;
  const appBase = `fe/apps/${appOf(declarationOf(repoRoot), options.app)}`;
  const folder = `${appBase}/src/features/overlays/${Name}`;
  if (fs.existsSync(path.join(repoRoot, ...folder.split('/')))) throw new ScaffoldError('HFS_ADD_EXISTS', `${folder} already exists; starci app add never overwrites a unit`);
  const form = options.form === true;
  const vars = { Name, shell, nameCamel: camelOf(Name), title: humanOf(words(base).join('-')), ...overlayVars({ nameKebab: words(Name).join('-'), shell, form }) };
  const created: string[] = [];
  writeNew(created, repoRoot, `${folder}/index.tsx`, fill('overlay/index.tsx.tpl', vars));
  writeNew(created, repoRoot, `${folder}/component.tsx`, fill('overlay/component.tsx.tpl', vars));
  writeNew(created, repoRoot, `${appBase}/stories/overlays/${Name}.stories.tsx`, fill('overlay/stories.tsx.tpl', vars));
  addCatalogNamespaces(created, { repoRoot, appBase }, (locale) => {
    const copy = OVERLAY_COPY[locale] ?? OVERLAY_COPY.en;
    return { [vars.nameCamel]: { title: vars.title, open: copy.open, ...(form ? { name: copy.name } : { description: copy.description }), cancel: copy.cancel, submit: copy.submit } };
  });
  return { created };
}
