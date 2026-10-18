import { objectStore } from './objects';
import { db } from './tasks';
import { requireTarget } from './workspace';

export async function uploadFile(
  owner: string,
  type: 'task' | 'project' | 'note',
  targetKey: string,
  file: File,
) {
  await requireTarget(owner, type, targetKey);
  const bucket = objectStore();
  if (!file.size || file.size > 10 * 1024 * 1024)
    throw new Error('Choose a file smaller than 10 MB.');
  const id = owner + ':file-' + crypto.randomUUID();
  const objectKey = 'attachments/' + id;
  const filename =
    file.name.replace(/[\r\n\u0000]/g, '').slice(0, 200) || 'attachment';
  await bucket.put(objectKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: 'application/octet-stream' },
  });
  try {
    await db()
      .prepare(
        'INSERT INTO attachments(id,owner,target_type,target_key,filename,content_type,byte_size,object_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        id,
        owner,
        type,
        targetKey,
        filename,
        file.type || 'application/octet-stream',
        file.size,
        objectKey,
        new Date().toISOString(),
      )
      .run();
  } catch (error) {
    await bucket.delete(objectKey);
    throw error;
  }
  return { id, filename };
}
export async function readFile(owner: string, id: string) {
  const record = await db()
    .prepare('SELECT * FROM attachments WHERE owner=? AND id=?')
    .bind(owner, id)
    .first();
  if (!record)
    throw Object.assign(new Error('File not found.'), { status: 404 });
  const bucket = objectStore();
  const object = await bucket.get(String(record.object_key));
  if (!object)
    throw Object.assign(new Error('File contents are unavailable.'), {
      status: 404,
    });
  return { record, object };
}
