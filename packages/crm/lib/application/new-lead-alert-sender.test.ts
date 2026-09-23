import { describe, expect, it, vi } from 'vitest';
import { notifyNewLeads, sendNewLeadAlerts, type LeadAlertStore, type LeadAlertTarget } from './new-lead-alert-sender.ts';

const target = (id: string, patch: Partial<LeadAlertTarget> = {}): LeadAlertTarget => ({
  id, endpoint: `https://push.example/${id}`, p256dh: 'k', authSecret: 'a', showNames: false, alertNewLeads: true, quietStartHour: 21, quietEndHour: 7, ...patch,
});
function store(targets: LeadAlertTarget[]): LeadAlertStore & { revoked: string[] } {
  const revoked: string[] = [];
  return { revoked, listTargets: async () => targets, revoke: async (id) => { revoked.push(id); } };
}

describe('new lead alert sender', () => {
  it('pings opted-in devices outside quiet hours and revokes dead endpoints', async () => {
    const devices = store([
      target('phone', { showNames: true }), target('muted', { alertNewLeads: false }),
      target('night-owl', { quietStartHour: 9, quietEndHour: 17 }), target('gone'),
    ]);
    const sent: { id: string; title: string }[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await sendNewLeadAlerts({
      workspaceId: 'w', leads: [{ contactId: 'c1', firstName: 'Ana', lastName: 'Cruz', source: 'website' }], store: devices,
      now: new Date('2026-09-23T15:00:00Z'), timeZone: 'America/New_York',
      deliver: async (device, payload) => {
        if (device.id === 'gone') throw Object.assign(new Error('gone'), { statusCode: 410 });
        sent.push({ id: device.id, title: payload.title });
      },
    });
    expect(sent).toEqual([{ id: 'phone', title: 'New lead: Ana Cruz' }]);
    expect(result).toEqual({ sent: 1, quiet: 1, optedOut: 1, revoked: 1, failed: 0 });
    expect(devices.revoked).toEqual(['gone']);
  });

  it('does nothing (and never throws) when push is not configured', async () => {
    expect(await notifyNewLeads('w', [{ contactId: 'c1' }], {})).toBeUndefined();
  });
});
