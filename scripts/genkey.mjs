#!/usr/bin/env node
// OmniCode credential generator.
//   node scripts/genkey.mjs secret              -> a session secret for OMNICODE_SESSION_SECRET
//   node scripts/genkey.mjs key [user] [role]   -> a raw API key (give to the client) + the
//                                                  hashed record to paste into OMNICODE_API_KEYS
import crypto from 'crypto';

const cmd = process.argv[2];

if (cmd === 'secret') {
  console.log(crypto.randomBytes(32).toString('base64url'));
  process.exit(0);
}

if (cmd === 'key') {
  const user = process.argv[3] || 'user';
  const role = process.argv[4] || 'Read-Only';
  const validRoles = ['Admin', 'Developer', 'Read-Only'];
  if (!validRoles.includes(role)) {
    console.error(`Invalid role '${role}'. Use one of: ${validRoles.join(', ')}`);
    process.exit(1);
  }
  const rawKey = 'omni_' + crypto.randomBytes(24).toString('base64url');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  console.log('\nRaw API key (give this to the client ONCE — it is not recoverable):');
  console.log('  ' + rawKey);
  console.log('\nAdd this record to OMNICODE_API_KEYS (store only the hash):');
  console.log('  ' + JSON.stringify({ keyHash, user, role }));
  console.log('');
  process.exit(0);
}

console.error('Usage: node scripts/genkey.mjs <secret|key> [user] [role]');
process.exit(1);
