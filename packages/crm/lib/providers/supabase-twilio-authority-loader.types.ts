import type { ConnectorJob } from '../domain/connector.ts';
import type { TwilioEncryptedJobAuthority } from '../data/supabase-twilio-worker-authority.ts';

export interface ReturnTypeOfTwilioReader {
  read(job: ConnectorJob): Promise<TwilioEncryptedJobAuthority>;
}
