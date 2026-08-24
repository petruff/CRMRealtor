import type { MailchimpAudience, MailchimpAudienceBinding } from '../domain/mailchimp.ts';

export type MailchimpGuidedSetupState =
  | 'selection-required'
  | 'complete'
  | 'syncing'
  | 'review';

export interface MailchimpGuidedSetupDependencies {
  readonly getSelectedAudience: () => Promise<MailchimpAudienceBinding | undefined>;
  readonly listAudiences: () => Promise<readonly MailchimpAudience[]>;
  readonly selectAudience: (audience: MailchimpAudience) => Promise<MailchimpAudienceBinding>;
  readonly setupWebhook: () => Promise<void>;
  readonly reconcileBaseline: () => Promise<{
    readonly completed: boolean;
    readonly review: boolean;
  }>;
}

/**
 * Resumes every safe Mailchimp setup step after OAuth. A single audience is
 * selected automatically; multiple audiences still require an explicit owner
 * choice so Omnix never syncs the wrong list.
 */
export async function resumeMailchimpGuidedSetup(
  dependencies: MailchimpGuidedSetupDependencies,
): Promise<{
  readonly state: MailchimpGuidedSetupState;
  readonly automaticallySelected: boolean;
}> {
  let binding = await dependencies.getSelectedAudience();
  let automaticallySelected = false;

  if (!binding) {
    const audiences = await dependencies.listAudiences();
    const [onlyAudience] = audiences;
    if (audiences.length !== 1 || !onlyAudience) {
      return { state: 'selection-required', automaticallySelected };
    }
    binding = await dependencies.selectAudience(onlyAudience);
    automaticallySelected = true;
  }

  if (binding.webhookRegistrationRequired) {
    await dependencies.setupWebhook();
  }

  if (!binding.baselineRequired) {
    return { state: 'complete', automaticallySelected };
  }

  const reconciliation = await dependencies.reconcileBaseline();
  return {
    state: reconciliation.review
      ? 'review'
      : reconciliation.completed ? 'complete' : 'syncing',
    automaticallySelected,
  };
}
