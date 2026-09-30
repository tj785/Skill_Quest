/** Tiny browser stand-in for the parts of node:crypto the server uses. */
import { sha256 } from '@noble/hashes/sha2.js';

class Bytes {
  constructor(private b: Uint8Array) {}
  toString(enc = 'hex') {
    if (enc === 'hex') return [...this.b].map((x) => x.toString(16).padStart(2, '0')).join('');
    const b64 = btoa(String.fromCharCode(...this.b));
    return enc === 'base64url' ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
  }
}
function randomBytes(n: number) { const b = new Uint8Array(n); crypto.getRandomValues(b); return new Bytes(b); }
function randomInt(a: number, b?: number) {
  const [min, max] = b === undefined ? [0, a] : [a, b];
  const u = new Uint32Array(1); crypto.getRandomValues(u);
  return min + (u[0] % (max - min));
}
function createHash(_alg: 'sha256') {
  let data = '';
  const h = { update(s: string) { data += s; return h; }, digest(enc = 'hex') { return new Bytes(sha256(new TextEncoder().encode(data))).toString(enc); } };
  return h;
}
export default { randomBytes, randomInt, createHash };
export { randomBytes, randomInt, createHash };
