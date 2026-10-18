import { authConfig, cookie, supabaseUser } from '../../../lib/auth';
import { fail, writeGuard } from '../../../lib/tasks';
export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json(
    { mode: authConfig().DESK_AUTH_MODE || 'sites' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
export async function POST(request: Request) {
  try {
    writeGuard(request);
    const config = authConfig();
    if (config.DESK_AUTH_MODE !== 'supabase')
      throw Object.assign(
        new Error('Use Sign in with ChatGPT for this installation.'),
        { status: 400 },
      );
    const text = await request.text();
    if (text.length > 20000) throw new Error('Invalid sign-in request.');
    const input = JSON.parse(text);
    if (input.action === 'email') {
      if (
        typeof input.email !== 'string' ||
        !config.DESK_OWNER_EMAIL ||
        input.email.trim().toLowerCase() !==
          config.DESK_OWNER_EMAIL.toLowerCase()
      )
        throw Object.assign(
          new Error('Use the owner account for this private app.'),
          { status: 403 },
        );
      const endpoint = new URL('/auth/v1/otp', config.SUPABASE_URL);
      endpoint.searchParams.set(
        'redirect_to',
        new URL('/auth/callback', request.url).href,
      );
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          apikey: config.SUPABASE_PUBLISHABLE_KEY || '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: config.DESK_OWNER_EMAIL,
          create_user: true,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new Error(
          'Could not send the sign-in email. Check the authentication configuration.',
        );
      return Response.json({ sent: true });
    }
    let tokens: {
      access_token: string;
      refresh_token: string;
      expires_in?: number;
    };
    if (input.action === 'refresh') {
      const token = cookie(request, 'desk_refresh');
      if (!token)
        throw Object.assign(new Error('Sign in again.'), { status: 401 });
      const response = await fetch(
        new URL('/auth/v1/token?grant_type=refresh_token', config.SUPABASE_URL),
        {
          method: 'POST',
          headers: {
            apikey: config.SUPABASE_PUBLISHABLE_KEY || '',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ refresh_token: token }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok)
        throw Object.assign(new Error('Sign in again.'), { status: 401 });
      tokens = (await response.json()) as typeof tokens;
    } else if (
      input.action === 'session' &&
      typeof input.access_token === 'string' &&
      typeof input.refresh_token === 'string'
    )
      tokens = input;
    else throw new Error('Invalid sign-in request.');
    if (
      !/^[A-Za-z0-9._-]+$/.test(tokens.access_token) ||
      !tokens.refresh_token ||
      tokens.refresh_token.length > 10000
    )
      throw new Error('Invalid session.');
    await supabaseUser(tokens.access_token);
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    headers.append(
      'Set-Cookie',
      'desk_access=' +
        tokens.access_token +
        '; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600' +
        secure,
    );
    headers.append(
      'Set-Cookie',
      'desk_refresh=' +
        encodeURIComponent(tokens.refresh_token) +
        '; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000' +
        secure,
    );
    return new Response(JSON.stringify({ signed_in: true }), { headers });
  } catch (error) {
    return fail(error);
  }
}
