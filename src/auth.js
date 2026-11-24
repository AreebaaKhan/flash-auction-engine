import { createHmac, timingSafeEqual } from 'node:crypto';

export const USERS = [
  { id: 'admin', name: 'Demo Admin', role: 'admin' },
  { id: 'ayesha', name: 'Ayesha Khan', role: 'bidder' },
  { id: 'hamza', name: 'Hamza Ali', role: 'bidder' },
  { id: 'sara', name: 'Sara Ahmed', role: 'bidder' },
  { id: 'bilal', name: 'Bilal Shah', role: 'bidder' }
];
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
export function signToken(user, secret, seconds = 14400) {
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, name: user.name, role: user.role, exp: Math.floor(Date.now() / 1000) + seconds, iss: 'flashroom', aud: 'flashroom-demo' })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function verifyToken(token, secret) {
  try {
    if (typeof token !== 'string' || token.length > 2048) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
    const actual = Buffer.from(parts[2], 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (!Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000 || payload.iss !== 'flashroom' || payload.aud !== 'flashroom-demo') return null;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(payload.sub) || !['admin', 'bidder'].includes(payload.role)) return null;
    return { id: payload.sub, name: String(payload.name).slice(0, 80), role: payload.role, exp: payload.exp };
  } catch { return null; }
}
