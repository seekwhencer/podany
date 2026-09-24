import { createHash, randomBytes } from 'node:crypto';

export function hashToken(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

export function generateToken(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}
