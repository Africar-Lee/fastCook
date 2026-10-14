import { success } from '../storage/types.ts';
import { createCredentialStore } from './config.ts';

let credentials: string | null = null;

export const credentialStore = createCredentialStore({
  read: async () => success(credentials),
  write: async value => { credentials = value; return success(undefined); },
  remove: async () => { credentials = null; return success(undefined); },
});
