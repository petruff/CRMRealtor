import { ActivityError } from '../domain/activity.ts';
import type { PipelineRepository } from './pipeline-repository.ts';
import type { ContactRepository } from './repository.ts';
import type { ActivityRepository } from './activity-repository.ts';

export function createMemoryPipelineRepository(input: {
  contacts: ContactRepository;
  activities: ActivityRepository;
}): PipelineRepository {
  return {
    async moveStage(scope, command) {
      if (command.actorMembershipId !== scope.membershipId) {
        throw new ActivityError('forbidden', 'Actor does not match workspace membership.');
      }
      const operation = async () => {
        const replay = (await input.activities.listEvents(scope, {
          contactId: command.contactId,
          limit: 500,
        })).find((event) => event.idempotencyKey === command.idempotencyKey);
        if (replay) {
          const sameCommand = replay.type === 'pipeline-stage-changed'
            && replay.actorMembershipId === command.actorMembershipId
            && replay.metadata?.fromStage === command.fromStage
            && replay.metadata?.toStage === command.toStage;
          if (!sameCommand) throw new ActivityError('conflict', 'Idempotency key was already used for another pipeline move.');
          const replayContact = await input.contacts.get(command.contactId);
          if (!replayContact) throw new ActivityError('not-found', 'Contact was not found.');
          return { contact: replayContact, event: replay, noOp: true };
        }
        const contact = await input.contacts.get(command.contactId);
        if (!contact || contact.archivedAt) throw new ActivityError('not-found', 'Active contact was not found.');
        const version = contact.updatedAt ?? contact.createdAt;
        if (contact.pipelineStage !== command.fromStage || version !== command.expectedUpdatedAt) {
          throw new ActivityError('conflict', 'The contact changed. Refresh the pipeline and try again.');
        }
        if (command.fromStage === command.toStage) return { contact, noOp: true };
        const updated = await input.contacts.update(contact.id, {
          pipelineStage: command.toStage,
          ...(command.toStage === 'closed' || command.toStage === 'lost'
            ? { nextTouchAt: undefined, touchDateOverridden: false }
            : {}),
          updatedAt: command.occurredAt,
        });
        const appended = await input.activities.appendEvent(scope, {
          type: 'pipeline-stage-changed',
          contactId: contact.id,
          actorMembershipId: scope.membershipId,
          occurredAt: command.occurredAt,
          idempotencyKey: command.idempotencyKey,
          metadata: { fromStage: command.fromStage, toStage: command.toStage },
        });
        return { contact: updated, event: appended.event, noOp: appended.noOp };
      };
      if (input.contacts.runTransaction && input.activities.runTransaction) {
        return input.contacts.runTransaction(() => input.activities.runTransaction!(operation));
      }
      return operation();
    },
  };
}
