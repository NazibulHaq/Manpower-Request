import { OAuth2Client } from 'google-auth-library';
import crypto from 'node:crypto';

const COOKIE_NAME = 'manpower_dashboard_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const ALLOWED_DOMAIN = 'nextventures.io';

function getClientId() {
  const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  if (!clientId) throw new Error('GOOGLE_OAUTH_CLIENT_ID is not configured in Vercel Environment Variables.');
  return clientId;
}

function getSessionSecret() {
  const secret = String(process.env.DASHBOARD_SESSION_SECRET || '').trim();
  if (!secret) throw new Error('DASHBOARD_SESSION_SECRET is not configured in Vercel Environment Variables.');
  return secret;
}

function getAllowedEmails() {
  const raw = String(process.env.ALLOWED_DASHBOARD_EMAILS || '');
  return new Set(
    raw.split(',')
      .map(v => v.trim().toLowerCase())
      .filter(Boolean)
  );
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(value) {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(value)
    .digest('base64url');
}

function createSession(email) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = base64url(JSON.stringify({ email, exp }));
  return `${payload}.${sign(payload)}`;
}

function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.email || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    if (!getAllowedEmails().has(String(data.email).toLowerCase())) return null;
    return { email: String(data.email).toLowerCase(), exp: data.exp };
  } catch {
    return null;
  }
}

function getCookie(req, name) {
  const raw = req.headers?.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify(body));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');

  const action = String(req.query?.action || 'config').trim().toLowerCase();

  try {
    if (action === 'config') {
      return json(res, 200, { ok: true, clientId: getClientId(), domain: ALLOWED_DOMAIN });
    }

    if (action === 'logout') {
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }

    if (action === 'me') {
      const session = verifySession(getCookie(req, COOKIE_NAME));
      if (!session) return json(res, 401, { ok: false, authenticated: false });
      return json(res, 200, { ok: true, authenticated: true, email: session.email });
    }

    if (action === 'login') {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed.' });

      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      const credential = String(body?.credential || '').trim();
      if (!credential) return json(res, 400, { ok: false, error: 'Google credential is required.' });

      const client = new OAuth2Client(getClientId());
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: getClientId()
      });
      const payload = ticket.getPayload();

      const email = String(payload?.email || '').trim().toLowerCase();
      const emailVerified = payload?.email_verified === true;
      const hostedDomain = String(payload?.hd || '').trim().toLowerCase();
      const allowedEmails = getAllowedEmails();

      if (!emailVerified || hostedDomain !== ALLOWED_DOMAIN || !allowedEmails.has(email)) {
        clearSessionCookie(res);
        return json(res, 403, {
          ok: false,
          error: 'Access restricted. Please sign in using an authorized NEXT Ventures account.'
        });
      }

      setSessionCookie(res, createSession(email));
      return json(res, 200, { ok: true, authenticated: true, email });
    }

    return json(res, 400, { ok: false, error: `Unknown action "${action}".` });
  } catch (error) {
    console.error('Dashboard auth error:', error);
    return json(res, 500, { ok: false, error: error?.message || 'Authentication service error.' });
  }
}

export function requireDashboardSession(req) {
  const session = verifySession(getCookie(req, COOKIE_NAME));
  if (!session) {
    const error = new Error('Authentication required.');
    error.statusCode = 401;
    throw error;
  }
  return session;
}
