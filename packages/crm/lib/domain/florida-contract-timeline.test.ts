import { describe, expect, it } from 'vitest';
import { TimelineError, isBusinessDay, nationalHolidays, parseTimelineInput, periodEnd, proposeTimeline } from './florida-contract-timeline.ts';

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, entry] of Object.entries(values)) data.set(key, entry);
  return data;
}

describe('national legal holidays', () => {
  it('computes fixed and floating federal holidays', () => {
    const holidays = nationalHolidays(2026);
    for (const day of ['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-04', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25']) {
      expect(holidays.has(day)).toBe(true);
    }
    expect(holidays.size).toBe(11);
    expect(isBusinessDay('2026-09-07')).toBe(false);
    expect(isBusinessDay('2026-09-26')).toBe(false);
    expect(isBusinessDay('2026-09-28')).toBe(true);
  });
});

describe('period end', () => {
  it('counts calendar days from the Effective Date and rolls past Labor Day', () => {
    // Worked example: a 10-day inspection period from Aug 25, 2023 ends on Labor Day and rolls to Tuesday.
    expect(periodEnd('2023-08-25', 10)).toEqual({ date: '2023-09-05', rolled: true });
    expect(periodEnd('2026-09-23', 15)).toEqual({ date: '2026-10-08', rolled: false });
    expect(periodEnd('2026-09-23', 3)).toEqual({ date: '2026-09-28', rolled: true }); // Saturday → Monday
  });
});

describe('proposed timeline', () => {
  it('builds the FR/BAR default schedule for a financed purchase, soonest first', () => {
    const input = parseTimelineInput(form({ effectiveDate: '2026-09-23', closingDate: '2026-10-30', financing: 'financed', depositDays: '3', inspectionDays: '15', loanApplicationDays: '5', loanApprovalDays: '30' }));
    expect(proposeTimeline(input).map((item) => [item.label, item.date])).toEqual([
      ['Initial escrow deposit due', '2026-09-28'],
      ['Loan application due', '2026-09-28'],
      ['Inspection period ends', '2026-10-08'],
      ['Loan approval period ends', '2026-10-23'],
      ['Closing', '2026-10-30'],
    ]);
  });

  it('skips financing dates for cash deals and adds an optional additional deposit', () => {
    const input = parseTimelineInput(form({ effectiveDate: '2026-09-23', closingDate: '2026-10-09', financing: 'cash', depositDays: '3', inspectionDays: '10', additionalDepositDays: '10' }));
    expect(proposeTimeline(input).map((item) => item.key)).toEqual(['initial-deposit', 'inspection', 'additional-deposit', 'closing']);
  });

  it('explains invalid input', () => {
    try {
      parseTimelineInput(form({ effectiveDate: '2026-02-30', closingDate: '2026-01-01', depositDays: '0', inspectionDays: 'x', loanApplicationDays: '5', loanApprovalDays: '30' }));
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(TimelineError);
      expect(Object.keys((error as TimelineError).fieldErrors).sort()).toEqual(['depositDays', 'effectiveDate', 'inspectionDays']);
    }
  });
});
