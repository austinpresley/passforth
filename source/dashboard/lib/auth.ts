import { env } from 'cloudflare:workers';

export type AuthConfig = {
  DESK_AUTH_MODE?: string;
  DESK_OWNER_EMAIL?: string;
  DESK_OWNER_ID?: string;
  DESK_AUTH_USER_ID?: string;
  DESK_AGENT_TOKEN?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
};
export function authConfig() {
  return env as AuthConfig;
}
export function cookie(request: Request, name: string) {
  const value =
    request.headers
      .get('cookie')
      ?.split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(name + '='))
      ?.slice(name.length + 1) || '';
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}
export async function equalSecret(left: string, right: string) {
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode.encode(left)),
    crypto.subtle.digest('SHA-256', encode.encode(right)),
  ]);
  const x = new Uint8Array(a),
    y = new Uint8Array(b);
  let mismatch = 0;
  for (let i = 0; i < x.length; i++) mismatch |= x[i] ^ y[i];
  return mismatch === 0;
}
export async function supabaseUser(token: string) {
  const config = authConfig();
  if (
    !config.SUPABASE_URL?.startsWith('https://') ||
    !config.SUPABASE_PUBLISHABLE_KEY ||
    !config.DESK_OWNER_EMAIL ||
    !config.DESK_OWNER_ID ||
    !config.DESK_AUTH_USER_ID
  )
    throw new Error('Independent sign-in is not configured.');
  const response = await fetch(new URL('/auth/v1/user', config.SUPABASE_URL), {
    headers: {
      apikey: config.SUPABASE_PUBLISHABLE_KEY,
      Authorization: 'Bearer ' + token,
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw Object.assign(new Error('Sign in again to access your work.'), {
      status: 401,
    });
  const user = (await response.json()) as {
    id?: string;
    email?: string;
    email_confirmed_at?: string;
  };
  if (
    !user.id ||
    user.id !== config.DESK_AUTH_USER_ID ||
    !user.email_confirmed_at ||
    user.email?.toLowerCase() !== config.DESK_OWNER_EMAIL.toLowerCase()
  )
    throw Object.assign(
      new Error('This account does not have access to Passforth.'),
      { status: 403 },
    );
  return config.DESK_OWNER_ID;
}
export async function resolveIdentity(request: Request) {
  const config = authConfig();
  const bearer =
    request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1] ||
    request.headers.get('x-desk-agent-token') ||
    undefined;
  if (
    bearer &&
    config.DESK_AGENT_TOKEN &&
    config.DESK_OWNER_ID &&
    (await equalSecret(bearer, config.DESK_AGENT_TOKEN))
  )
    return config.DESK_OWNER_ID;
  if (config.DESK_AUTH_MODE === 'supabase') {
    const token = bearer || cookie(request, 'desk_access');
    if (!token)
      throw Object.assign(new Error('Sign in to access your tasks.'), {
        status: 401,
      });
    return supabaseUser(token);
  }
  if (config.DESK_AUTH_MODE && config.DESK_AUTH_MODE !== 'sites')
    throw new Error('Unknown sign-in configuration.');
  // Sites dispatch strips client identity headers before injecting this identity.
  const owner = request.headers.get('oai-authenticated-user-id');
  if (!owner)
    throw Object.assign(new Error('Sign in to access your tasks.'), {
      status: 401,
    });
  return owner;
}
