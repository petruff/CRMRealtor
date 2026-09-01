import { describe, expect, it, vi } from 'vitest';
import type { TransactionRepository } from '../lib/data/transaction-repository.ts';
import { SAMPLE_WORKSPACE_SCOPE } from '../lib/domain/workspace.ts';
import { runTransactionCli } from './manage-transactions.ts';

function harness(repository: TransactionRepository) {
  const write = vi.fn(); const error = vi.fn();
  return {
    output: { write, error }, write, error,
    factory: async () => ({ repository, scope: SAMPLE_WORKSPACE_SCOPE, mode: 'sample-process-only' as const }),
  };
}

describe('transaction CLI', () => {
  it('returns a bounded versioned list envelope', async () => {
    const repository = {
      list: vi.fn(async () => []), listParties: vi.fn(async () => []),
      listFinancials: vi.fn(async () => []), listWorkflowPlans: vi.fn(async () => []),
    } as unknown as TransactionRepository;
    const test = harness(repository);
    await expect(runTransactionCli(['list'], test.output, test.factory)).resolves.toBe(0);
    expect(test.write.mock.calls[0]?.[0]).toContain('omnix-transactions-cli.v1');
    expect(repository.listParties).toHaveBeenCalledWith(SAMPLE_WORKSPACE_SCOPE, []);
    expect(repository.listFinancials).toHaveBeenCalledWith(SAMPLE_WORKSPACE_SCOPE, []);
  });

  it('routes a governed update payload and returns a redacted failure reference', async () => {
    const update = vi.fn(async () => ({ id: 'transaction-a' }));
    const repository = { update } as unknown as TransactionRepository;
    const test = harness(repository);
    const payload = JSON.stringify({ transactionId: 'transaction-a', expectedVersion: 1 });
    await expect(runTransactionCli(['update', '--payload', payload], test.output, test.factory)).resolves.toBe(0);
    expect(update).toHaveBeenCalledWith(SAMPLE_WORKSPACE_SCOPE, expect.objectContaining({ expectedVersion: 1 }), expect.any(String));

    await expect(runTransactionCli(['update'], test.output, test.factory)).resolves.toBe(2);
    expect(test.error.mock.calls.at(-1)?.[0]).toMatch(/supportRef/);
  });
});
