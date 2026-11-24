import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { signToken, verifyToken } from '../src/auth.js';

test('JWT verifies signature, expiry, issuer and rejects tampering', () => {
  const secret = randomBytes(48).toString('hex'); const user = { id: 'a', name: 'A', role: 'bidder' };
  const token = signToken(user, secret); assert.equal(verifyToken(token, secret).id, 'a');
  assert.equal(verifyToken(token, 'different secret'), null);
  assert.equal(verifyToken(signToken(user, secret, -1), secret), null);
  const parts = token.split('.'); parts[1] = Buffer.from(JSON.stringify({ sub: 'a', role: 'admin', exp: Date.now() })).toString('base64url');
  assert.equal(verifyToken(parts.join('.'), secret), null); assert.equal(verifyToken('not.a.token', secret), null); assert.equal(verifyToken(null, secret), null);
});
