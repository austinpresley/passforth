'use client';
export async function savePlanning(
  action: 'note' | 'view' | 'block',
  value: Record<string, unknown>,
) {
  const response = await fetch('/api/workspace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...value }),
    signal: AbortSignal.timeout(15000),
  });
  const result = (await response.json()) as {
    error?: string;
    record: Record<string, unknown>;
    duplicate: boolean;
  };
  if (!response.ok)
    throw Object.assign(
      new Error(result.error || 'Save not confirmed. Your draft is retained.'),
      { status: response.status },
    );
  return result as { record: Record<string, unknown>; duplicate: boolean };
}
