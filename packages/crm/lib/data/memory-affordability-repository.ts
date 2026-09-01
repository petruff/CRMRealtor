import { randomUUID } from 'node:crypto';
import {
  validateAffordabilityScenarioInput,
  validateAffordabilitySharePreview,
  type AffordabilityScenario,
  type AffordabilityScenarioRevision,
  type AffordabilityShareIntent,
} from '../domain/affordability';
import { validateWorkspaceScope } from '../domain/workspace';
import type { AffordabilityRepository } from './affordability-repository';

export function createMemoryAffordabilityRepository(): AffordabilityRepository {
  const scenarios: AffordabilityScenario[] = [];
  const revisions: AffordabilityScenarioRevision[] = [];
  const shares: AffordabilityShareIntent[] = [];
  const scenarioReplay = new Map<string, AffordabilityScenario>();
  const shareReplay = new Map<string, AffordabilityShareIntent>();
  return {
    async list(untrustedScope) {
      const scope = validateWorkspaceScope(untrustedScope);
      return scenarios.filter((item) => item.workspaceId === scope.workspaceId);
    },
    async listRevisions(untrustedScope, scenarioId) {
      const scope = validateWorkspaceScope(untrustedScope);
      return revisions.filter((item) => item.workspaceId === scope.workspaceId && item.scenarioId === scenarioId);
    },
    async listShareIntents(untrustedScope, scenarioId) {
      const scope = validateWorkspaceScope(untrustedScope);
      return shares.filter((item) => item.workspaceId === scope.workspaceId && (!scenarioId || item.scenarioId === scenarioId));
    },
    async upsert(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      const input = validateAffordabilityScenarioInput(untrustedInput);
      const key = `${scope.workspaceId}:${input.idempotencyKey}`;
      const replay = scenarioReplay.get(key);
      if (replay) return replay;
      const index = input.scenarioId
        ? scenarios.findIndex((item) => item.workspaceId === scope.workspaceId && item.id === input.scenarioId)
        : -1;
      const current = index >= 0 ? scenarios[index] : undefined;
      if ((current?.version ?? 0) !== input.expectedVersion) throw new Error('Scenario version is stale.');
      const scenario: AffordabilityScenario = {
        id: current?.id ?? randomUUID(), workspaceId: scope.workspaceId, name: input.name,
        contactId: input.contactId, transactionId: input.transactionId, inputs: input.inputs,
        outputs: input.outputs, disclaimer: input.disclaimer, version: input.expectedVersion + 1,
        createdByMembershipId: current?.createdByMembershipId ?? scope.membershipId,
        updatedByMembershipId: scope.membershipId, createdAt: current?.createdAt ?? occurredAt, updatedAt: occurredAt,
      };
      if (index < 0) scenarios.push(scenario); else scenarios[index] = scenario;
      revisions.push({
        id: randomUUID(), scenarioId: scenario.id, workspaceId: scope.workspaceId, version: scenario.version,
        name: scenario.name, inputs: scenario.inputs, outputs: scenario.outputs, reasonCode: input.reasonCode,
        createdByMembershipId: scope.membershipId, createdAt: occurredAt,
      });
      scenarioReplay.set(key, scenario);
      return scenario;
    },
    async createSharePreview(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      const input = validateAffordabilitySharePreview(untrustedInput);
      const key = `${scope.workspaceId}:${input.idempotencyKey}`;
      const replay = shareReplay.get(key);
      if (replay) return replay;
      const scenario = scenarios.find((item) => item.workspaceId === scope.workspaceId && item.id === input.scenarioId);
      if (!scenario || scenario.version < input.scenarioVersion
        || !revisions.some((item) => item.scenarioId === scenario.id && item.version === input.scenarioVersion)) {
        throw new Error('Scenario revision was not found.');
      }
      const revision = revisions.find((item) => item.scenarioId === scenario.id && item.version === input.scenarioVersion)!;
      const expectedPreview = {
        scenarioId: scenario.id, scenarioVersion: revision.version, name: revision.name,
        inputs: revision.inputs, outputs: revision.outputs, disclaimer: scenario.disclaimer,
      };
      if (JSON.stringify(input.previewPayload) !== JSON.stringify(expectedPreview)) {
        throw new Error('Sharing preview does not match the canonical scenario revision.');
      }
      const share: AffordabilityShareIntent = {
        id: randomUUID(), workspaceId: scope.workspaceId, scenarioId: input.scenarioId,
        scenarioVersion: input.scenarioVersion, recipientName: input.recipientName,
        recipientAddress: input.recipientAddress, channel: 'email', consentConfirmed: true,
        previewPayload: expectedPreview, status: 'previewed', createdByMembershipId: scope.membershipId,
        createdAt: occurredAt,
      };
      shares.push(share); shareReplay.set(key, share); return share;
    },
  };
}
