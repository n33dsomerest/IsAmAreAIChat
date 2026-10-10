import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'chat-files';

/** Service-role client: bypasses RLS, so it must only ever be used server-side. */
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service role is not configured');
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * The private bucket is created lazily on first use.
 *
 * Idempotent: `public: false` plus an explicit name, and a duplicate call is a
 * no-op rather than an error, so deploys do not need a setup step.
 */
export async function ensureBucket(): Promise<void> {
  const supabase = serviceClient();
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 20 * 1024 * 1024,
    allowedMimeTypes: [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
    ],
  });

  // 409 / "already exists" is the success case.
  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw new Error(`could not create the storage bucket: ${error.message}`);
  }
}

export type UploadResult = {
  path: string;
  sizeBytes: number;
  mime: string;
};

/** Path layout keeps one user's files impossible to address from another's. */
export function storagePath(userId: string, conversationId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';
  return `${userId}/${conversationId}/${crypto.randomUUID()}-${safe}`;
}

export async function upload(
  userId: string,
  conversationId: string,
  file: File,
): Promise<UploadResult> {
  await ensureBucket();
  const path = storagePath(userId, conversationId, file.name || 'file');

  const supabase = serviceClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(`upload failed: ${error.message}`);

  return { path, sizeBytes: file.size, mime: file.type || 'application/octet-stream' };
}

/**
 * Downloads a file for server-side processing.
 *
 * The path is checked against its own user prefix first — the bucket is
 * private, but a leaked path from another account must not become readable
 * just because this helper is willing to fetch it.
 */
export async function download(path: string, userId: string): Promise<ArrayBuffer> {
  if (!path.startsWith(`${userId}/`)) {
    throw new Error('storage path does not belong to this user');
  }

  const supabase = serviceClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw new Error(`download failed: ${error.message}`);

  return data.arrayBuffer();
}

export async function remove(path: string, userId: string): Promise<void> {
  if (!path.startsWith(`${userId}/`)) return;
  const supabase = serviceClient();
  await supabase.storage.from(BUCKET).remove([path]);
}

/**
 * base64 for handing bytes to a model inline.
 *
 * OpenAI-compatible endpoints take multimodal input as a data URL rather than a
 * fetchable link, so the file has to travel inside the request. Node only —
 * this is never called from a component.
 */
export function toBase64(buffer: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(buffer)).toString('base64');
}

export { BUCKET };