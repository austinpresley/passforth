import { objectStore } from './objects';
import { exportWorkspace } from './workspace';

/** A private record snapshot with separately copied and verified attachment bytes. */
export async function backupWorkspace(owner: string) {
  const bucket = objectStore();
  const snapshot = await exportWorkspace(owner);
  const attachmentCopies: { id: unknown; key: string; sha256: string }[] = [];
  const ownerHash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(owner)),
    ),
    (value) => value.toString(16).padStart(2, '0'),
  ).join('');
  const prefix =
    'backups/' + ownerHash + '/' + snapshot.exported_at.replaceAll(':', '-');
  for (const file of snapshot.tables.attachments as Record<string, unknown>[]) {
    const original = await bucket.get(String(file.object_key));
    if (!original)
      throw new Error('An attachment is missing; the backup is incomplete.');
    const bytes = await original.arrayBuffer();
    const key = prefix + '/files/' + encodeURIComponent(String(file.id));
    await bucket.put(key, bytes);
    const copy = await bucket.get(key);
    if (!copy) throw new Error('Attachment backup readback failed.');
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (value) => value.toString(16).padStart(2, '0'),
    ).join('');
    const readback = Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', await copy.arrayBuffer()),
      ),
      (value) => value.toString(16).padStart(2, '0'),
    ).join('');
    if (hash !== readback)
      throw new Error('Attachment backup checksum failed.');
    attachmentCopies.push({ id: file.id, key, sha256: hash });
  }
  const serialized = JSON.stringify({
    ...snapshot,
    attachment_backups: attachmentCopies,
  });
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(serialized),
      ),
    ),
    (value) => value.toString(16).padStart(2, '0'),
  ).join('');
  const key = prefix + '/records.json';
  await bucket.put(key, serialized, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      sha256: hash,
      schema_version: String(snapshot.schema_version),
    },
  });
  const verification = await bucket.get(key);
  if (!verification || (await verification.text()) !== serialized)
    throw new Error('Backup readback verification failed.');
  return {
    key,
    sha256: hash,
    exported_at: snapshot.exported_at,
    record_counts: Object.fromEntries(
      Object.entries(snapshot.tables).map(([table, rows]) => [
        table,
        (rows as unknown[]).length,
      ]),
    ),
    attachment_contents:
      'Copied and checksum-verified in the private backup folder.',
    attachment_count: attachmentCopies.length,
  };
}
