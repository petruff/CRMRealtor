#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  addContactPointCommand,
  addHouseholdMemberCommand,
  addPersonRelationshipCommand,
  archiveContactCommand,
  archiveContactPointCommand,
  archiveCustomFieldDefinitionCommand,
  archiveHouseholdCommand,
  archivePersonRelationshipCommand,
  assignContactCommand,
  createCustomFieldDefinitionCommand,
  createHouseholdCommand,
  getContactArchiveCommand,
  listAssignmentsCommand,
  listContactCustomFieldValuesCommand,
  listContactPointsCommand,
  listCustomFieldDefinitionsCommand,
  listHouseholdMembersCommand,
  listHouseholdsCommand,
  listRelationshipsCommand,
  removeHouseholdMemberCommand,
  restoreContactCommand,
  restoreContactPointCommand,
  restorePersonRelationshipCommand,
  setContactCustomFieldValueCommand,
  unassignContactCommand,
  updateContactPointCommand,
} from '../lib/application/rich-contact-commands.ts';
import { createMemoryActivityRepository } from '../lib/data/memory-activity-repository.ts';
import { createMemoryRichContactRepository } from '../lib/data/memory-rich-contact-repository.ts';
import { memoryContactIsActive, memoryRepository } from '../lib/data/memory-repository.ts';
import type { RichContactRepository } from '../lib/data/rich-contact-repository.ts';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { supabaseRichContactRepository } from '../lib/data/supabase-rich-contact-repository.ts';
import { WorkspaceAuthorityError, SAMPLE_ASSISTANT_MEMBERSHIP_ID, SAMPLE_WORKSPACE_SCOPE, type WorkspaceScope } from '../lib/domain/workspace.ts';
import {
  CRM_WORK_QUEUE_CLI_EXIT,
  cliUsageError,
  optionValue,
  parseJsonOption,
  writeCliEnvelope,
  type CliOutput,
} from './crm-work-queue-cli.ts';

export type RichContactCliCommand =
  | 'points-list' | 'point-add' | 'point-update' | 'point-archive' | 'point-restore'
  | 'households-list' | 'household-create' | 'household-archive'
  | 'members-list' | 'member-add' | 'member-remove'
  | 'relationships-list' | 'relationship-add' | 'relationship-archive' | 'relationship-restore'
  | 'assignments-list' | 'assign' | 'unassign'
  | 'fields-list' | 'field-create' | 'field-archive' | 'values-list' | 'value-set'
  | 'contact-status' | 'contact-archive' | 'contact-restore';

interface Options {
  command: RichContactCliCommand;
  live: boolean;
  includeArchived: boolean;
  contactId?: string;
  pointId?: string;
  householdId?: string;
  relationshipId?: string;
  assignmentId?: string;
  definitionId?: string;
  assigneeMembershipId?: string;
  type?: string;
  label?: string;
  value?: string;
  name?: string;
  reason?: string;
  otherContactId?: string;
  primary?: boolean;
  subscribed?: boolean;
  order?: string;
  optionsJson?: string;
}

export interface RichContactCliContext {
  repository: RichContactRepository;
  scope: WorkspaceScope;
}

export interface RichContactCliDependencies extends CliOutput {
  readonly sampleContext?: () => RichContactCliContext;
  readonly liveContext?: () => Promise<RichContactCliContext>;
  readonly now?: () => Date;
}

const COMMANDS: readonly RichContactCliCommand[] = [
  'points-list', 'point-add', 'point-update', 'point-archive', 'point-restore',
  'households-list', 'household-create', 'household-archive', 'members-list', 'member-add', 'member-remove',
  'relationships-list', 'relationship-add', 'relationship-archive', 'relationship-restore',
  'assignments-list', 'assign', 'unassign', 'fields-list', 'field-create', 'field-archive',
  'values-list', 'value-set', 'contact-status', 'contact-archive', 'contact-restore',
];

function usage(): string {
  return [
    'Usage: npm run contacts:lifecycle -- <command> [options] [--live]',
    'Contact points: points-list, point-add, point-update, point-archive, point-restore',
    'Households: households-list, household-create, household-archive, members-list, member-add, member-remove',
    'Relationships: relationships-list, relationship-add, relationship-archive, relationship-restore',
    'Assignments: assignments-list, assign, unassign',
    'Custom fields: fields-list, field-create, field-archive, values-list, value-set',
    'Lifecycle: contact-status, contact-archive, contact-restore',
    'Common IDs: --contact-id, --point-id, --household-id, --relationship-id, --assignment-id, --definition-id',
    'Values: --type, --label, --value, --name, --reason, --other-contact-id, --assignee-membership-id',
    'Flags: --primary, --unsubscribed, --include-archived; numeric: --order; arrays: --options-json',
  ].join('\n');
}

function parse(argv: readonly string[]): Options | { help: true } {
  if (argv[0] === '--help' || argv[0] === '-h') return { help: true };
  if (!COMMANDS.includes(argv[0] as RichContactCliCommand)) cliUsageError(usage());
  const selected: Options = { command: argv[0] as RichContactCliCommand, live: false, includeArchived: false };
  const values: Readonly<Record<string, keyof Options>> = {
    '--contact-id': 'contactId', '--point-id': 'pointId', '--household-id': 'householdId',
    '--relationship-id': 'relationshipId', '--assignment-id': 'assignmentId', '--definition-id': 'definitionId',
    '--assignee-membership-id': 'assigneeMembershipId', '--type': 'type', '--label': 'label', '--value': 'value',
    '--name': 'name', '--reason': 'reason', '--other-contact-id': 'otherContactId', '--order': 'order',
    '--options-json': 'optionsJson',
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) continue;
    const valueKey = values[argument];
    if (argument === '--live') selected.live = true;
    else if (argument === '--include-archived') selected.includeArchived = true;
    else if (argument === '--primary') selected.primary = true;
    else if (argument === '--unsubscribed') selected.subscribed = false;
    else if (valueKey) Object.assign(selected, { [valueKey]: optionValue(argv, index++, argument) });
    else cliUsageError(`Unknown option: ${argument}\n${usage()}`);
  }
  return selected;
}

export function createSampleRichContactCliContext(): RichContactCliContext {
  const contacts = memoryRepository();
  const activity = createMemoryActivityRepository({
    activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId, SAMPLE_ASSISTANT_MEMBERSHIP_ID],
    isActiveContact: memoryContactIsActive,
  });
  return {
    repository: createMemoryRichContactRepository({
      contactRepository: contacts,
      activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId, SAMPLE_ASSISTANT_MEMBERSHIP_ID],
      activityRepository: activity,
    }),
    scope: SAMPLE_WORKSPACE_SCOPE,
  };
}

export async function createLiveRichContactCliContext(): Promise<RichContactCliContext> {
  const { client, scope } = await createAuthenticatedCliContext();
  return { repository: supabaseRichContactRepository(client), scope };
}

function jsonValue(value: string | undefined, option: string): unknown {
  if (value === undefined) throw new WorkspaceAuthorityError('invalid-input', `${option} is required.`);
  return parseJsonOption(value, option);
}

async function execute(selected: Options, context: RichContactCliContext, now: Date): Promise<unknown> {
  const { repository, scope } = context;
  switch (selected.command) {
    case 'points-list': return listContactPointsCommand(repository, scope, selected.contactId, selected.includeArchived);
    case 'point-add': return addContactPointCommand(repository, scope, { contactId: selected.contactId, type: selected.type,
      label: selected.label, displayValue: selected.value, isPrimary: selected.primary, emailSubscribed: selected.subscribed,
      displayOrder: selected.order }, now);
    case 'point-update': return updateContactPointCommand(repository, scope, { pointId: selected.pointId, type: selected.type,
      label: selected.label, displayValue: selected.value, isPrimary: selected.primary, emailSubscribed: selected.subscribed,
      displayOrder: selected.order }, now);
    case 'point-archive': return archiveContactPointCommand(repository, scope, selected.pointId, selected.reason, now);
    case 'point-restore': return restoreContactPointCommand(repository, scope, selected.pointId, now);
    case 'households-list': return listHouseholdsCommand(repository, scope, selected.includeArchived);
    case 'household-create': return createHouseholdCommand(repository, scope, selected.name, now);
    case 'household-archive': return archiveHouseholdCommand(repository, scope, selected.householdId, now);
    case 'members-list': return listHouseholdMembersCommand(repository, scope, selected.householdId);
    case 'member-add': return addHouseholdMemberCommand(repository, scope, selected.householdId, selected.contactId, now);
    case 'member-remove': return removeHouseholdMemberCommand(repository, scope, selected.householdId, selected.contactId, now);
    case 'relationships-list': return listRelationshipsCommand(repository, scope, selected.contactId, selected.includeArchived);
    case 'relationship-add': return addPersonRelationshipCommand(repository, scope, { firstContactId: selected.contactId,
      secondContactId: selected.otherContactId, kind: selected.type, label: selected.label }, now);
    case 'relationship-archive': return archivePersonRelationshipCommand(repository, scope, selected.relationshipId, now);
    case 'relationship-restore': return restorePersonRelationshipCommand(repository, scope, selected.relationshipId, now);
    case 'assignments-list': return listAssignmentsCommand(repository, scope, selected.contactId, selected.includeArchived);
    case 'assign': return assignContactCommand(repository, scope, selected.contactId, selected.assigneeMembershipId, now);
    case 'unassign': return unassignContactCommand(repository, scope, selected.assignmentId, now);
    case 'fields-list': return listCustomFieldDefinitionsCommand(repository, scope, selected.includeArchived);
    case 'field-create': return createCustomFieldDefinitionCommand(repository, scope, { name: selected.name, type: selected.type,
      options: selected.optionsJson === undefined ? [] : jsonValue(selected.optionsJson, '--options-json'),
      displayOrder: selected.order }, now);
    case 'field-archive': return archiveCustomFieldDefinitionCommand(repository, scope, selected.definitionId, now);
    case 'values-list': return listContactCustomFieldValuesCommand(repository, scope, selected.contactId);
    case 'value-set': return setContactCustomFieldValueCommand(repository, scope, { contactId: selected.contactId,
      definitionId: selected.definitionId, value: jsonValue(selected.value, '--value') }, now);
    case 'contact-status': return getContactArchiveCommand(repository, scope, selected.contactId);
    case 'contact-archive': return archiveContactCommand(repository, scope, selected.contactId, selected.reason, now);
    case 'contact-restore': return restoreContactCommand(repository, scope, selected.contactId, now);
  }
}

export async function runRichContactCli(argv: readonly string[], dependencies: RichContactCliDependencies = {}): Promise<number> {
  let live = argv.includes('--live');
  try {
    const selected = parse(argv);
    if ('help' in selected) {
      (dependencies.stdout ?? ((value) => process.stdout.write(value)))(`${usage()}\n`);
      return CRM_WORK_QUEUE_CLI_EXIT.success;
    }
    live = selected.live;
    const context = live
      ? await (dependencies.liveContext ?? createLiveRichContactCliContext)()
      : (dependencies.sampleContext ?? createSampleRichContactCliContext)();
    const result = await execute(selected, context, (dependencies.now ?? (() => new Date()))());
    return writeCliEnvelope(dependencies, { ok: true, resource: 'rich-contacts', command: selected.command, live, result });
  } catch (error) {
    return writeCliEnvelope(dependencies, { ok: false, resource: 'rich-contacts', live, error });
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runRichContactCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
