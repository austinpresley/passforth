import { db } from './tasks';
import { dispatch } from './event-delivery';
import { backupWorkspace } from './backups';

/** Safe to repeat: notifications retain their ids; the verified daily backup has a persisted lease. */
export async function maintainWorkspace(owner: string) {
  const notifications = await dispatch(owner);
  const day = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/New_York',
  });
  const id = owner + ':backup:' + day;
  const previous = await db()
    .prepare('SELECT * FROM maintenance_runs WHERE owner=? AND id=?')
    .bind(owner, id)
    .first();
  if (previous?.state === 'complete')
    return {
      notifications,
      backup: JSON.parse(String(previous.result)),
      duplicate: true,
    };
  const now = new Date().toISOString();
  const lease = new Date(Date.now() + 15 * 60000).toISOString();
  const acquired = await db()
    .prepare(
      `INSERT INTO maintenance_runs(id,owner,state,lease_until,updated_at) VALUES(?,?,'working',?,?) ON CONFLICT(id) DO UPDATE SET state='working',lease_until=excluded.lease_until,updated_at=excluded.updated_at WHERE maintenance_runs.state!='complete' AND maintenance_runs.lease_until<=?`,
    )
    .bind(id, owner, lease, now, now)
    .run();
  if (!acquired.meta.changes) return { notifications, backup_pending: true };
  try {
    const backup = await backupWorkspace(owner);
    await db()
      .prepare(
        `UPDATE maintenance_runs SET state='complete',result=?,updated_at=? WHERE owner=? AND id=? AND lease_until=?`,
      )
      .bind(JSON.stringify(backup), new Date().toISOString(), owner, id, lease)
      .run();
    return { notifications, backup, duplicate: false };
  } catch (error) {
    await db()
      .prepare(
        `UPDATE maintenance_runs SET state='failed',lease_until=?,updated_at=? WHERE owner=? AND id=? AND lease_until=?`,
      )
      .bind(now, now, owner, id, lease)
      .run();
    throw error;
  }
}
