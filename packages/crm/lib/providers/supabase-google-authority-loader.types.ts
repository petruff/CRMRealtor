import type { ConnectorJob } from '../domain/connector.ts';
import type { GoogleEncryptedJobAuthority } from '../data/supabase-google-worker-authority.ts';

export interface ReturnTypeOfGoogleReader {
  read(job: ConnectorJob): Promise<GoogleEncryptedJobAuthority>;
}
