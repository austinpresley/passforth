import { env } from 'cloudflare:workers';
type ObjectBody = {
  body: ReadableStream<Uint8Array> | null;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
};
interface ObjectStore {
  put: (
    key: string,
    value: string | ArrayBuffer,
    options?: unknown,
  ) => Promise<unknown>;
  get: (key: string) => Promise<ObjectBody | null>;
  delete: (key: string) => Promise<unknown>;
}
export function objectStore(): ObjectStore {
  const config = env as {
    DESK_STORAGE?: string;
    SUPABASE_URL?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    BUCKET?: R2Bucket;
  };
  if (config.DESK_STORAGE !== 'postgres') {
    if (!config.BUCKET)
      throw new Error('Private file storage is not configured.');
    return config.BUCKET as unknown as ObjectStore;
  }
  if (
    !config.SUPABASE_URL?.startsWith('https://') ||
    !config.SUPABASE_SERVICE_ROLE_KEY
  )
    throw new Error('Private file storage is not configured.');
  const headers = {
    apikey: config.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + config.SUPABASE_SERVICE_ROLE_KEY,
  };
  const endpoint = (key: string) =>
    new URL(
      '/storage/v1/object/desk-files/' +
        key.split('/').map(encodeURIComponent).join('/'),
      config.SUPABASE_URL,
    );
  return {
    async put(key, value) {
      const response = await fetch(endpoint(key), {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: value,
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok)
        throw new Error(
          'Private file upload failed (' + response.status + ').',
        );
    },
    async get(key) {
      const response = await fetch(endpoint(key), {
        headers,
        signal: AbortSignal.timeout(30000),
      });
      if (response.status === 404 || response.status === 400) return null;
      if (!response.ok) throw new Error('Could not read private file storage.');
      return {
        body: response.body,
        text: () => response.text(),
        arrayBuffer: () => response.arrayBuffer(),
      };
    },
    async delete(key) {
      const response = await fetch(
        new URL('/storage/v1/object/desk-files', config.SUPABASE_URL),
        {
          method: 'DELETE',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: [key] }),
        },
      );
      if (!response.ok) throw new Error('Could not remove the private file.');
    },
  };
}
