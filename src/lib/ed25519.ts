// src/lib/ed25519.ts — thin wrapper re-exporting @noble/ed25519 (WS-LIB-01)
//
// NOTE: getPublicKeyAsync is wrapped (not re-exported directly) so that
// synchronous throws from the underlying library surface as rejected promises.
// The library throws synchronously for invalid-length keys before returning a
// Promise; callers use .rejects.toThrow() which requires a Promise rejection.
export { signAsync, verifyAsync, keygenAsync } from "@noble/ed25519";
import { getPublicKeyAsync as _getPublicKeyAsync } from "@noble/ed25519";

export async function getPublicKeyAsync(privateKey: Uint8Array): Promise<Uint8Array> {
  return _getPublicKeyAsync(privateKey);
}
