// secret-dev-ed25519.spec.mts - the dev custody generator `ed25519-pem` (the sign-in package signs access tokens with EdDSA) writes a PKCS8 private key and an SPKI public key that sign and verify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { generateValues } from '../runtime/scripts/hfs/secret-dev-init.mjs';
import { GENERATORS } from '../runtime/scripts/hfs/stack-local-config.mjs';

test('ed25519-pem is a declared generator and yields a working Ed25519 pair', () => {
  assert.ok(GENERATORS.includes('ed25519-pem'));
  const values = generateValues({ member: 'auth', key: 'AUTH_JWT_PRIVATE_KEY', kind: 'ed25519-pem', publicKey: 'AUTH_JWT_PUBLIC_KEY' } as Parameters<typeof generateValues>[0]);
  const priv = createPrivateKey(values['AUTH_JWT_PRIVATE_KEY']!);
  const pub = createPublicKey(values['AUTH_JWT_PUBLIC_KEY']!);
  assert.equal(priv.asymmetricKeyType, 'ed25519');
  const signature = sign(null, Buffer.from('payload'), priv);
  assert.equal(verify(null, Buffer.from('payload'), pub, signature), true);
});
