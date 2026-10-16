import type { DatabaseContext } from '../db/connection';

export function isInstallationOwner(db: DatabaseContext, userId: string): boolean {
  return !!db.sqlite
    .prepare('SELECT 1 FROM installation_owner WHERE singleton=1 AND user_id=?')
    .get(userId);
}
