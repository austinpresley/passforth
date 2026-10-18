import { db } from './tasks';

export const requestEvent = {
  name: 'request.created',
  description:
    'the owner explicitly sent a task, project or note message to an agent. Read context, acknowledge the request, perform authorized work, and reply on that request. Reference notes do not trigger this event.',
  delivery: ['webhook'],
  inputSchema: {
    type: 'object',
    properties: { agent_id: { type: 'string', default: 'dot' } },
    additionalProperties: false,
  },
  payloadSchema: {
    type: 'object',
    properties: {
      request_id: { type: 'string' },
      target_type: { type: 'string' },
      target_key: { type: 'string' },
      agent_id: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['request_id', 'target_type', 'target_key', 'agent_id', 'body'],
    additionalProperties: false,
  },
};
function eventFailure(
  message: string,
  reason: string,
  stage: string,
  details: { callbackHost?: string; callbackStatus?: number } = {},
  rpcCode = -32015,
) {
  return Object.assign(new Error(message), {
    rpcCode,
    reason,
    stage,
    ...details,
  });
}
async function sameChallenge(a: unknown, b: string) {
  if (typeof a !== 'string') return false;
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(a)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(b)),
  ]);
  const left = new Uint8Array(x),
    right = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}
function callback(value: unknown) {
  let url: URL;
  try {
    if (typeof value !== 'string') throw new Error();
    url = new URL(value);
  } catch {
    throw eventFailure(
      'A valid HTTPS callback URL is required.',
      'invalid_url',
      'callback_url',
    );
  }
  // Cloudflare fetch cannot pin DNS. Only platform-controlled callback hosts are accepted.
  // Never widen this to arbitrary hosts without a resolver and connection-time IP pinning.
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    url.hash
  )
    throw eventFailure(
      'Use an HTTPS callback without credentials, fragments or an alternate port.',
      'invalid_url',
      'callback_url',
    );
  if (!/^(?:[a-z0-9-]+\.)*(?:openai\.com|chatgpt\.com)$/.test(url.hostname))
    throw eventFailure(
      'This callback host is not supported by Passforth. Use a callback hosted by OpenAI or ChatGPT.',
      'unsupported_host',
      'callback_url',
      { callbackHost: url.hostname },
    );
  return url.href;
}
function signingKey(value: unknown) {
  if (typeof value !== 'string')
    throw new Error('A webhook signing secret is required.');
  let decoded: Uint8Array;
  try {
    decoded = Uint8Array.from(atob(value.replace(/^whsec_/, '')), (char) =>
      char.charCodeAt(0),
    );
  } catch {
    throw new Error('Invalid webhook signing secret.');
  }
  if (decoded.length < 24 || decoded.length > 64)
    throw new Error('Webhook signing secrets must contain 24 to 64 bytes.');
  return decoded;
}
async function send(
  url: string,
  secret: string,
  subscriptionId: string,
  eventId: string,
  body: string,
) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = await crypto.subtle.importKey(
    'raw',
    signingKey(secret).buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(eventId + '.' + timestamp + '.' + body),
  );
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return fetch(callback(url), {
    method: 'POST',
    // workerd rejects redirect:"error" before sending. Manual mode returns 3xx
    // for the caller to reject without forwarding the signature or request body.
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': eventId,
      'webhook-timestamp': timestamp,
      'webhook-signature': 'v1,' + encoded,
      'X-MCP-Subscription-Id': subscriptionId,
    },
    body,
  });
}
export async function subscribe(owner: string, raw: Record<string, unknown>) {
  if (raw.name !== requestEvent.name)
    throw eventFailure(
      'Unknown event.',
      'invalid_event',
      'parameters',
      {},
      -32602,
    );
  const args = (raw.arguments ?? {}) as Record<string, unknown>;
  if (
    Object.keys(args).some((key) => key !== 'agent_id') ||
    (args.agent_id !== undefined &&
      (typeof args.agent_id !== 'string' ||
        !/^[a-z0-9_-]{1,80}$/.test(args.agent_id)))
  )
    throw eventFailure(
      'Use a valid agent_id filter.',
      'invalid_arguments',
      'parameters',
      {},
      -32602,
    );
  const filters = JSON.stringify({ agent_id: args.agent_id || 'dot' });
  const delivery = raw.delivery as Record<string, unknown> | undefined;
  if (delivery?.mode !== 'webhook')
    throw eventFailure(
      'Webhook delivery is required.',
      'invalid_delivery',
      'parameters',
      {},
      -32602,
    );
  const url = callback(delivery.url);
  const callbackHost = new URL(url).hostname;
  try {
    signingKey(delivery.secret);
  } catch {
    throw eventFailure(
      'Use a webhook signing secret containing 24 to 64 decoded bytes.',
      'invalid_signing_secret',
      'parameters',
      {},
      -32602,
    );
  }
  const ttl =
    raw.ttlMs === null
      ? null
      : raw.ttlMs === undefined
        ? 86400000
        : Number(raw.ttlMs);
  if (
    ttl !== null &&
    (!Number.isFinite(ttl) || ttl < 60000 || ttl > 30 * 86400000)
  )
    throw eventFailure(
      'Subscription lifetime must be between one minute and 30 days.',
      'invalid_lifetime',
      'parameters',
      {},
      -32602,
    );
  const existing = await db()
    .prepare(
      'SELECT id FROM subscriptions WHERE owner=? AND name=? AND arguments=? AND callback_url=?',
    )
    .bind(owner, requestEvent.name, filters, url)
    .first();
  const id = String(existing?.id || 'sub_' + crypto.randomUUID());
  const challenge = crypto.randomUUID();
  const eventId = 'verify_' + crypto.randomUUID();
  let response: Response;
  try {
    response = await send(
      url,
      String(delivery.secret),
      id,
      eventId,
      JSON.stringify({ type: 'verification', challenge }),
    );
  } catch (error) {
    const timeout = ['TimeoutError', 'AbortError'].includes(
      (error as Error).name,
    );
    throw eventFailure(
      timeout
        ? 'Webhook verification timed out.'
        : 'Webhook verification could not reach the callback.',
      timeout ? 'timeout' : 'unreachable',
      'callback_verification',
      { callbackHost },
    );
  }
  if (!response.ok)
    throw eventFailure(
      'The callback rejected webhook verification with HTTP ' +
        response.status +
        '.',
      'http_error',
      'callback_verification',
      { callbackHost, callbackStatus: response.status },
    );
  let echo: unknown;
  try {
    echo = await response.json();
  } catch {
    echo = null;
  }
  if (
    !(await sameChallenge(
      (echo as { challenge?: unknown } | null)?.challenge,
      challenge,
    ))
  )
    throw eventFailure(
      'The callback did not echo the verification challenge.',
      'challenge_failed',
      'callback_verification',
      { callbackHost },
    );
  const now = new Date().toISOString();
  const expires =
    ttl === null ? null : new Date(Date.now() + ttl).toISOString();
  await db()
    .prepare(
      `INSERT INTO subscriptions(id,owner,name,arguments,callback_url,secret,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET secret=excluded.secret,expires_at=excluded.expires_at`,
    )
    .bind(
      id,
      owner,
      requestEvent.name,
      filters,
      url,
      String(delivery.secret),
      expires,
      now,
    )
    .run();
  return { id, refreshBefore: expires, cursor: null, truncated: false };
}
export async function unsubscribe(owner: string, raw: Record<string, unknown>) {
  if (raw.name !== requestEvent.name) throw new Error('Unknown event.');
  const delivery = raw.delivery as Record<string, unknown> | undefined;
  const args = (raw.arguments ?? {}) as Record<string, unknown>;
  const url = callback(delivery?.url);
  const filters = JSON.stringify({ agent_id: args.agent_id || 'dot' });
  await db()
    .prepare(
      'DELETE FROM subscriptions WHERE owner=? AND name=? AND arguments=? AND callback_url=?',
    )
    .bind(owner, requestEvent.name, filters, url)
    .run();
  return {};
}
/** Called after request saves, by the agent inbox, and by an authenticated retry worker. */
export async function dispatch(owner: string, limit = 4) {
  const now = new Date().toISOString();
  const subscriptions = (
    await db()
      .prepare(
        'SELECT * FROM subscriptions WHERE owner=? AND (expires_at IS NULL OR expires_at>?)',
      )
      .bind(owner, now)
      .all()
  ).results;
  for (const subscription of subscriptions) {
    const agent = String(
      JSON.parse(String(subscription.arguments)).agent_id || 'dot',
    );
    const requests = (
      await db()
        .prepare(
          `SELECT requests.*,comments.body FROM requests JOIN comments ON comments.id=requests.comment_id AND comments.owner=requests.owner
      WHERE requests.owner=? AND requests.agent_id=? AND requests.state='queued'`,
        )
        .bind(owner, agent)
        .all()
    ).results;
    for (const request of requests) {
      const id = String(subscription.id) + ':' + String(request.id);
      const envelope = {
        eventId: String(request.id),
        name: requestEvent.name,
        timestamp: request.created_at,
        data: {
          request_id: request.id,
          target_type: request.target_type,
          target_key: request.target_key,
          agent_id: request.agent_id,
          body: request.body,
        },
        cursor: null,
      };
      await db()
        .prepare(
          `INSERT INTO deliveries(id,owner,subscription_id,request_id,body,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
        )
        .bind(
          id,
          owner,
          subscription.id,
          request.id,
          JSON.stringify(envelope),
          now,
          now,
        )
        .run();
    }
  }
  const pending = (
    await db()
      .prepare(
        `SELECT deliveries.*,subscriptions.callback_url,subscriptions.secret FROM deliveries JOIN subscriptions ON subscriptions.id=deliveries.subscription_id AND subscriptions.owner=deliveries.owner
    JOIN requests ON requests.id=deliveries.request_id AND requests.owner=deliveries.owner
    WHERE deliveries.owner=? AND deliveries.state='pending' AND deliveries.next_attempt_at<=? AND deliveries.attempts<8
    AND (subscriptions.expires_at IS NULL OR subscriptions.expires_at>?) AND requests.state='queued' ORDER BY deliveries.created_at LIMIT ${Math.max(1, Math.min(limit, 4))}`,
      )
      .bind(owner, now, now)
      .all()
  ).results;
  let delivered = 0;
  for (const delivery of pending) {
    // A persisted lease prevents concurrent page/inbox workers from delivering together.
    const lease = new Date(Date.now() + 60000).toISOString();
    const claimed = await db()
      .prepare(
        `UPDATE deliveries SET next_attempt_at=? WHERE id=? AND owner=? AND next_attempt_at=? AND state='pending'`,
      )
      .bind(lease, delivery.id, owner, delivery.next_attempt_at)
      .run();
    if (!claimed.meta.changes) continue;
    let status = 0;
    try {
      status = (
        await send(
          String(delivery.callback_url),
          String(delivery.secret),
          String(delivery.subscription_id),
          String(JSON.parse(String(delivery.body)).eventId),
          String(delivery.body),
        )
      ).status;
    } catch {
      /* retry after network failure */
    }
    const attempt = Number(delivery.attempts) + 1;
    const success = status >= 200 && status < 300;
    const terminal = status === 410 || status === 413 || attempt >= 8;
    const retryAt = new Date(
      Date.now() + Math.min(3600000, 15000 * 2 ** attempt),
    ).toISOString();
    await db()
      .prepare(
        'UPDATE deliveries SET state=?,attempts=?,next_attempt_at=?,last_error=?,delivered_at=? WHERE owner=? AND id=? AND next_attempt_at=?',
      )
      .bind(
        success ? 'delivered' : terminal ? 'failed' : 'pending',
        attempt,
        retryAt,
        success
          ? ''
          : status
            ? 'Notification endpoint returned ' + status
            : 'Notification endpoint could not be reached.',
        success ? new Date().toISOString() : null,
        owner,
        delivery.id,
        lease,
      )
      .run();
    if (success) delivered++;
  }
  return { attempted: pending.length, delivered };
}

export async function retryDeliveries(owner: string) {
  await db()
    .prepare(
      `UPDATE deliveries SET state='pending',attempts=0,next_attempt_at=? WHERE owner=? AND state='failed' AND last_error NOT IN ('Notification endpoint returned 410','Notification endpoint returned 413')`,
    )
    .bind(new Date().toISOString(), owner)
    .run();
  return dispatch(owner);
}
