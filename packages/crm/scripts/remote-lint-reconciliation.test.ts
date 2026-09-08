import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../supabase/migrations/20260901180000_remote_lint_definition_reconciliation.sql', import.meta.url), 'utf8');
const fixture = readFileSync(new URL('../supabase/tests/20260907141500_remote_lint_reconciliation_test.sql', import.meta.url), 'utf8');
const required = (match: RegExpMatchArray | null): string => {
  if (!match) throw new Error('Expected reconciliation source block is missing.');
  return match[0];
};
const embedded = (name: string): string => {
  const start = `-- BEGIN MIGRATION ${name}\n`;
  const end = `\n-- END MIGRATION ${name}`;
  expect(fixture.split(start)).toHaveLength(2);
  const remainder = fixture.split(start)[1];
  if (remainder === undefined) throw new Error(`Missing fixture block ${name}.`);
  const block = remainder.split(end)[0];
  if (block === undefined || !remainder.includes(end)) throw new Error(`Unclosed fixture block ${name}.`);
  return block;
};

describe('live-shape reconciliation SQL regression source binding', () => {
  it('runs the actual helper in the PostgreSQL fixture, including same-session replay', () => {
    expect(embedded('helper')).toBe(required(migration.match(/create or replace function pg_temp\.replace_function_fragment_flexible[\s\S]*?\n\$\$;/u)));
  });

  it('runs the actual ordered validator transformations against isolated functions', () => {
    const validators = migration.split('\n')
      .filter((line) => line.startsWith('select pg_temp.') && /is_valid_contact_conversion_payload|is_valid_incomplete_conversion_plan/u.test(line))
      .join('\n')
      .replaceAll('public.is_valid_contact_conversion_payload(jsonb,boolean)', 'pg_temp.reconciliation_contact_fixture(jsonb,boolean)')
      .replaceAll('public.is_valid_incomplete_conversion_plan(jsonb)', 'pg_temp.reconciliation_plan_fixture(jsonb)');
    expect(validators.split('\n')).toHaveLength(6);
    expect(embedded('validators')).toBe(validators);
  });

  it('runs the exact guarded Gmail transformation with only its fixture target changed', () => {
    const gmail = required(migration.match(/do \$target_resource_reconcile\$[\s\S]*?\$target_resource_reconcile\$;/u))
      .replace(/'public\.record_omnix_inbound_response_intelligence\([^']+\)'/u, "'pg_temp.reconciliation_gmail_fixture()'");
    expect(embedded('gmail')).toBe(gmail);
    const lookup = required(gmail.match(/\$pattern\$select[\s\S]*?\$pattern\$/u));
    expect(lookup).toContain("direction='incoming'");
    expect(lookup).not.toContain("direction=''incoming''");
  });

  it('contains 15 real database assertions and rolls all fixtures back', () => {
    expect(fixture).toContain('select plan(15);');
    expect(fixture.match(/^select (?:lives_ok|throws_ok|ok|is)\(/gmu)).toHaveLength(15);
    expect(fixture.trimEnd()).toMatch(/select \* from finish\(\);\nrollback;$/u);
    expect(fixture).not.toContain('\r');
  });
});
