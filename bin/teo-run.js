#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/@noble/ed25519/index.js
var ed25519_CURVE, P, N, Gx, Gy, _a, _d, h, L, captureTrace, err, isBig, isStr, isBytes, abytes, u8n, u8fr, padh, bytesToHex, C, _ch, hexToBytes, cr, subtle, concatBytes, randomBytes, big, assertRange, M, P_MASK, modP, modN, invert, callHash, checkDigest, apoint, B256, Point, G, I, numTo32bLE, bytesToNumberLE, pow2, pow_2_252_3, RM1, uvRatio, modL_LE, sha512a, hash2extK, getExtendedPublicKeyAsync, getPublicKeyAsync, hashFinishA, _sign, signAsync, defaultVerifyOpts, _verify, verifyAsync, hashes, randomSecretKey, keygenAsync, W, scalarBits, pwindows, pwindowSize, precompute, Gpows, ctneg, wNAF;
var init_ed25519 = __esm({
  "node_modules/@noble/ed25519/index.js"() {
    ed25519_CURVE = Object.freeze({
      p: 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffedn,
      n: 0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3edn,
      h: 8n,
      a: 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffecn,
      d: 0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3n,
      Gx: 0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51an,
      Gy: 0x6666666666666666666666666666666666666666666666666666666666666658n
    });
    ({ p: P, n: N, Gx, Gy, a: _a, d: _d, h } = ed25519_CURVE);
    L = 32;
    captureTrace = (...args) => {
      if ("captureStackTrace" in Error && typeof Error.captureStackTrace === "function") {
        Error.captureStackTrace(...args);
      }
    };
    err = (message = "") => {
      const e = new Error(message);
      captureTrace(e, err);
      throw e;
    };
    isBig = (n) => typeof n === "bigint";
    isStr = (s) => typeof s === "string";
    isBytes = (a) => a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
    abytes = (value, length, title = "") => {
      const bytes = isBytes(value);
      const len = value?.length;
      const needsLen = length !== void 0;
      if (!bytes || needsLen && len !== length) {
        const prefix = title && `"${title}" `;
        const ofLen = needsLen ? ` of length ${length}` : "";
        const got = bytes ? `length=${len}` : `type=${typeof value}`;
        const msg = prefix + "expected Uint8Array" + ofLen + ", got " + got;
        throw bytes ? new RangeError(msg) : new TypeError(msg);
      }
      return value;
    };
    u8n = (len) => new Uint8Array(len);
    u8fr = (buf) => Uint8Array.from(buf);
    padh = (n, pad) => n.toString(16).padStart(pad, "0");
    bytesToHex = (b) => Array.from(abytes(b)).map((e) => padh(e, 2)).join("");
    C = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
    _ch = (ch) => {
      if (ch >= C._0 && ch <= C._9)
        return ch - C._0;
      if (ch >= C.A && ch <= C.F)
        return ch - (C.A - 10);
      if (ch >= C.a && ch <= C.f)
        return ch - (C.a - 10);
      return;
    };
    hexToBytes = (hex) => {
      const e = "hex invalid";
      if (!isStr(hex))
        return err(e);
      const hl = hex.length;
      const al = hl / 2;
      if (hl % 2)
        return err(e);
      const array = u8n(al);
      for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
        const n1 = _ch(hex.charCodeAt(hi));
        const n2 = _ch(hex.charCodeAt(hi + 1));
        if (n1 === void 0 || n2 === void 0)
          return err(e);
        array[ai] = n1 * 16 + n2;
      }
      return array;
    };
    cr = () => globalThis?.crypto;
    subtle = () => cr()?.subtle ?? err("crypto.subtle must be defined, consider polyfill");
    concatBytes = (...arrs) => {
      let len = 0;
      for (const a of arrs)
        len += abytes(a).length;
      const r = u8n(len);
      let pad = 0;
      arrs.forEach((a) => {
        r.set(a, pad);
        pad += a.length;
      });
      return r;
    };
    randomBytes = (len = L) => {
      const c = cr();
      return c.getRandomValues(u8n(len));
    };
    big = BigInt;
    assertRange = (n, min, max, msg = "bad number: out of range") => {
      if (!isBig(n))
        throw new TypeError(msg);
      if (min <= n && n < max)
        return n;
      throw new RangeError(msg);
    };
    M = (a, b = P) => {
      const r = a % b;
      return r >= 0n ? r : b + r;
    };
    P_MASK = (1n << 255n) - 1n;
    modP = (num) => {
      if (num < 0n)
        err("negative coordinate");
      let r = (num >> 255n) * 19n + (num & P_MASK);
      r = (r >> 255n) * 19n + (r & P_MASK);
      return r % P;
    };
    modN = (a) => M(a, N);
    invert = (num, md) => {
      if (num === 0n || md <= 0n)
        err("no inverse n=" + num + " mod=" + md);
      let a = M(num, md), b = md, x = 0n, y = 1n, u = 1n, v = 0n;
      while (a !== 0n) {
        const q = b / a, r = b % a;
        const m = x - u * q, n = y - v * q;
        b = a, a = r, x = u, y = v, u = m, v = n;
      }
      return b === 1n ? M(x, md) : err("no inverse");
    };
    callHash = (name) => {
      const fn = hashes[name];
      if (typeof fn !== "function")
        err("hashes." + name + " not set");
      return fn;
    };
    checkDigest = (value) => abytes(value, 64, "digest");
    apoint = (p) => p instanceof Point ? p : err("Point expected");
    B256 = 2n ** 256n;
    Point = class _Point {
      static BASE;
      static ZERO;
      X;
      Y;
      Z;
      T;
      // Constructor only bounds-checks and freezes XYZT coordinates; it does not prove the point is
      // on-curve or that T matches X*Y/Z.
      constructor(X, Y, Z, T) {
        const max = B256;
        this.X = assertRange(X, 0n, max);
        this.Y = assertRange(Y, 0n, max);
        this.Z = assertRange(Z, 1n, max);
        this.T = assertRange(T, 0n, max);
        Object.freeze(this);
      }
      static CURVE() {
        return ed25519_CURVE;
      }
      static fromAffine(p) {
        return new _Point(p.x, p.y, 1n, modP(p.x * p.y));
      }
      /** RFC8032 5.1.3: Bytes to Point. */
      static fromBytes(hex, zip215 = false) {
        const d = _d;
        const normed = u8fr(abytes(hex, L));
        const lastByte = hex[31];
        normed[31] = lastByte & ~128;
        const y = bytesToNumberLE(normed);
        const max = zip215 ? B256 : P;
        assertRange(y, 0n, max);
        const y2 = modP(y * y);
        const u = M(y2 - 1n);
        const v = modP(d * y2 + 1n);
        let { isValid: isValid2, value: x } = uvRatio(u, v);
        if (!isValid2)
          err("bad point: y not sqrt");
        const isXOdd = (x & 1n) === 1n;
        const isLastByteOdd = (lastByte & 128) !== 0;
        if (!zip215 && x === 0n && isLastByteOdd)
          err("bad point: x==0, isLastByteOdd");
        if (isLastByteOdd !== isXOdd)
          x = M(-x);
        return new _Point(x, y, 1n, modP(x * y));
      }
      static fromHex(hex, zip215) {
        return _Point.fromBytes(hexToBytes(hex), zip215);
      }
      get x() {
        return this.toAffine().x;
      }
      get y() {
        return this.toAffine().y;
      }
      /** Checks if the point is valid and on-curve. */
      assertValidity() {
        const a = _a;
        const d = _d;
        const p = this;
        if (p.is0())
          return err("bad point: ZERO");
        const { X, Y, Z, T } = p;
        const X2 = modP(X * X);
        const Y2 = modP(Y * Y);
        const Z2 = modP(Z * Z);
        const Z4 = modP(Z2 * Z2);
        const aX2 = modP(X2 * a);
        const left = modP(Z2 * (aX2 + Y2));
        const right = M(Z4 + modP(d * modP(X2 * Y2)));
        if (left !== right)
          return err("bad point: equation left != right (1)");
        const XY = modP(X * Y);
        const ZT = modP(Z * T);
        if (XY !== ZT)
          return err("bad point: equation left != right (2)");
        return this;
      }
      /** Equality check: compare points P&Q. */
      equals(other) {
        const { X: X1, Y: Y1, Z: Z1 } = this;
        const { X: X2, Y: Y2, Z: Z2 } = apoint(other);
        const X1Z2 = modP(X1 * Z2);
        const X2Z1 = modP(X2 * Z1);
        const Y1Z2 = modP(Y1 * Z2);
        const Y2Z1 = modP(Y2 * Z1);
        return X1Z2 === X2Z1 && Y1Z2 === Y2Z1;
      }
      is0() {
        return this.equals(I);
      }
      /** Flip point over y coordinate. */
      negate() {
        return new _Point(M(-this.X), this.Y, this.Z, M(-this.T));
      }
      /** Point doubling. Complete formula. Cost: `4M + 4S + 1*a + 6add + 1*2`. */
      double() {
        const { X: X1, Y: Y1, Z: Z1 } = this;
        const a = _a;
        const A = modP(X1 * X1);
        const B = modP(Y1 * Y1);
        const C2 = modP(2n * Z1 * Z1);
        const D = modP(a * A);
        const x1y1 = M(X1 + Y1);
        const E = M(modP(x1y1 * x1y1) - A - B);
        const G2 = M(D + B);
        const F = M(G2 - C2);
        const H = M(D - B);
        const X3 = modP(E * F);
        const Y3 = modP(G2 * H);
        const T3 = modP(E * H);
        const Z3 = modP(F * G2);
        return new _Point(X3, Y3, Z3, T3);
      }
      /** Point addition. Complete formula. Cost: `8M + 1*k + 8add + 1*2`. */
      add(other) {
        const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
        const { X: X2, Y: Y2, Z: Z2, T: T2 } = apoint(other);
        const a = _a;
        const d = _d;
        const A = modP(X1 * X2);
        const B = modP(Y1 * Y2);
        const C2 = modP(modP(T1 * d) * T2);
        const D = modP(Z1 * Z2);
        const E = M(modP(M(X1 + Y1) * M(X2 + Y2)) - A - B);
        const F = M(D - C2);
        const G2 = M(D + C2);
        const H = M(B - modP(a * A));
        const X3 = modP(E * F);
        const Y3 = modP(G2 * H);
        const T3 = modP(E * H);
        const Z3 = modP(F * G2);
        return new _Point(X3, Y3, Z3, T3);
      }
      subtract(other) {
        return this.add(apoint(other).negate());
      }
      /**
       * Point-by-scalar multiplication. Safe mode requires `1 <= n < CURVE.n`.
       * Unsafe mode additionally permits `n = 0` and returns the identity point for that case.
       * Uses {@link wNAF} for base point.
       * Uses fake point to mitigate side-channel leakage.
       * @param n - scalar by which point is multiplied
       * @param safe - safe mode guards against timing attacks; unsafe mode is faster
       */
      multiply(n, safe = true) {
        if (!safe && n === 0n)
          return I;
        assertRange(n, 1n, N);
        if (!safe && this.is0())
          return I;
        if (n === 1n)
          return this;
        if (this.equals(G))
          return wNAF(n).p;
        let p = I;
        let f = G;
        for (let d = this; n > 0n; d = d.double(), n >>= 1n) {
          if (n & 1n)
            p = p.add(d);
          else if (safe)
            f = f.add(d);
        }
        return p;
      }
      multiplyUnsafe(scalar) {
        return this.multiply(scalar, false);
      }
      /** Convert point to 2d xy affine point. (X, Y, Z) ∋ (x=X/Z, y=Y/Z) */
      toAffine() {
        const { X, Y, Z } = this;
        if (this.equals(I))
          return { x: 0n, y: 1n };
        const iz = invert(Z, P);
        if (modP(Z * iz) !== 1n)
          err("invalid inverse");
        const x = modP(X * iz);
        const y = modP(Y * iz);
        return { x, y };
      }
      toBytes() {
        const { x, y } = this.toAffine();
        const b = numTo32bLE(y);
        b[31] |= x & 1n ? 128 : 0;
        return b;
      }
      toHex() {
        return bytesToHex(this.toBytes());
      }
      clearCofactor() {
        return this.multiply(big(h), false);
      }
      isSmallOrder() {
        return this.clearCofactor().is0();
      }
      isTorsionFree() {
        let p = this.multiply(N / 2n, false).double();
        if (N % 2n)
          p = p.add(this);
        return p.is0();
      }
    };
    G = new Point(Gx, Gy, 1n, M(Gx * Gy));
    I = new Point(0n, 1n, 1n, 0n);
    Point.BASE = G;
    Point.ZERO = I;
    numTo32bLE = (num) => hexToBytes(padh(assertRange(num, 0n, B256), 64)).reverse();
    bytesToNumberLE = (b) => big("0x" + bytesToHex(u8fr(abytes(b)).reverse()));
    pow2 = (x, power) => {
      let r = x;
      while (power-- > 0n) {
        r = modP(r * r);
      }
      return r;
    };
    pow_2_252_3 = (x) => {
      const x2 = modP(x * x);
      const b2 = modP(x2 * x);
      const b4 = modP(pow2(b2, 2n) * b2);
      const b5 = modP(pow2(b4, 1n) * x);
      const b10 = modP(pow2(b5, 5n) * b5);
      const b20 = modP(pow2(b10, 10n) * b10);
      const b40 = modP(pow2(b20, 20n) * b20);
      const b80 = modP(pow2(b40, 40n) * b40);
      const b160 = modP(pow2(b80, 80n) * b80);
      const b240 = modP(pow2(b160, 80n) * b80);
      const b250 = modP(pow2(b240, 10n) * b10);
      const pow_p_5_8 = modP(pow2(b250, 2n) * x);
      return { pow_p_5_8, b2 };
    };
    RM1 = 0x2b8324804fc1df0b2b4d00993dfbd7a72f431806ad2fe478c4ee1b274a0ea0b0n;
    uvRatio = (u, v) => {
      const v3 = modP(v * modP(v * v));
      const v7 = modP(modP(v3 * v3) * v);
      const pow = pow_2_252_3(modP(u * v7)).pow_p_5_8;
      let x = modP(u * modP(v3 * pow));
      const vx2 = modP(v * modP(x * x));
      const root1 = x;
      const root2 = modP(x * RM1);
      const useRoot1 = vx2 === u;
      const useRoot2 = vx2 === M(-u);
      const noRoot = vx2 === M(-u * RM1);
      if (useRoot1)
        x = root1;
      if (useRoot2 || noRoot)
        x = root2;
      if ((M(x) & 1n) === 1n)
        x = M(-x);
      return { isValid: useRoot1 || useRoot2, value: x };
    };
    modL_LE = (hash) => modN(bytesToNumberLE(hash));
    sha512a = (...m) => Promise.resolve(callHash("sha512Async")(concatBytes(...m))).then(checkDigest);
    hash2extK = (hashed) => {
      const copy = u8fr(hashed);
      const head = copy.slice(0, 32);
      head[0] &= 248;
      head[31] &= 127;
      head[31] |= 64;
      const prefix = copy.slice(32, 64);
      const scalar = modL_LE(head);
      const point = G.multiply(scalar);
      const pointBytes = point.toBytes();
      return { head, prefix, scalar, point, pointBytes };
    };
    getExtendedPublicKeyAsync = (secretKey) => sha512a(abytes(secretKey, L)).then(hash2extK);
    getPublicKeyAsync = (secretKey) => getExtendedPublicKeyAsync(secretKey).then((p) => p.pointBytes);
    hashFinishA = (res) => sha512a(res.hashable).then(res.finish);
    _sign = (e, rBytes, msg) => {
      const { pointBytes: P2, scalar: s } = e;
      const r = modL_LE(rBytes);
      const R = G.multiply(r).toBytes();
      const hashable = concatBytes(R, P2, msg);
      const finish = (hashed) => {
        const S = modN(r + modL_LE(hashed) * s);
        return abytes(concatBytes(R, numTo32bLE(S)), 64);
      };
      return { hashable, finish };
    };
    signAsync = async (message, secretKey) => {
      const m = abytes(message);
      const e = await getExtendedPublicKeyAsync(secretKey);
      const rBytes = await sha512a(e.prefix, m);
      return hashFinishA(_sign(e, rBytes, m));
    };
    defaultVerifyOpts = { zip215: true };
    _verify = (sig, msg, publicKey, options = defaultVerifyOpts) => {
      sig = abytes(sig, 64);
      msg = abytes(msg);
      publicKey = abytes(publicKey, L);
      const { zip215 = true } = options;
      const r = sig.subarray(0, L);
      const s = bytesToNumberLE(sig.subarray(L, L * 2));
      let A, R, SB;
      let hashable = Uint8Array.of();
      let finished = false;
      try {
        A = Point.fromBytes(publicKey, zip215);
        R = Point.fromBytes(r, zip215);
        SB = G.multiply(s, false);
        hashable = concatBytes(r, publicKey, msg);
        finished = true;
      } catch (error) {
      }
      const finish = (hashed) => {
        if (!finished)
          return false;
        if (!zip215 && A.isSmallOrder())
          return false;
        const k = modL_LE(hashed);
        const RkA = R.add(A.multiply(k, false));
        return RkA.subtract(SB).clearCofactor().is0();
      };
      return { hashable, finish };
    };
    verifyAsync = async (signature, message, publicKey, opts = defaultVerifyOpts) => hashFinishA(_verify(signature, message, publicKey, opts));
    hashes = {
      sha512Async: async (message) => {
        const s = subtle();
        const m = concatBytes(message);
        return u8n(await s.digest("SHA-512", m.buffer));
      },
      sha512: void 0
    };
    randomSecretKey = (seed) => {
      seed = seed === void 0 ? randomBytes(L) : seed;
      return abytes(seed, L);
    };
    keygenAsync = async (seed) => {
      const secretKey = randomSecretKey(seed);
      const publicKey = await getPublicKeyAsync(secretKey);
      return { secretKey, publicKey };
    };
    W = 8;
    scalarBits = 256;
    pwindows = Math.ceil(scalarBits / W) + 1;
    pwindowSize = 2 ** (W - 1);
    precompute = () => {
      const points = [];
      let p = G;
      let b = p;
      for (let w = 0; w < pwindows; w++) {
        b = p;
        points.push(b);
        for (let i = 1; i < pwindowSize; i++) {
          b = b.add(p);
          points.push(b);
        }
        p = b.double();
      }
      return points;
    };
    Gpows = void 0;
    ctneg = (cnd, p) => {
      const n = p.negate();
      return cnd ? n : p;
    };
    wNAF = (n) => {
      const comp = Gpows || (Gpows = precompute());
      let p = I;
      let f = G;
      const pow_2_w = 2 ** W;
      const maxNum = pow_2_w;
      const mask = big(pow_2_w - 1);
      const shiftBy = big(W);
      for (let w = 0; w < pwindows; w++) {
        let wbits = Number(n & mask);
        n >>= shiftBy;
        if (wbits > pwindowSize) {
          wbits -= maxNum;
          n += 1n;
        }
        const off = w * pwindowSize;
        const offF = off;
        const offP = off + Math.abs(wbits) - 1;
        const isEven = w % 2 !== 0;
        const isNeg = wbits < 0;
        if (wbits === 0) {
          f = f.add(ctneg(isEven, comp[offF]));
        } else {
          p = p.add(ctneg(isNeg, comp[offP]));
        }
      }
      if (n !== 0n)
        err("invalid wnaf");
      return { p, f };
    };
  }
});

// src/lib/ed25519.ts
var ed25519_exports = {};
__export(ed25519_exports, {
  getPublicKeyAsync: () => getPublicKeyAsync2,
  keygenAsync: () => keygenAsync,
  signAsync: () => signAsync,
  verifyAsync: () => verifyAsync
});
async function getPublicKeyAsync2(privateKey) {
  return getPublicKeyAsync(privateKey);
}
var init_ed255192 = __esm({
  "src/lib/ed25519.ts"() {
    "use strict";
    init_ed25519();
    init_ed25519();
  }
});

// src/bootstrap/install-sig.ts
import * as fs from "node:fs";
import * as path from "node:path";
function readInstallSig(pluginRootPath) {
  const sigFilePath = path.join(pluginRootPath, INSTALL_SIG_FILENAME);
  let raw;
  try {
    raw = fs.readFileSync(sigFilePath, "utf8");
  } catch (err2) {
    const message = err2 instanceof Error ? err2.message : String(err2);
    return {
      ok: false,
      reason: `Install signature file not found or unreadable at "${sigFilePath}": ${message}`
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: `Install signature file at "${sigFilePath}" contains invalid JSON.`
    };
  }
  if (!isInstallSigFile(parsed)) {
    return {
      ok: false,
      reason: `Install signature file at "${sigFilePath}" has invalid shape: expected { key_id: string, signature: string }.`
    };
  }
  return { ok: true, file: parsed };
}
async function verifyInstallSig(pluginRootPath, sigFile, publicKey) {
  let canonicalPath;
  try {
    canonicalPath = fs.realpathSync(pluginRootPath);
  } catch (err2) {
    const message = err2 instanceof Error ? err2.message : String(err2);
    return {
      ok: false,
      reason: `Cannot resolve real path of plugin root "${pluginRootPath}": ${message}`
    };
  }
  const payloadBytes = new Uint8Array(Buffer.from(canonicalPath, "utf8"));
  let sigBytes;
  try {
    sigBytes = Buffer.from(sigFile.signature, "base64");
  } catch {
    return { ok: false, reason: "Install signature is not valid base64." };
  }
  if (sigBytes.length !== 64) {
    return {
      ok: false,
      reason: `Install signature has wrong length: expected 64 bytes, got ${sigBytes.length} bytes. ed25519 signatures are always exactly 64 bytes.`
    };
  }
  const pubKeyBytes = Buffer.from(publicKey);
  let valid;
  try {
    valid = await verifyAsync(
      new Uint8Array(sigBytes),
      payloadBytes,
      new Uint8Array(pubKeyBytes)
    );
  } catch (err2) {
    const message = err2 instanceof Error ? err2.message : String(err2);
    return { ok: false, reason: `Install signature verification error: ${message}` };
  }
  if (!valid) {
    return {
      ok: false,
      reason: `Install signature verification failed: the signature does not match the plugin root path "${canonicalPath}" with the provided public key.`
    };
  }
  return { ok: true };
}
function isInstallSigFile(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const obj = value;
  return typeof obj["key_id"] === "string" && typeof obj["signature"] === "string";
}
var INSTALL_SIG_FILENAME;
var init_install_sig = __esm({
  "src/bootstrap/install-sig.ts"() {
    "use strict";
    init_ed255192();
    INSTALL_SIG_FILENAME = ".teo-install-sig";
  }
});

// src/bootstrap/revocation.ts
function blocked(reason) {
  return { verdict: "BLOCKED", reason };
}
function isRevocationList(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const obj = value;
  return Array.isArray(obj["revoked_keys"]);
}
function makeFetchTimeout() {
  const p = new Promise(
    (_, reject) => setTimeout(
      () => reject(new Error(`Revocation list fetch timed out after ${REVOCATION_FETCH_TIMEOUT_MS}ms`)),
      REVOCATION_FETCH_TIMEOUT_MS
    )
  );
  p.catch(() => {
  });
  return p;
}
async function checkRevocationListOnly(keyId, revocationList, revocationListFetcher, fetchTimeout) {
  if (revocationList === void 0 && revocationListFetcher === void 0) {
    return blocked(
      "No revocation list source provided. Provide either revocationList or revocationListFetcher to verify the key."
    );
  }
  let resolvedList;
  if (revocationList !== void 0) {
    resolvedList = revocationList;
  } else {
    const timeoutPromise = fetchTimeout ?? makeFetchTimeout();
    let fetched;
    try {
      fetched = await Promise.race([revocationListFetcher(), timeoutPromise]);
    } catch (err2) {
      const message = err2 instanceof Error ? err2.message : String(err2);
      return blocked(`Revocation list fetch failed: ${message}`);
    }
    if (!isRevocationList(fetched)) {
      const fetchedType = typeof fetched;
      const fetchedDesc = fetchedType === "object" && fetched !== null ? `object with keys: [${Object.keys(fetched).join(", ")}]` : String(fetched);
      return blocked(
        `Revocation list has invalid shape: expected { revoked_keys: Array }, got ${fetchedDesc}.`
      );
    }
    resolvedList = fetched;
  }
  const revokedEntry = resolvedList.revoked_keys.find((entry) => entry.key_id === keyId);
  if (revokedEntry !== void 0) {
    const detail = revokedEntry.reason ? `: ${revokedEntry.reason}` : "";
    return blocked(`Key "${keyId}" has been revoked${detail}.`);
  }
  return { verdict: "PASS" };
}
async function checkRevocation(opts) {
  const { data, signature, publicKey, keyId, revocationList, revocationListFetcher } = opts;
  const pluginRoot = process.env["CLAUDE_PLUGIN_ROOT"];
  const isPluginContext = typeof pluginRoot === "string" && pluginRoot.length > 0;
  if ((signature === void 0 || signature === null) && isPluginContext) {
    const fetchTimeout = revocationListFetcher !== void 0 ? makeFetchTimeout() : void 0;
    const readResult = readInstallSig(pluginRoot);
    if (!readResult.ok) {
      return blocked(readResult.reason);
    }
    const verifyResult = await verifyInstallSig(pluginRoot, readResult.file, publicKey);
    if (!verifyResult.ok) {
      return blocked(verifyResult.reason);
    }
    const installKeyId = readResult.file.key_id;
    return checkRevocationListOnly(
      installKeyId,
      revocationList,
      revocationListFetcher,
      fetchTimeout
    );
  }
  if (signature === void 0 || signature === null) {
    return blocked("Signature is missing (undefined or null). Cannot verify without a signature.");
  }
  const sigBytes = Buffer.from(signature);
  if (sigBytes.length === 0) {
    return blocked("Signature is empty (zero bytes). Cannot verify without a signature.");
  }
  if (sigBytes.length !== 64) {
    return blocked(
      `Signature has wrong length: expected 64 bytes, got ${sigBytes.length} bytes. ed25519 signatures are always exactly 64 bytes.`
    );
  }
  if (revocationList === void 0 && revocationListFetcher === void 0) {
    return blocked(
      "No revocation list source provided. Provide either revocationList or revocationListFetcher to verify the key."
    );
  }
  let resolvedList;
  if (revocationList !== void 0) {
    resolvedList = revocationList;
  } else {
    const timeoutPromise = makeFetchTimeout();
    let fetched;
    try {
      fetched = await Promise.race([revocationListFetcher(), timeoutPromise]);
    } catch (err2) {
      const message = err2 instanceof Error ? err2.message : String(err2);
      return blocked(`Revocation list fetch failed: ${message}`);
    }
    if (!isRevocationList(fetched)) {
      const fetchedType = typeof fetched;
      const fetchedDesc = fetchedType === "object" && fetched !== null ? `object with keys: [${Object.keys(fetched).join(", ")}]` : String(fetched);
      return blocked(
        `Revocation list has invalid shape: expected { revoked_keys: Array }, got ${fetchedDesc}.`
      );
    }
    resolvedList = fetched;
  }
  const revokedEntry = resolvedList.revoked_keys.find((entry) => entry.key_id === keyId);
  if (revokedEntry !== void 0) {
    const detail = revokedEntry.reason ? `: ${revokedEntry.reason}` : "";
    return blocked(`Key "${keyId}" has been revoked${detail}.`);
  }
  const dataBytes = Buffer.from(data);
  const pubKeyBytes = Buffer.from(publicKey);
  let valid;
  try {
    valid = await verifyAsync(sigBytes, dataBytes, pubKeyBytes);
  } catch (err2) {
    const message = err2 instanceof Error ? err2.message : String(err2);
    return blocked(`Signature verification error: ${message}`);
  }
  if (!valid) {
    return blocked(
      "Signature verification failed: the signature does not match the provided data and public key."
    );
  }
  return { verdict: "PASS" };
}
var REVOCATION_FETCH_TIMEOUT_MS;
var init_revocation = __esm({
  "src/bootstrap/revocation.ts"() {
    "use strict";
    init_ed255192();
    init_install_sig();
    REVOCATION_FETCH_TIMEOUT_MS = 5e3;
  }
});

// src/bootstrap/host.ts
function detectHost() {
  const pluginRoot = process.env["CLAUDE_PLUGIN_ROOT"];
  if (pluginRoot && pluginRoot.length > 0) {
    const dataDir = process.env["CLAUDE_PLUGIN_DATA"];
    const result = {
      kind: "claude-code-plugin",
      pluginRoot
    };
    if (dataDir !== void 0) {
      result.dataDir = dataDir;
    }
    return result;
  }
  return { kind: "standalone" };
}
var init_host = __esm({
  "src/bootstrap/host.ts"() {
    "use strict";
  }
});

// node_modules/zod/v3/helpers/util.js
var util, objectUtil, ZodParsedType, getParsedType;
var init_util = __esm({
  "node_modules/zod/v3/helpers/util.js"() {
    (function(util2) {
      util2.assertEqual = (_) => {
      };
      function assertIs(_arg) {
      }
      util2.assertIs = assertIs;
      function assertNever(_x) {
        throw new Error();
      }
      util2.assertNever = assertNever;
      util2.arrayToEnum = (items) => {
        const obj = {};
        for (const item of items) {
          obj[item] = item;
        }
        return obj;
      };
      util2.getValidEnumValues = (obj) => {
        const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
        const filtered = {};
        for (const k of validKeys) {
          filtered[k] = obj[k];
        }
        return util2.objectValues(filtered);
      };
      util2.objectValues = (obj) => {
        return util2.objectKeys(obj).map(function(e) {
          return obj[e];
        });
      };
      util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
        const keys = [];
        for (const key in object) {
          if (Object.prototype.hasOwnProperty.call(object, key)) {
            keys.push(key);
          }
        }
        return keys;
      };
      util2.find = (arr, checker) => {
        for (const item of arr) {
          if (checker(item))
            return item;
        }
        return void 0;
      };
      util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
      function joinValues(array, separator = " | ") {
        return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
      }
      util2.joinValues = joinValues;
      util2.jsonStringifyReplacer = (_, value) => {
        if (typeof value === "bigint") {
          return value.toString();
        }
        return value;
      };
    })(util || (util = {}));
    (function(objectUtil2) {
      objectUtil2.mergeShapes = (first, second) => {
        return {
          ...first,
          ...second
          // second overwrites first
        };
      };
    })(objectUtil || (objectUtil = {}));
    ZodParsedType = util.arrayToEnum([
      "string",
      "nan",
      "number",
      "integer",
      "float",
      "boolean",
      "date",
      "bigint",
      "symbol",
      "function",
      "undefined",
      "null",
      "array",
      "object",
      "unknown",
      "promise",
      "void",
      "never",
      "map",
      "set"
    ]);
    getParsedType = (data) => {
      const t = typeof data;
      switch (t) {
        case "undefined":
          return ZodParsedType.undefined;
        case "string":
          return ZodParsedType.string;
        case "number":
          return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
        case "boolean":
          return ZodParsedType.boolean;
        case "function":
          return ZodParsedType.function;
        case "bigint":
          return ZodParsedType.bigint;
        case "symbol":
          return ZodParsedType.symbol;
        case "object":
          if (Array.isArray(data)) {
            return ZodParsedType.array;
          }
          if (data === null) {
            return ZodParsedType.null;
          }
          if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
            return ZodParsedType.promise;
          }
          if (typeof Map !== "undefined" && data instanceof Map) {
            return ZodParsedType.map;
          }
          if (typeof Set !== "undefined" && data instanceof Set) {
            return ZodParsedType.set;
          }
          if (typeof Date !== "undefined" && data instanceof Date) {
            return ZodParsedType.date;
          }
          return ZodParsedType.object;
        default:
          return ZodParsedType.unknown;
      }
    };
  }
});

// node_modules/zod/v3/ZodError.js
var ZodIssueCode, quotelessJson, ZodError;
var init_ZodError = __esm({
  "node_modules/zod/v3/ZodError.js"() {
    init_util();
    ZodIssueCode = util.arrayToEnum([
      "invalid_type",
      "invalid_literal",
      "custom",
      "invalid_union",
      "invalid_union_discriminator",
      "invalid_enum_value",
      "unrecognized_keys",
      "invalid_arguments",
      "invalid_return_type",
      "invalid_date",
      "invalid_string",
      "too_small",
      "too_big",
      "invalid_intersection_types",
      "not_multiple_of",
      "not_finite"
    ]);
    quotelessJson = (obj) => {
      const json = JSON.stringify(obj, null, 2);
      return json.replace(/"([^"]+)":/g, "$1:");
    };
    ZodError = class _ZodError extends Error {
      get errors() {
        return this.issues;
      }
      constructor(issues) {
        super();
        this.issues = [];
        this.addIssue = (sub) => {
          this.issues = [...this.issues, sub];
        };
        this.addIssues = (subs = []) => {
          this.issues = [...this.issues, ...subs];
        };
        const actualProto = new.target.prototype;
        if (Object.setPrototypeOf) {
          Object.setPrototypeOf(this, actualProto);
        } else {
          this.__proto__ = actualProto;
        }
        this.name = "ZodError";
        this.issues = issues;
      }
      format(_mapper) {
        const mapper = _mapper || function(issue) {
          return issue.message;
        };
        const fieldErrors = { _errors: [] };
        const processError = (error) => {
          for (const issue of error.issues) {
            if (issue.code === "invalid_union") {
              issue.unionErrors.map(processError);
            } else if (issue.code === "invalid_return_type") {
              processError(issue.returnTypeError);
            } else if (issue.code === "invalid_arguments") {
              processError(issue.argumentsError);
            } else if (issue.path.length === 0) {
              fieldErrors._errors.push(mapper(issue));
            } else {
              let curr = fieldErrors;
              let i = 0;
              while (i < issue.path.length) {
                const el = issue.path[i];
                const terminal = i === issue.path.length - 1;
                if (!terminal) {
                  curr[el] = curr[el] || { _errors: [] };
                } else {
                  curr[el] = curr[el] || { _errors: [] };
                  curr[el]._errors.push(mapper(issue));
                }
                curr = curr[el];
                i++;
              }
            }
          }
        };
        processError(this);
        return fieldErrors;
      }
      static assert(value) {
        if (!(value instanceof _ZodError)) {
          throw new Error(`Not a ZodError: ${value}`);
        }
      }
      toString() {
        return this.message;
      }
      get message() {
        return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
      }
      get isEmpty() {
        return this.issues.length === 0;
      }
      flatten(mapper = (issue) => issue.message) {
        const fieldErrors = {};
        const formErrors = [];
        for (const sub of this.issues) {
          if (sub.path.length > 0) {
            const firstEl = sub.path[0];
            fieldErrors[firstEl] = fieldErrors[firstEl] || [];
            fieldErrors[firstEl].push(mapper(sub));
          } else {
            formErrors.push(mapper(sub));
          }
        }
        return { formErrors, fieldErrors };
      }
      get formErrors() {
        return this.flatten();
      }
    };
    ZodError.create = (issues) => {
      const error = new ZodError(issues);
      return error;
    };
  }
});

// node_modules/zod/v3/locales/en.js
var errorMap, en_default;
var init_en = __esm({
  "node_modules/zod/v3/locales/en.js"() {
    init_ZodError();
    init_util();
    errorMap = (issue, _ctx) => {
      let message;
      switch (issue.code) {
        case ZodIssueCode.invalid_type:
          if (issue.received === ZodParsedType.undefined) {
            message = "Required";
          } else {
            message = `Expected ${issue.expected}, received ${issue.received}`;
          }
          break;
        case ZodIssueCode.invalid_literal:
          message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
          break;
        case ZodIssueCode.unrecognized_keys:
          message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
          break;
        case ZodIssueCode.invalid_union:
          message = `Invalid input`;
          break;
        case ZodIssueCode.invalid_union_discriminator:
          message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
          break;
        case ZodIssueCode.invalid_enum_value:
          message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
          break;
        case ZodIssueCode.invalid_arguments:
          message = `Invalid function arguments`;
          break;
        case ZodIssueCode.invalid_return_type:
          message = `Invalid function return type`;
          break;
        case ZodIssueCode.invalid_date:
          message = `Invalid date`;
          break;
        case ZodIssueCode.invalid_string:
          if (typeof issue.validation === "object") {
            if ("includes" in issue.validation) {
              message = `Invalid input: must include "${issue.validation.includes}"`;
              if (typeof issue.validation.position === "number") {
                message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
              }
            } else if ("startsWith" in issue.validation) {
              message = `Invalid input: must start with "${issue.validation.startsWith}"`;
            } else if ("endsWith" in issue.validation) {
              message = `Invalid input: must end with "${issue.validation.endsWith}"`;
            } else {
              util.assertNever(issue.validation);
            }
          } else if (issue.validation !== "regex") {
            message = `Invalid ${issue.validation}`;
          } else {
            message = "Invalid";
          }
          break;
        case ZodIssueCode.too_small:
          if (issue.type === "array")
            message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
          else if (issue.type === "string")
            message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
          else if (issue.type === "number")
            message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
          else if (issue.type === "bigint")
            message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
          else if (issue.type === "date")
            message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
          else
            message = "Invalid input";
          break;
        case ZodIssueCode.too_big:
          if (issue.type === "array")
            message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
          else if (issue.type === "string")
            message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
          else if (issue.type === "number")
            message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
          else if (issue.type === "bigint")
            message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
          else if (issue.type === "date")
            message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
          else
            message = "Invalid input";
          break;
        case ZodIssueCode.custom:
          message = `Invalid input`;
          break;
        case ZodIssueCode.invalid_intersection_types:
          message = `Intersection results could not be merged`;
          break;
        case ZodIssueCode.not_multiple_of:
          message = `Number must be a multiple of ${issue.multipleOf}`;
          break;
        case ZodIssueCode.not_finite:
          message = "Number must be finite";
          break;
        default:
          message = _ctx.defaultError;
          util.assertNever(issue);
      }
      return { message };
    };
    en_default = errorMap;
  }
});

// node_modules/zod/v3/errors.js
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}
var overrideErrorMap;
var init_errors = __esm({
  "node_modules/zod/v3/errors.js"() {
    init_en();
    overrideErrorMap = en_default;
  }
});

// node_modules/zod/v3/helpers/parseUtil.js
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var makeIssue, EMPTY_PATH, ParseStatus, INVALID, DIRTY, OK, isAborted, isDirty, isValid, isAsync;
var init_parseUtil = __esm({
  "node_modules/zod/v3/helpers/parseUtil.js"() {
    init_errors();
    init_en();
    makeIssue = (params) => {
      const { data, path: path8, errorMaps, issueData } = params;
      const fullPath = [...path8, ...issueData.path || []];
      const fullIssue = {
        ...issueData,
        path: fullPath
      };
      if (issueData.message !== void 0) {
        return {
          ...issueData,
          path: fullPath,
          message: issueData.message
        };
      }
      let errorMessage = "";
      const maps = errorMaps.filter((m) => !!m).slice().reverse();
      for (const map of maps) {
        errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
      }
      return {
        ...issueData,
        path: fullPath,
        message: errorMessage
      };
    };
    EMPTY_PATH = [];
    ParseStatus = class _ParseStatus {
      constructor() {
        this.value = "valid";
      }
      dirty() {
        if (this.value === "valid")
          this.value = "dirty";
      }
      abort() {
        if (this.value !== "aborted")
          this.value = "aborted";
      }
      static mergeArray(status, results) {
        const arrayValue = [];
        for (const s of results) {
          if (s.status === "aborted")
            return INVALID;
          if (s.status === "dirty")
            status.dirty();
          arrayValue.push(s.value);
        }
        return { status: status.value, value: arrayValue };
      }
      static async mergeObjectAsync(status, pairs) {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value
          });
        }
        return _ParseStatus.mergeObjectSync(status, syncPairs);
      }
      static mergeObjectSync(status, pairs) {
        const finalObject = {};
        for (const pair of pairs) {
          const { key, value } = pair;
          if (key.status === "aborted")
            return INVALID;
          if (value.status === "aborted")
            return INVALID;
          if (key.status === "dirty")
            status.dirty();
          if (value.status === "dirty")
            status.dirty();
          if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
            finalObject[key.value] = value.value;
          }
        }
        return { status: status.value, value: finalObject };
      }
    };
    INVALID = Object.freeze({
      status: "aborted"
    });
    DIRTY = (value) => ({ status: "dirty", value });
    OK = (value) => ({ status: "valid", value });
    isAborted = (x) => x.status === "aborted";
    isDirty = (x) => x.status === "dirty";
    isValid = (x) => x.status === "valid";
    isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
  }
});

// node_modules/zod/v3/helpers/typeAliases.js
var init_typeAliases = __esm({
  "node_modules/zod/v3/helpers/typeAliases.js"() {
  }
});

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
var init_errorUtil = __esm({
  "node_modules/zod/v3/helpers/errorUtil.js"() {
    (function(errorUtil2) {
      errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
      errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
    })(errorUtil || (errorUtil = {}));
  }
});

// node_modules/zod/v3/types.js
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var ParseInputLazyPath, handleResult, ZodType, cuidRegex, cuid2Regex, ulidRegex, uuidRegex, nanoidRegex, jwtRegex, durationRegex, emailRegex, _emojiRegex, emojiRegex, ipv4Regex, ipv4CidrRegex, ipv6Regex, ipv6CidrRegex, base64Regex, base64urlRegex, dateRegexSource, dateRegex, ZodString, ZodNumber, ZodBigInt, ZodBoolean, ZodDate, ZodSymbol, ZodUndefined, ZodNull, ZodAny, ZodUnknown, ZodNever, ZodVoid, ZodArray, ZodObject, ZodUnion, getDiscriminator, ZodDiscriminatedUnion, ZodIntersection, ZodTuple, ZodRecord, ZodMap, ZodSet, ZodFunction, ZodLazy, ZodLiteral, ZodEnum, ZodNativeEnum, ZodPromise, ZodEffects, ZodOptional, ZodNullable, ZodDefault, ZodCatch, ZodNaN, BRAND, ZodBranded, ZodPipeline, ZodReadonly, late, ZodFirstPartyTypeKind, instanceOfType, stringType, numberType, nanType, bigIntType, booleanType, dateType, symbolType, undefinedType, nullType, anyType, unknownType, neverType, voidType, arrayType, objectType, strictObjectType, unionType, discriminatedUnionType, intersectionType, tupleType, recordType, mapType, setType, functionType, lazyType, literalType, enumType, nativeEnumType, promiseType, effectsType, optionalType, nullableType, preprocessType, pipelineType, ostring, onumber, oboolean, coerce, NEVER;
var init_types = __esm({
  "node_modules/zod/v3/types.js"() {
    init_ZodError();
    init_errors();
    init_errorUtil();
    init_parseUtil();
    init_util();
    ParseInputLazyPath = class {
      constructor(parent, value, path8, key) {
        this._cachedPath = [];
        this.parent = parent;
        this.data = value;
        this._path = path8;
        this._key = key;
      }
      get path() {
        if (!this._cachedPath.length) {
          if (Array.isArray(this._key)) {
            this._cachedPath.push(...this._path, ...this._key);
          } else {
            this._cachedPath.push(...this._path, this._key);
          }
        }
        return this._cachedPath;
      }
    };
    handleResult = (ctx, result) => {
      if (isValid(result)) {
        return { success: true, data: result.value };
      } else {
        if (!ctx.common.issues.length) {
          throw new Error("Validation failed but no issues detected.");
        }
        return {
          success: false,
          get error() {
            if (this._error)
              return this._error;
            const error = new ZodError(ctx.common.issues);
            this._error = error;
            return this._error;
          }
        };
      }
    };
    ZodType = class {
      get description() {
        return this._def.description;
      }
      _getType(input) {
        return getParsedType(input.data);
      }
      _getOrReturnCtx(input, ctx) {
        return ctx || {
          common: input.parent.common,
          data: input.data,
          parsedType: getParsedType(input.data),
          schemaErrorMap: this._def.errorMap,
          path: input.path,
          parent: input.parent
        };
      }
      _processInputParams(input) {
        return {
          status: new ParseStatus(),
          ctx: {
            common: input.parent.common,
            data: input.data,
            parsedType: getParsedType(input.data),
            schemaErrorMap: this._def.errorMap,
            path: input.path,
            parent: input.parent
          }
        };
      }
      _parseSync(input) {
        const result = this._parse(input);
        if (isAsync(result)) {
          throw new Error("Synchronous parse encountered promise.");
        }
        return result;
      }
      _parseAsync(input) {
        const result = this._parse(input);
        return Promise.resolve(result);
      }
      parse(data, params) {
        const result = this.safeParse(data, params);
        if (result.success)
          return result.data;
        throw result.error;
      }
      safeParse(data, params) {
        const ctx = {
          common: {
            issues: [],
            async: params?.async ?? false,
            contextualErrorMap: params?.errorMap
          },
          path: params?.path || [],
          schemaErrorMap: this._def.errorMap,
          parent: null,
          data,
          parsedType: getParsedType(data)
        };
        const result = this._parseSync({ data, path: ctx.path, parent: ctx });
        return handleResult(ctx, result);
      }
      "~validate"(data) {
        const ctx = {
          common: {
            issues: [],
            async: !!this["~standard"].async
          },
          path: [],
          schemaErrorMap: this._def.errorMap,
          parent: null,
          data,
          parsedType: getParsedType(data)
        };
        if (!this["~standard"].async) {
          try {
            const result = this._parseSync({ data, path: [], parent: ctx });
            return isValid(result) ? {
              value: result.value
            } : {
              issues: ctx.common.issues
            };
          } catch (err2) {
            if (err2?.message?.toLowerCase()?.includes("encountered")) {
              this["~standard"].async = true;
            }
            ctx.common = {
              issues: [],
              async: true
            };
          }
        }
        return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        });
      }
      async parseAsync(data, params) {
        const result = await this.safeParseAsync(data, params);
        if (result.success)
          return result.data;
        throw result.error;
      }
      async safeParseAsync(data, params) {
        const ctx = {
          common: {
            issues: [],
            contextualErrorMap: params?.errorMap,
            async: true
          },
          path: params?.path || [],
          schemaErrorMap: this._def.errorMap,
          parent: null,
          data,
          parsedType: getParsedType(data)
        };
        const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
        const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
        return handleResult(ctx, result);
      }
      refine(check, message) {
        const getIssueProperties = (val) => {
          if (typeof message === "string" || typeof message === "undefined") {
            return { message };
          } else if (typeof message === "function") {
            return message(val);
          } else {
            return message;
          }
        };
        return this._refinement((val, ctx) => {
          const result = check(val);
          const setError = () => ctx.addIssue({
            code: ZodIssueCode.custom,
            ...getIssueProperties(val)
          });
          if (typeof Promise !== "undefined" && result instanceof Promise) {
            return result.then((data) => {
              if (!data) {
                setError();
                return false;
              } else {
                return true;
              }
            });
          }
          if (!result) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      refinement(check, refinementData) {
        return this._refinement((val, ctx) => {
          if (!check(val)) {
            ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
            return false;
          } else {
            return true;
          }
        });
      }
      _refinement(refinement) {
        return new ZodEffects({
          schema: this,
          typeName: ZodFirstPartyTypeKind.ZodEffects,
          effect: { type: "refinement", refinement }
        });
      }
      superRefine(refinement) {
        return this._refinement(refinement);
      }
      constructor(def) {
        this.spa = this.safeParseAsync;
        this._def = def;
        this.parse = this.parse.bind(this);
        this.safeParse = this.safeParse.bind(this);
        this.parseAsync = this.parseAsync.bind(this);
        this.safeParseAsync = this.safeParseAsync.bind(this);
        this.spa = this.spa.bind(this);
        this.refine = this.refine.bind(this);
        this.refinement = this.refinement.bind(this);
        this.superRefine = this.superRefine.bind(this);
        this.optional = this.optional.bind(this);
        this.nullable = this.nullable.bind(this);
        this.nullish = this.nullish.bind(this);
        this.array = this.array.bind(this);
        this.promise = this.promise.bind(this);
        this.or = this.or.bind(this);
        this.and = this.and.bind(this);
        this.transform = this.transform.bind(this);
        this.brand = this.brand.bind(this);
        this.default = this.default.bind(this);
        this.catch = this.catch.bind(this);
        this.describe = this.describe.bind(this);
        this.pipe = this.pipe.bind(this);
        this.readonly = this.readonly.bind(this);
        this.isNullable = this.isNullable.bind(this);
        this.isOptional = this.isOptional.bind(this);
        this["~standard"] = {
          version: 1,
          vendor: "zod",
          validate: (data) => this["~validate"](data)
        };
      }
      optional() {
        return ZodOptional.create(this, this._def);
      }
      nullable() {
        return ZodNullable.create(this, this._def);
      }
      nullish() {
        return this.nullable().optional();
      }
      array() {
        return ZodArray.create(this);
      }
      promise() {
        return ZodPromise.create(this, this._def);
      }
      or(option) {
        return ZodUnion.create([this, option], this._def);
      }
      and(incoming) {
        return ZodIntersection.create(this, incoming, this._def);
      }
      transform(transform) {
        return new ZodEffects({
          ...processCreateParams(this._def),
          schema: this,
          typeName: ZodFirstPartyTypeKind.ZodEffects,
          effect: { type: "transform", transform }
        });
      }
      default(def) {
        const defaultValueFunc = typeof def === "function" ? def : () => def;
        return new ZodDefault({
          ...processCreateParams(this._def),
          innerType: this,
          defaultValue: defaultValueFunc,
          typeName: ZodFirstPartyTypeKind.ZodDefault
        });
      }
      brand() {
        return new ZodBranded({
          typeName: ZodFirstPartyTypeKind.ZodBranded,
          type: this,
          ...processCreateParams(this._def)
        });
      }
      catch(def) {
        const catchValueFunc = typeof def === "function" ? def : () => def;
        return new ZodCatch({
          ...processCreateParams(this._def),
          innerType: this,
          catchValue: catchValueFunc,
          typeName: ZodFirstPartyTypeKind.ZodCatch
        });
      }
      describe(description) {
        const This = this.constructor;
        return new This({
          ...this._def,
          description
        });
      }
      pipe(target) {
        return ZodPipeline.create(this, target);
      }
      readonly() {
        return ZodReadonly.create(this);
      }
      isOptional() {
        return this.safeParse(void 0).success;
      }
      isNullable() {
        return this.safeParse(null).success;
      }
    };
    cuidRegex = /^c[^\s-]{8,}$/i;
    cuid2Regex = /^[0-9a-z]+$/;
    ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
    uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
    nanoidRegex = /^[a-z0-9_-]{21}$/i;
    jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
    durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
    emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
    _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
    ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
    ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
    ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
    ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
    base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
    base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
    dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
    dateRegex = new RegExp(`^${dateRegexSource}$`);
    ZodString = class _ZodString extends ZodType {
      _parse(input) {
        if (this._def.coerce) {
          input.data = String(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.string) {
          const ctx2 = this._getOrReturnCtx(input);
          addIssueToContext(ctx2, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.string,
            received: ctx2.parsedType
          });
          return INVALID;
        }
        const status = new ParseStatus();
        let ctx = void 0;
        for (const check of this._def.checks) {
          if (check.kind === "min") {
            if (input.data.length < check.value) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_small,
                minimum: check.value,
                type: "string",
                inclusive: true,
                exact: false,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "max") {
            if (input.data.length > check.value) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_big,
                maximum: check.value,
                type: "string",
                inclusive: true,
                exact: false,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "length") {
            const tooBig = input.data.length > check.value;
            const tooSmall = input.data.length < check.value;
            if (tooBig || tooSmall) {
              ctx = this._getOrReturnCtx(input, ctx);
              if (tooBig) {
                addIssueToContext(ctx, {
                  code: ZodIssueCode.too_big,
                  maximum: check.value,
                  type: "string",
                  inclusive: true,
                  exact: true,
                  message: check.message
                });
              } else if (tooSmall) {
                addIssueToContext(ctx, {
                  code: ZodIssueCode.too_small,
                  minimum: check.value,
                  type: "string",
                  inclusive: true,
                  exact: true,
                  message: check.message
                });
              }
              status.dirty();
            }
          } else if (check.kind === "email") {
            if (!emailRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "email",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "emoji") {
            if (!emojiRegex) {
              emojiRegex = new RegExp(_emojiRegex, "u");
            }
            if (!emojiRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "emoji",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "uuid") {
            if (!uuidRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "uuid",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "nanoid") {
            if (!nanoidRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "nanoid",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "cuid") {
            if (!cuidRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "cuid",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "cuid2") {
            if (!cuid2Regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "cuid2",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "ulid") {
            if (!ulidRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "ulid",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "url") {
            try {
              new URL(input.data);
            } catch {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "url",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "regex") {
            check.regex.lastIndex = 0;
            const testResult = check.regex.test(input.data);
            if (!testResult) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "regex",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "trim") {
            input.data = input.data.trim();
          } else if (check.kind === "includes") {
            if (!input.data.includes(check.value, check.position)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: { includes: check.value, position: check.position },
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "toLowerCase") {
            input.data = input.data.toLowerCase();
          } else if (check.kind === "toUpperCase") {
            input.data = input.data.toUpperCase();
          } else if (check.kind === "startsWith") {
            if (!input.data.startsWith(check.value)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: { startsWith: check.value },
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "endsWith") {
            if (!input.data.endsWith(check.value)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: { endsWith: check.value },
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "datetime") {
            const regex = datetimeRegex(check);
            if (!regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: "datetime",
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "date") {
            const regex = dateRegex;
            if (!regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: "date",
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "time") {
            const regex = timeRegex(check);
            if (!regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: "time",
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "duration") {
            if (!durationRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "duration",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "ip") {
            if (!isValidIP(input.data, check.version)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "ip",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "jwt") {
            if (!isValidJWT(input.data, check.alg)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "jwt",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "cidr") {
            if (!isValidCidr(input.data, check.version)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "cidr",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "base64") {
            if (!base64Regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "base64",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "base64url") {
            if (!base64urlRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "base64url",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else {
            util.assertNever(check);
          }
        }
        return { status: status.value, value: input.data };
      }
      _regex(regex, validation, message) {
        return this.refinement((data) => regex.test(data), {
          validation,
          code: ZodIssueCode.invalid_string,
          ...errorUtil.errToObj(message)
        });
      }
      _addCheck(check) {
        return new _ZodString({
          ...this._def,
          checks: [...this._def.checks, check]
        });
      }
      email(message) {
        return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
      }
      url(message) {
        return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
      }
      emoji(message) {
        return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
      }
      uuid(message) {
        return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
      }
      nanoid(message) {
        return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
      }
      cuid(message) {
        return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
      }
      cuid2(message) {
        return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
      }
      ulid(message) {
        return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
      }
      base64(message) {
        return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
      }
      base64url(message) {
        return this._addCheck({
          kind: "base64url",
          ...errorUtil.errToObj(message)
        });
      }
      jwt(options) {
        return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
      }
      ip(options) {
        return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
      }
      cidr(options) {
        return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
      }
      datetime(options) {
        if (typeof options === "string") {
          return this._addCheck({
            kind: "datetime",
            precision: null,
            offset: false,
            local: false,
            message: options
          });
        }
        return this._addCheck({
          kind: "datetime",
          precision: typeof options?.precision === "undefined" ? null : options?.precision,
          offset: options?.offset ?? false,
          local: options?.local ?? false,
          ...errorUtil.errToObj(options?.message)
        });
      }
      date(message) {
        return this._addCheck({ kind: "date", message });
      }
      time(options) {
        if (typeof options === "string") {
          return this._addCheck({
            kind: "time",
            precision: null,
            message: options
          });
        }
        return this._addCheck({
          kind: "time",
          precision: typeof options?.precision === "undefined" ? null : options?.precision,
          ...errorUtil.errToObj(options?.message)
        });
      }
      duration(message) {
        return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
      }
      regex(regex, message) {
        return this._addCheck({
          kind: "regex",
          regex,
          ...errorUtil.errToObj(message)
        });
      }
      includes(value, options) {
        return this._addCheck({
          kind: "includes",
          value,
          position: options?.position,
          ...errorUtil.errToObj(options?.message)
        });
      }
      startsWith(value, message) {
        return this._addCheck({
          kind: "startsWith",
          value,
          ...errorUtil.errToObj(message)
        });
      }
      endsWith(value, message) {
        return this._addCheck({
          kind: "endsWith",
          value,
          ...errorUtil.errToObj(message)
        });
      }
      min(minLength, message) {
        return this._addCheck({
          kind: "min",
          value: minLength,
          ...errorUtil.errToObj(message)
        });
      }
      max(maxLength, message) {
        return this._addCheck({
          kind: "max",
          value: maxLength,
          ...errorUtil.errToObj(message)
        });
      }
      length(len, message) {
        return this._addCheck({
          kind: "length",
          value: len,
          ...errorUtil.errToObj(message)
        });
      }
      /**
       * Equivalent to `.min(1)`
       */
      nonempty(message) {
        return this.min(1, errorUtil.errToObj(message));
      }
      trim() {
        return new _ZodString({
          ...this._def,
          checks: [...this._def.checks, { kind: "trim" }]
        });
      }
      toLowerCase() {
        return new _ZodString({
          ...this._def,
          checks: [...this._def.checks, { kind: "toLowerCase" }]
        });
      }
      toUpperCase() {
        return new _ZodString({
          ...this._def,
          checks: [...this._def.checks, { kind: "toUpperCase" }]
        });
      }
      get isDatetime() {
        return !!this._def.checks.find((ch) => ch.kind === "datetime");
      }
      get isDate() {
        return !!this._def.checks.find((ch) => ch.kind === "date");
      }
      get isTime() {
        return !!this._def.checks.find((ch) => ch.kind === "time");
      }
      get isDuration() {
        return !!this._def.checks.find((ch) => ch.kind === "duration");
      }
      get isEmail() {
        return !!this._def.checks.find((ch) => ch.kind === "email");
      }
      get isURL() {
        return !!this._def.checks.find((ch) => ch.kind === "url");
      }
      get isEmoji() {
        return !!this._def.checks.find((ch) => ch.kind === "emoji");
      }
      get isUUID() {
        return !!this._def.checks.find((ch) => ch.kind === "uuid");
      }
      get isNANOID() {
        return !!this._def.checks.find((ch) => ch.kind === "nanoid");
      }
      get isCUID() {
        return !!this._def.checks.find((ch) => ch.kind === "cuid");
      }
      get isCUID2() {
        return !!this._def.checks.find((ch) => ch.kind === "cuid2");
      }
      get isULID() {
        return !!this._def.checks.find((ch) => ch.kind === "ulid");
      }
      get isIP() {
        return !!this._def.checks.find((ch) => ch.kind === "ip");
      }
      get isCIDR() {
        return !!this._def.checks.find((ch) => ch.kind === "cidr");
      }
      get isBase64() {
        return !!this._def.checks.find((ch) => ch.kind === "base64");
      }
      get isBase64url() {
        return !!this._def.checks.find((ch) => ch.kind === "base64url");
      }
      get minLength() {
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          }
        }
        return min;
      }
      get maxLength() {
        let max = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return max;
      }
    };
    ZodString.create = (params) => {
      return new ZodString({
        checks: [],
        typeName: ZodFirstPartyTypeKind.ZodString,
        coerce: params?.coerce ?? false,
        ...processCreateParams(params)
      });
    };
    ZodNumber = class _ZodNumber extends ZodType {
      constructor() {
        super(...arguments);
        this.min = this.gte;
        this.max = this.lte;
        this.step = this.multipleOf;
      }
      _parse(input) {
        if (this._def.coerce) {
          input.data = Number(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.number) {
          const ctx2 = this._getOrReturnCtx(input);
          addIssueToContext(ctx2, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.number,
            received: ctx2.parsedType
          });
          return INVALID;
        }
        let ctx = void 0;
        const status = new ParseStatus();
        for (const check of this._def.checks) {
          if (check.kind === "int") {
            if (!util.isInteger(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: "integer",
                received: "float",
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "min") {
            const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
            if (tooSmall) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_small,
                minimum: check.value,
                type: "number",
                inclusive: check.inclusive,
                exact: false,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "max") {
            const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
            if (tooBig) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_big,
                maximum: check.value,
                type: "number",
                inclusive: check.inclusive,
                exact: false,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "multipleOf") {
            if (floatSafeRemainder(input.data, check.value) !== 0) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.not_multiple_of,
                multipleOf: check.value,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "finite") {
            if (!Number.isFinite(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.not_finite,
                message: check.message
              });
              status.dirty();
            }
          } else {
            util.assertNever(check);
          }
        }
        return { status: status.value, value: input.data };
      }
      gte(value, message) {
        return this.setLimit("min", value, true, errorUtil.toString(message));
      }
      gt(value, message) {
        return this.setLimit("min", value, false, errorUtil.toString(message));
      }
      lte(value, message) {
        return this.setLimit("max", value, true, errorUtil.toString(message));
      }
      lt(value, message) {
        return this.setLimit("max", value, false, errorUtil.toString(message));
      }
      setLimit(kind, value, inclusive, message) {
        return new _ZodNumber({
          ...this._def,
          checks: [
            ...this._def.checks,
            {
              kind,
              value,
              inclusive,
              message: errorUtil.toString(message)
            }
          ]
        });
      }
      _addCheck(check) {
        return new _ZodNumber({
          ...this._def,
          checks: [...this._def.checks, check]
        });
      }
      int(message) {
        return this._addCheck({
          kind: "int",
          message: errorUtil.toString(message)
        });
      }
      positive(message) {
        return this._addCheck({
          kind: "min",
          value: 0,
          inclusive: false,
          message: errorUtil.toString(message)
        });
      }
      negative(message) {
        return this._addCheck({
          kind: "max",
          value: 0,
          inclusive: false,
          message: errorUtil.toString(message)
        });
      }
      nonpositive(message) {
        return this._addCheck({
          kind: "max",
          value: 0,
          inclusive: true,
          message: errorUtil.toString(message)
        });
      }
      nonnegative(message) {
        return this._addCheck({
          kind: "min",
          value: 0,
          inclusive: true,
          message: errorUtil.toString(message)
        });
      }
      multipleOf(value, message) {
        return this._addCheck({
          kind: "multipleOf",
          value,
          message: errorUtil.toString(message)
        });
      }
      finite(message) {
        return this._addCheck({
          kind: "finite",
          message: errorUtil.toString(message)
        });
      }
      safe(message) {
        return this._addCheck({
          kind: "min",
          inclusive: true,
          value: Number.MIN_SAFE_INTEGER,
          message: errorUtil.toString(message)
        })._addCheck({
          kind: "max",
          inclusive: true,
          value: Number.MAX_SAFE_INTEGER,
          message: errorUtil.toString(message)
        });
      }
      get minValue() {
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          }
        }
        return min;
      }
      get maxValue() {
        let max = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return max;
      }
      get isInt() {
        return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
      }
      get isFinite() {
        let max = null;
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
            return true;
          } else if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          } else if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return Number.isFinite(min) && Number.isFinite(max);
      }
    };
    ZodNumber.create = (params) => {
      return new ZodNumber({
        checks: [],
        typeName: ZodFirstPartyTypeKind.ZodNumber,
        coerce: params?.coerce || false,
        ...processCreateParams(params)
      });
    };
    ZodBigInt = class _ZodBigInt extends ZodType {
      constructor() {
        super(...arguments);
        this.min = this.gte;
        this.max = this.lte;
      }
      _parse(input) {
        if (this._def.coerce) {
          try {
            input.data = BigInt(input.data);
          } catch {
            return this._getInvalidInput(input);
          }
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.bigint) {
          return this._getInvalidInput(input);
        }
        let ctx = void 0;
        const status = new ParseStatus();
        for (const check of this._def.checks) {
          if (check.kind === "min") {
            const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
            if (tooSmall) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_small,
                type: "bigint",
                minimum: check.value,
                inclusive: check.inclusive,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "max") {
            const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
            if (tooBig) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_big,
                type: "bigint",
                maximum: check.value,
                inclusive: check.inclusive,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "multipleOf") {
            if (input.data % check.value !== BigInt(0)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.not_multiple_of,
                multipleOf: check.value,
                message: check.message
              });
              status.dirty();
            }
          } else {
            util.assertNever(check);
          }
        }
        return { status: status.value, value: input.data };
      }
      _getInvalidInput(input) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.bigint,
          received: ctx.parsedType
        });
        return INVALID;
      }
      gte(value, message) {
        return this.setLimit("min", value, true, errorUtil.toString(message));
      }
      gt(value, message) {
        return this.setLimit("min", value, false, errorUtil.toString(message));
      }
      lte(value, message) {
        return this.setLimit("max", value, true, errorUtil.toString(message));
      }
      lt(value, message) {
        return this.setLimit("max", value, false, errorUtil.toString(message));
      }
      setLimit(kind, value, inclusive, message) {
        return new _ZodBigInt({
          ...this._def,
          checks: [
            ...this._def.checks,
            {
              kind,
              value,
              inclusive,
              message: errorUtil.toString(message)
            }
          ]
        });
      }
      _addCheck(check) {
        return new _ZodBigInt({
          ...this._def,
          checks: [...this._def.checks, check]
        });
      }
      positive(message) {
        return this._addCheck({
          kind: "min",
          value: BigInt(0),
          inclusive: false,
          message: errorUtil.toString(message)
        });
      }
      negative(message) {
        return this._addCheck({
          kind: "max",
          value: BigInt(0),
          inclusive: false,
          message: errorUtil.toString(message)
        });
      }
      nonpositive(message) {
        return this._addCheck({
          kind: "max",
          value: BigInt(0),
          inclusive: true,
          message: errorUtil.toString(message)
        });
      }
      nonnegative(message) {
        return this._addCheck({
          kind: "min",
          value: BigInt(0),
          inclusive: true,
          message: errorUtil.toString(message)
        });
      }
      multipleOf(value, message) {
        return this._addCheck({
          kind: "multipleOf",
          value,
          message: errorUtil.toString(message)
        });
      }
      get minValue() {
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          }
        }
        return min;
      }
      get maxValue() {
        let max = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return max;
      }
    };
    ZodBigInt.create = (params) => {
      return new ZodBigInt({
        checks: [],
        typeName: ZodFirstPartyTypeKind.ZodBigInt,
        coerce: params?.coerce ?? false,
        ...processCreateParams(params)
      });
    };
    ZodBoolean = class extends ZodType {
      _parse(input) {
        if (this._def.coerce) {
          input.data = Boolean(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.boolean) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.boolean,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return OK(input.data);
      }
    };
    ZodBoolean.create = (params) => {
      return new ZodBoolean({
        typeName: ZodFirstPartyTypeKind.ZodBoolean,
        coerce: params?.coerce || false,
        ...processCreateParams(params)
      });
    };
    ZodDate = class _ZodDate extends ZodType {
      _parse(input) {
        if (this._def.coerce) {
          input.data = new Date(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.date) {
          const ctx2 = this._getOrReturnCtx(input);
          addIssueToContext(ctx2, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.date,
            received: ctx2.parsedType
          });
          return INVALID;
        }
        if (Number.isNaN(input.data.getTime())) {
          const ctx2 = this._getOrReturnCtx(input);
          addIssueToContext(ctx2, {
            code: ZodIssueCode.invalid_date
          });
          return INVALID;
        }
        const status = new ParseStatus();
        let ctx = void 0;
        for (const check of this._def.checks) {
          if (check.kind === "min") {
            if (input.data.getTime() < check.value) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_small,
                message: check.message,
                inclusive: true,
                exact: false,
                minimum: check.value,
                type: "date"
              });
              status.dirty();
            }
          } else if (check.kind === "max") {
            if (input.data.getTime() > check.value) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_big,
                message: check.message,
                inclusive: true,
                exact: false,
                maximum: check.value,
                type: "date"
              });
              status.dirty();
            }
          } else {
            util.assertNever(check);
          }
        }
        return {
          status: status.value,
          value: new Date(input.data.getTime())
        };
      }
      _addCheck(check) {
        return new _ZodDate({
          ...this._def,
          checks: [...this._def.checks, check]
        });
      }
      min(minDate, message) {
        return this._addCheck({
          kind: "min",
          value: minDate.getTime(),
          message: errorUtil.toString(message)
        });
      }
      max(maxDate, message) {
        return this._addCheck({
          kind: "max",
          value: maxDate.getTime(),
          message: errorUtil.toString(message)
        });
      }
      get minDate() {
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          }
        }
        return min != null ? new Date(min) : null;
      }
      get maxDate() {
        let max = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return max != null ? new Date(max) : null;
      }
    };
    ZodDate.create = (params) => {
      return new ZodDate({
        checks: [],
        coerce: params?.coerce || false,
        typeName: ZodFirstPartyTypeKind.ZodDate,
        ...processCreateParams(params)
      });
    };
    ZodSymbol = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.symbol) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.symbol,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return OK(input.data);
      }
    };
    ZodSymbol.create = (params) => {
      return new ZodSymbol({
        typeName: ZodFirstPartyTypeKind.ZodSymbol,
        ...processCreateParams(params)
      });
    };
    ZodUndefined = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.undefined) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.undefined,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return OK(input.data);
      }
    };
    ZodUndefined.create = (params) => {
      return new ZodUndefined({
        typeName: ZodFirstPartyTypeKind.ZodUndefined,
        ...processCreateParams(params)
      });
    };
    ZodNull = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.null) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.null,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return OK(input.data);
      }
    };
    ZodNull.create = (params) => {
      return new ZodNull({
        typeName: ZodFirstPartyTypeKind.ZodNull,
        ...processCreateParams(params)
      });
    };
    ZodAny = class extends ZodType {
      constructor() {
        super(...arguments);
        this._any = true;
      }
      _parse(input) {
        return OK(input.data);
      }
    };
    ZodAny.create = (params) => {
      return new ZodAny({
        typeName: ZodFirstPartyTypeKind.ZodAny,
        ...processCreateParams(params)
      });
    };
    ZodUnknown = class extends ZodType {
      constructor() {
        super(...arguments);
        this._unknown = true;
      }
      _parse(input) {
        return OK(input.data);
      }
    };
    ZodUnknown.create = (params) => {
      return new ZodUnknown({
        typeName: ZodFirstPartyTypeKind.ZodUnknown,
        ...processCreateParams(params)
      });
    };
    ZodNever = class extends ZodType {
      _parse(input) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.never,
          received: ctx.parsedType
        });
        return INVALID;
      }
    };
    ZodNever.create = (params) => {
      return new ZodNever({
        typeName: ZodFirstPartyTypeKind.ZodNever,
        ...processCreateParams(params)
      });
    };
    ZodVoid = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.undefined) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.void,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return OK(input.data);
      }
    };
    ZodVoid.create = (params) => {
      return new ZodVoid({
        typeName: ZodFirstPartyTypeKind.ZodVoid,
        ...processCreateParams(params)
      });
    };
    ZodArray = class _ZodArray extends ZodType {
      _parse(input) {
        const { ctx, status } = this._processInputParams(input);
        const def = this._def;
        if (ctx.parsedType !== ZodParsedType.array) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.array,
            received: ctx.parsedType
          });
          return INVALID;
        }
        if (def.exactLength !== null) {
          const tooBig = ctx.data.length > def.exactLength.value;
          const tooSmall = ctx.data.length < def.exactLength.value;
          if (tooBig || tooSmall) {
            addIssueToContext(ctx, {
              code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
              minimum: tooSmall ? def.exactLength.value : void 0,
              maximum: tooBig ? def.exactLength.value : void 0,
              type: "array",
              inclusive: true,
              exact: true,
              message: def.exactLength.message
            });
            status.dirty();
          }
        }
        if (def.minLength !== null) {
          if (ctx.data.length < def.minLength.value) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: def.minLength.value,
              type: "array",
              inclusive: true,
              exact: false,
              message: def.minLength.message
            });
            status.dirty();
          }
        }
        if (def.maxLength !== null) {
          if (ctx.data.length > def.maxLength.value) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: def.maxLength.value,
              type: "array",
              inclusive: true,
              exact: false,
              message: def.maxLength.message
            });
            status.dirty();
          }
        }
        if (ctx.common.async) {
          return Promise.all([...ctx.data].map((item, i) => {
            return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
          })).then((result2) => {
            return ParseStatus.mergeArray(status, result2);
          });
        }
        const result = [...ctx.data].map((item, i) => {
          return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
        });
        return ParseStatus.mergeArray(status, result);
      }
      get element() {
        return this._def.type;
      }
      min(minLength, message) {
        return new _ZodArray({
          ...this._def,
          minLength: { value: minLength, message: errorUtil.toString(message) }
        });
      }
      max(maxLength, message) {
        return new _ZodArray({
          ...this._def,
          maxLength: { value: maxLength, message: errorUtil.toString(message) }
        });
      }
      length(len, message) {
        return new _ZodArray({
          ...this._def,
          exactLength: { value: len, message: errorUtil.toString(message) }
        });
      }
      nonempty(message) {
        return this.min(1, message);
      }
    };
    ZodArray.create = (schema, params) => {
      return new ZodArray({
        type: schema,
        minLength: null,
        maxLength: null,
        exactLength: null,
        typeName: ZodFirstPartyTypeKind.ZodArray,
        ...processCreateParams(params)
      });
    };
    ZodObject = class _ZodObject extends ZodType {
      constructor() {
        super(...arguments);
        this._cached = null;
        this.nonstrict = this.passthrough;
        this.augment = this.extend;
      }
      _getCached() {
        if (this._cached !== null)
          return this._cached;
        const shape = this._def.shape();
        const keys = util.objectKeys(shape);
        this._cached = { shape, keys };
        return this._cached;
      }
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.object) {
          const ctx2 = this._getOrReturnCtx(input);
          addIssueToContext(ctx2, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.object,
            received: ctx2.parsedType
          });
          return INVALID;
        }
        const { status, ctx } = this._processInputParams(input);
        const { shape, keys: shapeKeys } = this._getCached();
        const extraKeys = [];
        if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
          for (const key in ctx.data) {
            if (!shapeKeys.includes(key)) {
              extraKeys.push(key);
            }
          }
        }
        const pairs = [];
        for (const key of shapeKeys) {
          const keyValidator = shape[key];
          const value = ctx.data[key];
          pairs.push({
            key: { status: "valid", value: key },
            value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
            alwaysSet: key in ctx.data
          });
        }
        if (this._def.catchall instanceof ZodNever) {
          const unknownKeys = this._def.unknownKeys;
          if (unknownKeys === "passthrough") {
            for (const key of extraKeys) {
              pairs.push({
                key: { status: "valid", value: key },
                value: { status: "valid", value: ctx.data[key] }
              });
            }
          } else if (unknownKeys === "strict") {
            if (extraKeys.length > 0) {
              addIssueToContext(ctx, {
                code: ZodIssueCode.unrecognized_keys,
                keys: extraKeys
              });
              status.dirty();
            }
          } else if (unknownKeys === "strip") {
          } else {
            throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
          }
        } else {
          const catchall = this._def.catchall;
          for (const key of extraKeys) {
            const value = ctx.data[key];
            pairs.push({
              key: { status: "valid", value: key },
              value: catchall._parse(
                new ParseInputLazyPath(ctx, value, ctx.path, key)
                //, ctx.child(key), value, getParsedType(value)
              ),
              alwaysSet: key in ctx.data
            });
          }
        }
        if (ctx.common.async) {
          return Promise.resolve().then(async () => {
            const syncPairs = [];
            for (const pair of pairs) {
              const key = await pair.key;
              const value = await pair.value;
              syncPairs.push({
                key,
                value,
                alwaysSet: pair.alwaysSet
              });
            }
            return syncPairs;
          }).then((syncPairs) => {
            return ParseStatus.mergeObjectSync(status, syncPairs);
          });
        } else {
          return ParseStatus.mergeObjectSync(status, pairs);
        }
      }
      get shape() {
        return this._def.shape();
      }
      strict(message) {
        errorUtil.errToObj;
        return new _ZodObject({
          ...this._def,
          unknownKeys: "strict",
          ...message !== void 0 ? {
            errorMap: (issue, ctx) => {
              const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
              if (issue.code === "unrecognized_keys")
                return {
                  message: errorUtil.errToObj(message).message ?? defaultError
                };
              return {
                message: defaultError
              };
            }
          } : {}
        });
      }
      strip() {
        return new _ZodObject({
          ...this._def,
          unknownKeys: "strip"
        });
      }
      passthrough() {
        return new _ZodObject({
          ...this._def,
          unknownKeys: "passthrough"
        });
      }
      // const AugmentFactory =
      //   <Def extends ZodObjectDef>(def: Def) =>
      //   <Augmentation extends ZodRawShape>(
      //     augmentation: Augmentation
      //   ): ZodObject<
      //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
      //     Def["unknownKeys"],
      //     Def["catchall"]
      //   > => {
      //     return new ZodObject({
      //       ...def,
      //       shape: () => ({
      //         ...def.shape(),
      //         ...augmentation,
      //       }),
      //     }) as any;
      //   };
      extend(augmentation) {
        return new _ZodObject({
          ...this._def,
          shape: () => ({
            ...this._def.shape(),
            ...augmentation
          })
        });
      }
      /**
       * Prior to zod@1.0.12 there was a bug in the
       * inferred type of merged objects. Please
       * upgrade if you are experiencing issues.
       */
      merge(merging) {
        const merged = new _ZodObject({
          unknownKeys: merging._def.unknownKeys,
          catchall: merging._def.catchall,
          shape: () => ({
            ...this._def.shape(),
            ...merging._def.shape()
          }),
          typeName: ZodFirstPartyTypeKind.ZodObject
        });
        return merged;
      }
      // merge<
      //   Incoming extends AnyZodObject,
      //   Augmentation extends Incoming["shape"],
      //   NewOutput extends {
      //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
      //       ? Augmentation[k]["_output"]
      //       : k extends keyof Output
      //       ? Output[k]
      //       : never;
      //   },
      //   NewInput extends {
      //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
      //       ? Augmentation[k]["_input"]
      //       : k extends keyof Input
      //       ? Input[k]
      //       : never;
      //   }
      // >(
      //   merging: Incoming
      // ): ZodObject<
      //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
      //   Incoming["_def"]["unknownKeys"],
      //   Incoming["_def"]["catchall"],
      //   NewOutput,
      //   NewInput
      // > {
      //   const merged: any = new ZodObject({
      //     unknownKeys: merging._def.unknownKeys,
      //     catchall: merging._def.catchall,
      //     shape: () =>
      //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
      //     typeName: ZodFirstPartyTypeKind.ZodObject,
      //   }) as any;
      //   return merged;
      // }
      setKey(key, schema) {
        return this.augment({ [key]: schema });
      }
      // merge<Incoming extends AnyZodObject>(
      //   merging: Incoming
      // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
      // ZodObject<
      //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
      //   Incoming["_def"]["unknownKeys"],
      //   Incoming["_def"]["catchall"]
      // > {
      //   // const mergedShape = objectUtil.mergeShapes(
      //   //   this._def.shape(),
      //   //   merging._def.shape()
      //   // );
      //   const merged: any = new ZodObject({
      //     unknownKeys: merging._def.unknownKeys,
      //     catchall: merging._def.catchall,
      //     shape: () =>
      //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
      //     typeName: ZodFirstPartyTypeKind.ZodObject,
      //   }) as any;
      //   return merged;
      // }
      catchall(index) {
        return new _ZodObject({
          ...this._def,
          catchall: index
        });
      }
      pick(mask) {
        const shape = {};
        for (const key of util.objectKeys(mask)) {
          if (mask[key] && this.shape[key]) {
            shape[key] = this.shape[key];
          }
        }
        return new _ZodObject({
          ...this._def,
          shape: () => shape
        });
      }
      omit(mask) {
        const shape = {};
        for (const key of util.objectKeys(this.shape)) {
          if (!mask[key]) {
            shape[key] = this.shape[key];
          }
        }
        return new _ZodObject({
          ...this._def,
          shape: () => shape
        });
      }
      /**
       * @deprecated
       */
      deepPartial() {
        return deepPartialify(this);
      }
      partial(mask) {
        const newShape = {};
        for (const key of util.objectKeys(this.shape)) {
          const fieldSchema = this.shape[key];
          if (mask && !mask[key]) {
            newShape[key] = fieldSchema;
          } else {
            newShape[key] = fieldSchema.optional();
          }
        }
        return new _ZodObject({
          ...this._def,
          shape: () => newShape
        });
      }
      required(mask) {
        const newShape = {};
        for (const key of util.objectKeys(this.shape)) {
          if (mask && !mask[key]) {
            newShape[key] = this.shape[key];
          } else {
            const fieldSchema = this.shape[key];
            let newField = fieldSchema;
            while (newField instanceof ZodOptional) {
              newField = newField._def.innerType;
            }
            newShape[key] = newField;
          }
        }
        return new _ZodObject({
          ...this._def,
          shape: () => newShape
        });
      }
      keyof() {
        return createZodEnum(util.objectKeys(this.shape));
      }
    };
    ZodObject.create = (shape, params) => {
      return new ZodObject({
        shape: () => shape,
        unknownKeys: "strip",
        catchall: ZodNever.create(),
        typeName: ZodFirstPartyTypeKind.ZodObject,
        ...processCreateParams(params)
      });
    };
    ZodObject.strictCreate = (shape, params) => {
      return new ZodObject({
        shape: () => shape,
        unknownKeys: "strict",
        catchall: ZodNever.create(),
        typeName: ZodFirstPartyTypeKind.ZodObject,
        ...processCreateParams(params)
      });
    };
    ZodObject.lazycreate = (shape, params) => {
      return new ZodObject({
        shape,
        unknownKeys: "strip",
        catchall: ZodNever.create(),
        typeName: ZodFirstPartyTypeKind.ZodObject,
        ...processCreateParams(params)
      });
    };
    ZodUnion = class extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        const options = this._def.options;
        function handleResults(results) {
          for (const result of results) {
            if (result.result.status === "valid") {
              return result.result;
            }
          }
          for (const result of results) {
            if (result.result.status === "dirty") {
              ctx.common.issues.push(...result.ctx.common.issues);
              return result.result;
            }
          }
          const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_union,
            unionErrors
          });
          return INVALID;
        }
        if (ctx.common.async) {
          return Promise.all(options.map(async (option) => {
            const childCtx = {
              ...ctx,
              common: {
                ...ctx.common,
                issues: []
              },
              parent: null
            };
            return {
              result: await option._parseAsync({
                data: ctx.data,
                path: ctx.path,
                parent: childCtx
              }),
              ctx: childCtx
            };
          })).then(handleResults);
        } else {
          let dirty = void 0;
          const issues = [];
          for (const option of options) {
            const childCtx = {
              ...ctx,
              common: {
                ...ctx.common,
                issues: []
              },
              parent: null
            };
            const result = option._parseSync({
              data: ctx.data,
              path: ctx.path,
              parent: childCtx
            });
            if (result.status === "valid") {
              return result;
            } else if (result.status === "dirty" && !dirty) {
              dirty = { result, ctx: childCtx };
            }
            if (childCtx.common.issues.length) {
              issues.push(childCtx.common.issues);
            }
          }
          if (dirty) {
            ctx.common.issues.push(...dirty.ctx.common.issues);
            return dirty.result;
          }
          const unionErrors = issues.map((issues2) => new ZodError(issues2));
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_union,
            unionErrors
          });
          return INVALID;
        }
      }
      get options() {
        return this._def.options;
      }
    };
    ZodUnion.create = (types, params) => {
      return new ZodUnion({
        options: types,
        typeName: ZodFirstPartyTypeKind.ZodUnion,
        ...processCreateParams(params)
      });
    };
    getDiscriminator = (type) => {
      if (type instanceof ZodLazy) {
        return getDiscriminator(type.schema);
      } else if (type instanceof ZodEffects) {
        return getDiscriminator(type.innerType());
      } else if (type instanceof ZodLiteral) {
        return [type.value];
      } else if (type instanceof ZodEnum) {
        return type.options;
      } else if (type instanceof ZodNativeEnum) {
        return util.objectValues(type.enum);
      } else if (type instanceof ZodDefault) {
        return getDiscriminator(type._def.innerType);
      } else if (type instanceof ZodUndefined) {
        return [void 0];
      } else if (type instanceof ZodNull) {
        return [null];
      } else if (type instanceof ZodOptional) {
        return [void 0, ...getDiscriminator(type.unwrap())];
      } else if (type instanceof ZodNullable) {
        return [null, ...getDiscriminator(type.unwrap())];
      } else if (type instanceof ZodBranded) {
        return getDiscriminator(type.unwrap());
      } else if (type instanceof ZodReadonly) {
        return getDiscriminator(type.unwrap());
      } else if (type instanceof ZodCatch) {
        return getDiscriminator(type._def.innerType);
      } else {
        return [];
      }
    };
    ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.object) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.object,
            received: ctx.parsedType
          });
          return INVALID;
        }
        const discriminator = this.discriminator;
        const discriminatorValue = ctx.data[discriminator];
        const option = this.optionsMap.get(discriminatorValue);
        if (!option) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_union_discriminator,
            options: Array.from(this.optionsMap.keys()),
            path: [discriminator]
          });
          return INVALID;
        }
        if (ctx.common.async) {
          return option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
        } else {
          return option._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
        }
      }
      get discriminator() {
        return this._def.discriminator;
      }
      get options() {
        return this._def.options;
      }
      get optionsMap() {
        return this._def.optionsMap;
      }
      /**
       * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
       * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
       * have a different value for each object in the union.
       * @param discriminator the name of the discriminator property
       * @param types an array of object schemas
       * @param params
       */
      static create(discriminator, options, params) {
        const optionsMap = /* @__PURE__ */ new Map();
        for (const type of options) {
          const discriminatorValues = getDiscriminator(type.shape[discriminator]);
          if (!discriminatorValues.length) {
            throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
          }
          for (const value of discriminatorValues) {
            if (optionsMap.has(value)) {
              throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
            }
            optionsMap.set(value, type);
          }
        }
        return new _ZodDiscriminatedUnion({
          typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
          discriminator,
          options,
          optionsMap,
          ...processCreateParams(params)
        });
      }
    };
    ZodIntersection = class extends ZodType {
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        const handleParsed = (parsedLeft, parsedRight) => {
          if (isAborted(parsedLeft) || isAborted(parsedRight)) {
            return INVALID;
          }
          const merged = mergeValues(parsedLeft.value, parsedRight.value);
          if (!merged.valid) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_intersection_types
            });
            return INVALID;
          }
          if (isDirty(parsedLeft) || isDirty(parsedRight)) {
            status.dirty();
          }
          return { status: status.value, value: merged.data };
        };
        if (ctx.common.async) {
          return Promise.all([
            this._def.left._parseAsync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            }),
            this._def.right._parseAsync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            })
          ]).then(([left, right]) => handleParsed(left, right));
        } else {
          return handleParsed(this._def.left._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          }), this._def.right._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          }));
        }
      }
    };
    ZodIntersection.create = (left, right, params) => {
      return new ZodIntersection({
        left,
        right,
        typeName: ZodFirstPartyTypeKind.ZodIntersection,
        ...processCreateParams(params)
      });
    };
    ZodTuple = class _ZodTuple extends ZodType {
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.array) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.array,
            received: ctx.parsedType
          });
          return INVALID;
        }
        if (ctx.data.length < this._def.items.length) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: this._def.items.length,
            inclusive: true,
            exact: false,
            type: "array"
          });
          return INVALID;
        }
        const rest = this._def.rest;
        if (!rest && ctx.data.length > this._def.items.length) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: this._def.items.length,
            inclusive: true,
            exact: false,
            type: "array"
          });
          status.dirty();
        }
        const items = [...ctx.data].map((item, itemIndex) => {
          const schema = this._def.items[itemIndex] || this._def.rest;
          if (!schema)
            return null;
          return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
        }).filter((x) => !!x);
        if (ctx.common.async) {
          return Promise.all(items).then((results) => {
            return ParseStatus.mergeArray(status, results);
          });
        } else {
          return ParseStatus.mergeArray(status, items);
        }
      }
      get items() {
        return this._def.items;
      }
      rest(rest) {
        return new _ZodTuple({
          ...this._def,
          rest
        });
      }
    };
    ZodTuple.create = (schemas, params) => {
      if (!Array.isArray(schemas)) {
        throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
      }
      return new ZodTuple({
        items: schemas,
        typeName: ZodFirstPartyTypeKind.ZodTuple,
        rest: null,
        ...processCreateParams(params)
      });
    };
    ZodRecord = class _ZodRecord extends ZodType {
      get keySchema() {
        return this._def.keyType;
      }
      get valueSchema() {
        return this._def.valueType;
      }
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.object) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.object,
            received: ctx.parsedType
          });
          return INVALID;
        }
        const pairs = [];
        const keyType = this._def.keyType;
        const valueType = this._def.valueType;
        for (const key in ctx.data) {
          pairs.push({
            key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
            value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
            alwaysSet: key in ctx.data
          });
        }
        if (ctx.common.async) {
          return ParseStatus.mergeObjectAsync(status, pairs);
        } else {
          return ParseStatus.mergeObjectSync(status, pairs);
        }
      }
      get element() {
        return this._def.valueType;
      }
      static create(first, second, third) {
        if (second instanceof ZodType) {
          return new _ZodRecord({
            keyType: first,
            valueType: second,
            typeName: ZodFirstPartyTypeKind.ZodRecord,
            ...processCreateParams(third)
          });
        }
        return new _ZodRecord({
          keyType: ZodString.create(),
          valueType: first,
          typeName: ZodFirstPartyTypeKind.ZodRecord,
          ...processCreateParams(second)
        });
      }
    };
    ZodMap = class extends ZodType {
      get keySchema() {
        return this._def.keyType;
      }
      get valueSchema() {
        return this._def.valueType;
      }
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.map) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.map,
            received: ctx.parsedType
          });
          return INVALID;
        }
        const keyType = this._def.keyType;
        const valueType = this._def.valueType;
        const pairs = [...ctx.data.entries()].map(([key, value], index) => {
          return {
            key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
            value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
          };
        });
        if (ctx.common.async) {
          const finalMap = /* @__PURE__ */ new Map();
          return Promise.resolve().then(async () => {
            for (const pair of pairs) {
              const key = await pair.key;
              const value = await pair.value;
              if (key.status === "aborted" || value.status === "aborted") {
                return INVALID;
              }
              if (key.status === "dirty" || value.status === "dirty") {
                status.dirty();
              }
              finalMap.set(key.value, value.value);
            }
            return { status: status.value, value: finalMap };
          });
        } else {
          const finalMap = /* @__PURE__ */ new Map();
          for (const pair of pairs) {
            const key = pair.key;
            const value = pair.value;
            if (key.status === "aborted" || value.status === "aborted") {
              return INVALID;
            }
            if (key.status === "dirty" || value.status === "dirty") {
              status.dirty();
            }
            finalMap.set(key.value, value.value);
          }
          return { status: status.value, value: finalMap };
        }
      }
    };
    ZodMap.create = (keyType, valueType, params) => {
      return new ZodMap({
        valueType,
        keyType,
        typeName: ZodFirstPartyTypeKind.ZodMap,
        ...processCreateParams(params)
      });
    };
    ZodSet = class _ZodSet extends ZodType {
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.set) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.set,
            received: ctx.parsedType
          });
          return INVALID;
        }
        const def = this._def;
        if (def.minSize !== null) {
          if (ctx.data.size < def.minSize.value) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: def.minSize.value,
              type: "set",
              inclusive: true,
              exact: false,
              message: def.minSize.message
            });
            status.dirty();
          }
        }
        if (def.maxSize !== null) {
          if (ctx.data.size > def.maxSize.value) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: def.maxSize.value,
              type: "set",
              inclusive: true,
              exact: false,
              message: def.maxSize.message
            });
            status.dirty();
          }
        }
        const valueType = this._def.valueType;
        function finalizeSet(elements2) {
          const parsedSet = /* @__PURE__ */ new Set();
          for (const element of elements2) {
            if (element.status === "aborted")
              return INVALID;
            if (element.status === "dirty")
              status.dirty();
            parsedSet.add(element.value);
          }
          return { status: status.value, value: parsedSet };
        }
        const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
        if (ctx.common.async) {
          return Promise.all(elements).then((elements2) => finalizeSet(elements2));
        } else {
          return finalizeSet(elements);
        }
      }
      min(minSize, message) {
        return new _ZodSet({
          ...this._def,
          minSize: { value: minSize, message: errorUtil.toString(message) }
        });
      }
      max(maxSize, message) {
        return new _ZodSet({
          ...this._def,
          maxSize: { value: maxSize, message: errorUtil.toString(message) }
        });
      }
      size(size, message) {
        return this.min(size, message).max(size, message);
      }
      nonempty(message) {
        return this.min(1, message);
      }
    };
    ZodSet.create = (valueType, params) => {
      return new ZodSet({
        valueType,
        minSize: null,
        maxSize: null,
        typeName: ZodFirstPartyTypeKind.ZodSet,
        ...processCreateParams(params)
      });
    };
    ZodFunction = class _ZodFunction extends ZodType {
      constructor() {
        super(...arguments);
        this.validate = this.implement;
      }
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.function) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.function,
            received: ctx.parsedType
          });
          return INVALID;
        }
        function makeArgsIssue(args, error) {
          return makeIssue({
            data: args,
            path: ctx.path,
            errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
            issueData: {
              code: ZodIssueCode.invalid_arguments,
              argumentsError: error
            }
          });
        }
        function makeReturnsIssue(returns, error) {
          return makeIssue({
            data: returns,
            path: ctx.path,
            errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
            issueData: {
              code: ZodIssueCode.invalid_return_type,
              returnTypeError: error
            }
          });
        }
        const params = { errorMap: ctx.common.contextualErrorMap };
        const fn = ctx.data;
        if (this._def.returns instanceof ZodPromise) {
          const me = this;
          return OK(async function(...args) {
            const error = new ZodError([]);
            const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
              error.addIssue(makeArgsIssue(args, e));
              throw error;
            });
            const result = await Reflect.apply(fn, this, parsedArgs);
            const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
              error.addIssue(makeReturnsIssue(result, e));
              throw error;
            });
            return parsedReturns;
          });
        } else {
          const me = this;
          return OK(function(...args) {
            const parsedArgs = me._def.args.safeParse(args, params);
            if (!parsedArgs.success) {
              throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
            }
            const result = Reflect.apply(fn, this, parsedArgs.data);
            const parsedReturns = me._def.returns.safeParse(result, params);
            if (!parsedReturns.success) {
              throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
            }
            return parsedReturns.data;
          });
        }
      }
      parameters() {
        return this._def.args;
      }
      returnType() {
        return this._def.returns;
      }
      args(...items) {
        return new _ZodFunction({
          ...this._def,
          args: ZodTuple.create(items).rest(ZodUnknown.create())
        });
      }
      returns(returnType) {
        return new _ZodFunction({
          ...this._def,
          returns: returnType
        });
      }
      implement(func) {
        const validatedFunc = this.parse(func);
        return validatedFunc;
      }
      strictImplement(func) {
        const validatedFunc = this.parse(func);
        return validatedFunc;
      }
      static create(args, returns, params) {
        return new _ZodFunction({
          args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
          returns: returns || ZodUnknown.create(),
          typeName: ZodFirstPartyTypeKind.ZodFunction,
          ...processCreateParams(params)
        });
      }
    };
    ZodLazy = class extends ZodType {
      get schema() {
        return this._def.getter();
      }
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        const lazySchema = this._def.getter();
        return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
      }
    };
    ZodLazy.create = (getter, params) => {
      return new ZodLazy({
        getter,
        typeName: ZodFirstPartyTypeKind.ZodLazy,
        ...processCreateParams(params)
      });
    };
    ZodLiteral = class extends ZodType {
      _parse(input) {
        if (input.data !== this._def.value) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            received: ctx.data,
            code: ZodIssueCode.invalid_literal,
            expected: this._def.value
          });
          return INVALID;
        }
        return { status: "valid", value: input.data };
      }
      get value() {
        return this._def.value;
      }
    };
    ZodLiteral.create = (value, params) => {
      return new ZodLiteral({
        value,
        typeName: ZodFirstPartyTypeKind.ZodLiteral,
        ...processCreateParams(params)
      });
    };
    ZodEnum = class _ZodEnum extends ZodType {
      _parse(input) {
        if (typeof input.data !== "string") {
          const ctx = this._getOrReturnCtx(input);
          const expectedValues = this._def.values;
          addIssueToContext(ctx, {
            expected: util.joinValues(expectedValues),
            received: ctx.parsedType,
            code: ZodIssueCode.invalid_type
          });
          return INVALID;
        }
        if (!this._cache) {
          this._cache = new Set(this._def.values);
        }
        if (!this._cache.has(input.data)) {
          const ctx = this._getOrReturnCtx(input);
          const expectedValues = this._def.values;
          addIssueToContext(ctx, {
            received: ctx.data,
            code: ZodIssueCode.invalid_enum_value,
            options: expectedValues
          });
          return INVALID;
        }
        return OK(input.data);
      }
      get options() {
        return this._def.values;
      }
      get enum() {
        const enumValues = {};
        for (const val of this._def.values) {
          enumValues[val] = val;
        }
        return enumValues;
      }
      get Values() {
        const enumValues = {};
        for (const val of this._def.values) {
          enumValues[val] = val;
        }
        return enumValues;
      }
      get Enum() {
        const enumValues = {};
        for (const val of this._def.values) {
          enumValues[val] = val;
        }
        return enumValues;
      }
      extract(values, newDef = this._def) {
        return _ZodEnum.create(values, {
          ...this._def,
          ...newDef
        });
      }
      exclude(values, newDef = this._def) {
        return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
          ...this._def,
          ...newDef
        });
      }
    };
    ZodEnum.create = createZodEnum;
    ZodNativeEnum = class extends ZodType {
      _parse(input) {
        const nativeEnumValues = util.getValidEnumValues(this._def.values);
        const ctx = this._getOrReturnCtx(input);
        if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
          const expectedValues = util.objectValues(nativeEnumValues);
          addIssueToContext(ctx, {
            expected: util.joinValues(expectedValues),
            received: ctx.parsedType,
            code: ZodIssueCode.invalid_type
          });
          return INVALID;
        }
        if (!this._cache) {
          this._cache = new Set(util.getValidEnumValues(this._def.values));
        }
        if (!this._cache.has(input.data)) {
          const expectedValues = util.objectValues(nativeEnumValues);
          addIssueToContext(ctx, {
            received: ctx.data,
            code: ZodIssueCode.invalid_enum_value,
            options: expectedValues
          });
          return INVALID;
        }
        return OK(input.data);
      }
      get enum() {
        return this._def.values;
      }
    };
    ZodNativeEnum.create = (values, params) => {
      return new ZodNativeEnum({
        values,
        typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
        ...processCreateParams(params)
      });
    };
    ZodPromise = class extends ZodType {
      unwrap() {
        return this._def.type;
      }
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.promise,
            received: ctx.parsedType
          });
          return INVALID;
        }
        const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
        return OK(promisified.then((data) => {
          return this._def.type.parseAsync(data, {
            path: ctx.path,
            errorMap: ctx.common.contextualErrorMap
          });
        }));
      }
    };
    ZodPromise.create = (schema, params) => {
      return new ZodPromise({
        type: schema,
        typeName: ZodFirstPartyTypeKind.ZodPromise,
        ...processCreateParams(params)
      });
    };
    ZodEffects = class extends ZodType {
      innerType() {
        return this._def.schema;
      }
      sourceType() {
        return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
      }
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        const effect = this._def.effect || null;
        const checkCtx = {
          addIssue: (arg) => {
            addIssueToContext(ctx, arg);
            if (arg.fatal) {
              status.abort();
            } else {
              status.dirty();
            }
          },
          get path() {
            return ctx.path;
          }
        };
        checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
        if (effect.type === "preprocess") {
          const processed = effect.transform(ctx.data, checkCtx);
          if (ctx.common.async) {
            return Promise.resolve(processed).then(async (processed2) => {
              if (status.value === "aborted")
                return INVALID;
              const result = await this._def.schema._parseAsync({
                data: processed2,
                path: ctx.path,
                parent: ctx
              });
              if (result.status === "aborted")
                return INVALID;
              if (result.status === "dirty")
                return DIRTY(result.value);
              if (status.value === "dirty")
                return DIRTY(result.value);
              return result;
            });
          } else {
            if (status.value === "aborted")
              return INVALID;
            const result = this._def.schema._parseSync({
              data: processed,
              path: ctx.path,
              parent: ctx
            });
            if (result.status === "aborted")
              return INVALID;
            if (result.status === "dirty")
              return DIRTY(result.value);
            if (status.value === "dirty")
              return DIRTY(result.value);
            return result;
          }
        }
        if (effect.type === "refinement") {
          const executeRefinement = (acc) => {
            const result = effect.refinement(acc, checkCtx);
            if (ctx.common.async) {
              return Promise.resolve(result);
            }
            if (result instanceof Promise) {
              throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
            }
            return acc;
          };
          if (ctx.common.async === false) {
            const inner = this._def.schema._parseSync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            });
            if (inner.status === "aborted")
              return INVALID;
            if (inner.status === "dirty")
              status.dirty();
            executeRefinement(inner.value);
            return { status: status.value, value: inner.value };
          } else {
            return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
              if (inner.status === "aborted")
                return INVALID;
              if (inner.status === "dirty")
                status.dirty();
              return executeRefinement(inner.value).then(() => {
                return { status: status.value, value: inner.value };
              });
            });
          }
        }
        if (effect.type === "transform") {
          if (ctx.common.async === false) {
            const base = this._def.schema._parseSync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            });
            if (!isValid(base))
              return INVALID;
            const result = effect.transform(base.value, checkCtx);
            if (result instanceof Promise) {
              throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
            }
            return { status: status.value, value: result };
          } else {
            return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
              if (!isValid(base))
                return INVALID;
              return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
                status: status.value,
                value: result
              }));
            });
          }
        }
        util.assertNever(effect);
      }
    };
    ZodEffects.create = (schema, effect, params) => {
      return new ZodEffects({
        schema,
        typeName: ZodFirstPartyTypeKind.ZodEffects,
        effect,
        ...processCreateParams(params)
      });
    };
    ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
      return new ZodEffects({
        schema,
        effect: { type: "preprocess", transform: preprocess },
        typeName: ZodFirstPartyTypeKind.ZodEffects,
        ...processCreateParams(params)
      });
    };
    ZodOptional = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType === ZodParsedType.undefined) {
          return OK(void 0);
        }
        return this._def.innerType._parse(input);
      }
      unwrap() {
        return this._def.innerType;
      }
    };
    ZodOptional.create = (type, params) => {
      return new ZodOptional({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodOptional,
        ...processCreateParams(params)
      });
    };
    ZodNullable = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType === ZodParsedType.null) {
          return OK(null);
        }
        return this._def.innerType._parse(input);
      }
      unwrap() {
        return this._def.innerType;
      }
    };
    ZodNullable.create = (type, params) => {
      return new ZodNullable({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodNullable,
        ...processCreateParams(params)
      });
    };
    ZodDefault = class extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        let data = ctx.data;
        if (ctx.parsedType === ZodParsedType.undefined) {
          data = this._def.defaultValue();
        }
        return this._def.innerType._parse({
          data,
          path: ctx.path,
          parent: ctx
        });
      }
      removeDefault() {
        return this._def.innerType;
      }
    };
    ZodDefault.create = (type, params) => {
      return new ZodDefault({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodDefault,
        defaultValue: typeof params.default === "function" ? params.default : () => params.default,
        ...processCreateParams(params)
      });
    };
    ZodCatch = class extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        const newCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          }
        };
        const result = this._def.innerType._parse({
          data: newCtx.data,
          path: newCtx.path,
          parent: {
            ...newCtx
          }
        });
        if (isAsync(result)) {
          return result.then((result2) => {
            return {
              status: "valid",
              value: result2.status === "valid" ? result2.value : this._def.catchValue({
                get error() {
                  return new ZodError(newCtx.common.issues);
                },
                input: newCtx.data
              })
            };
          });
        } else {
          return {
            status: "valid",
            value: result.status === "valid" ? result.value : this._def.catchValue({
              get error() {
                return new ZodError(newCtx.common.issues);
              },
              input: newCtx.data
            })
          };
        }
      }
      removeCatch() {
        return this._def.innerType;
      }
    };
    ZodCatch.create = (type, params) => {
      return new ZodCatch({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodCatch,
        catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
        ...processCreateParams(params)
      });
    };
    ZodNaN = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.nan) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.nan,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return { status: "valid", value: input.data };
      }
    };
    ZodNaN.create = (params) => {
      return new ZodNaN({
        typeName: ZodFirstPartyTypeKind.ZodNaN,
        ...processCreateParams(params)
      });
    };
    BRAND = Symbol("zod_brand");
    ZodBranded = class extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        const data = ctx.data;
        return this._def.type._parse({
          data,
          path: ctx.path,
          parent: ctx
        });
      }
      unwrap() {
        return this._def.type;
      }
    };
    ZodPipeline = class _ZodPipeline extends ZodType {
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.common.async) {
          const handleAsync = async () => {
            const inResult = await this._def.in._parseAsync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            });
            if (inResult.status === "aborted")
              return INVALID;
            if (inResult.status === "dirty") {
              status.dirty();
              return DIRTY(inResult.value);
            } else {
              return this._def.out._parseAsync({
                data: inResult.value,
                path: ctx.path,
                parent: ctx
              });
            }
          };
          return handleAsync();
        } else {
          const inResult = this._def.in._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
          if (inResult.status === "aborted")
            return INVALID;
          if (inResult.status === "dirty") {
            status.dirty();
            return {
              status: "dirty",
              value: inResult.value
            };
          } else {
            return this._def.out._parseSync({
              data: inResult.value,
              path: ctx.path,
              parent: ctx
            });
          }
        }
      }
      static create(a, b) {
        return new _ZodPipeline({
          in: a,
          out: b,
          typeName: ZodFirstPartyTypeKind.ZodPipeline
        });
      }
    };
    ZodReadonly = class extends ZodType {
      _parse(input) {
        const result = this._def.innerType._parse(input);
        const freeze = (data) => {
          if (isValid(data)) {
            data.value = Object.freeze(data.value);
          }
          return data;
        };
        return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
      }
      unwrap() {
        return this._def.innerType;
      }
    };
    ZodReadonly.create = (type, params) => {
      return new ZodReadonly({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodReadonly,
        ...processCreateParams(params)
      });
    };
    late = {
      object: ZodObject.lazycreate
    };
    (function(ZodFirstPartyTypeKind2) {
      ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
      ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
      ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
      ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
      ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
      ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
      ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
      ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
      ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
      ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
      ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
      ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
      ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
      ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
      ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
      ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
      ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
      ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
      ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
      ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
      ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
      ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
      ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
      ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
      ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
      ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
      ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
      ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
      ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
      ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
      ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
      ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
      ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
      ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
      ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
      ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
    })(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
    instanceOfType = (cls, params = {
      message: `Input not instance of ${cls.name}`
    }) => custom((data) => data instanceof cls, params);
    stringType = ZodString.create;
    numberType = ZodNumber.create;
    nanType = ZodNaN.create;
    bigIntType = ZodBigInt.create;
    booleanType = ZodBoolean.create;
    dateType = ZodDate.create;
    symbolType = ZodSymbol.create;
    undefinedType = ZodUndefined.create;
    nullType = ZodNull.create;
    anyType = ZodAny.create;
    unknownType = ZodUnknown.create;
    neverType = ZodNever.create;
    voidType = ZodVoid.create;
    arrayType = ZodArray.create;
    objectType = ZodObject.create;
    strictObjectType = ZodObject.strictCreate;
    unionType = ZodUnion.create;
    discriminatedUnionType = ZodDiscriminatedUnion.create;
    intersectionType = ZodIntersection.create;
    tupleType = ZodTuple.create;
    recordType = ZodRecord.create;
    mapType = ZodMap.create;
    setType = ZodSet.create;
    functionType = ZodFunction.create;
    lazyType = ZodLazy.create;
    literalType = ZodLiteral.create;
    enumType = ZodEnum.create;
    nativeEnumType = ZodNativeEnum.create;
    promiseType = ZodPromise.create;
    effectsType = ZodEffects.create;
    optionalType = ZodOptional.create;
    nullableType = ZodNullable.create;
    preprocessType = ZodEffects.createWithPreprocess;
    pipelineType = ZodPipeline.create;
    ostring = () => stringType().optional();
    onumber = () => numberType().optional();
    oboolean = () => booleanType().optional();
    coerce = {
      string: ((arg) => ZodString.create({ ...arg, coerce: true })),
      number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
      boolean: ((arg) => ZodBoolean.create({
        ...arg,
        coerce: true
      })),
      bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
      date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
    };
    NEVER = INVALID;
  }
});

// node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});
var init_external = __esm({
  "node_modules/zod/v3/external.js"() {
    init_errors();
    init_parseUtil();
    init_typeAliases();
    init_util();
    init_types();
    init_ZodError();
  }
});

// node_modules/zod/index.js
var init_zod = __esm({
  "node_modules/zod/index.js"() {
    init_external();
    init_external();
  }
});

// src/lib/schema.ts
var init_schema = __esm({
  "src/lib/schema.ts"() {
    "use strict";
    init_zod();
  }
});

// src/agents/load.ts
import * as fs2 from "node:fs";
import * as path2 from "node:path";
import { fileURLToPath } from "node:url";
function listAgentIds(dir) {
  const agentsDir = dir ?? DEFAULT_AGENTS_DIR;
  const entries = fs2.readdirSync(agentsDir);
  return entries.filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -".md".length));
}
var FrontmatterSchema, DEFAULT_AGENTS_DIR;
var init_load = __esm({
  "src/agents/load.ts"() {
    "use strict";
    init_schema();
    FrontmatterSchema = external_exports.object({
      agent_id: external_exports.string().min(1),
      name: external_exports.string().min(1),
      role: external_exports.string().min(1),
      disallowedTools_default: external_exports.array(external_exports.string())
    });
    DEFAULT_AGENTS_DIR = path2.dirname(fileURLToPath(import.meta.url));
  }
});

// src/bootstrap/provision.ts
var provision_exports = {};
__export(provision_exports, {
  provision: () => provision
});
import * as fs3 from "node:fs";
import * as os from "node:os";
import * as path3 from "node:path";
function checkIds(ids) {
  for (const id of ids) {
    if (TRAVERSAL_RE.test(id)) {
      return { status: "error", kind: "io_error", reason: `Invalid agent id in bundle: '${id}'` };
    }
  }
  return null;
}
function readTeoVersion() {
  return process.env["TEO_VERSION"] ?? "unknown";
}
function writeManifest(resolvedHome, keyId) {
  const manifestPath = path3.join(resolvedHome, "manifest.json");
  const tmpPath = manifestPath + ".tmp";
  const manifest = {
    schema_version: "1",
    teo_version: readTeoVersion(),
    provisioned_at: (/* @__PURE__ */ new Date()).toISOString(),
    bundle_signature_key_id: keyId
  };
  try {
    fs3.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), { mode: 420 });
    fs3.renameSync(tmpPath, manifestPath);
    fs3.chmodSync(manifestPath, 420);
  } catch (err2) {
    try {
      fs3.rmSync(tmpPath, { force: true });
    } catch {
    }
    return {
      status: "error",
      kind: "io_error",
      reason: `Manifest write failed: ${err2.message}`
    };
  }
  return null;
}
async function provision(opts) {
  const resolvedHome = opts.homeDir ?? process.env["TEO_HOME"] ?? path3.join(os.homedir(), ".teo");
  const host = opts.host ?? detectHost();
  let bundleDir = opts.bundleDir;
  if (!bundleDir) {
    if (host.kind === "claude-code-plugin" && host.pluginRoot) {
      bundleDir = path3.join(host.pluginRoot, "agents");
    } else {
      return {
        status: "error",
        kind: "io_error",
        reason: "bundleDir is required in standalone context"
      };
    }
  }
  if (host.kind === "claude-code-plugin" && host.pluginRoot) {
    let resolvedBundleDir;
    let resolvedPluginRoot;
    try {
      resolvedBundleDir = fs3.realpathSync(bundleDir);
      resolvedPluginRoot = fs3.realpathSync(host.pluginRoot);
    } catch {
      return {
        status: "error",
        kind: "io_error",
        reason: "pluginRoot containment check failed: bundleDir escapes plugin root"
      };
    }
    if (!resolvedBundleDir.startsWith(resolvedPluginRoot + path3.sep) && resolvedBundleDir !== resolvedPluginRoot) {
      return {
        status: "error",
        kind: "io_error",
        reason: "pluginRoot containment check failed: bundleDir escapes plugin root"
      };
    }
  }
  if (fs3.existsSync(resolvedHome) && !fs3.statSync(resolvedHome).isDirectory()) {
    return {
      status: "error",
      kind: "conflict",
      reason: `Conflict: ${resolvedHome} exists as a file but a directory is required.`
    };
  }
  const bundleIds = listAgentIds(bundleDir).sort();
  const traversalErr = checkIds(bundleIds);
  if (traversalErr) return traversalErr;
  const ledgerDir = path3.join(resolvedHome, "ledger");
  const keyringDir = path3.join(resolvedHome, "keyring");
  if (fs3.existsSync(ledgerDir) && fs3.existsSync(keyringDir)) {
    return { status: "already_provisioned" };
  }
  const chunks = bundleIds.map((id) => fs3.readFileSync(path3.join(String(bundleDir), `${id}.md`)));
  const data = Buffer.concat(chunks);
  const revResult = await checkRevocation({ data, ...opts.revocationOpts });
  if (revResult.verdict === "BLOCKED") {
    return {
      status: "error",
      kind: "revocation_blocked",
      // reason is always set by checkRevocation BLOCKED paths; ?? "" is a defensive
      // fallback for pathological callers that override checkRevocation with no reason.
      reason: revResult.reason ?? ""
    };
  }
  const revocationWarning = revResult.warning;
  try {
    fs3.mkdirSync(resolvedHome, { recursive: true, mode: 448 });
  } catch (err2) {
    const e = err2;
    if (e.code === "EACCES") {
      return {
        status: "error",
        kind: "permission_denied",
        reason: `Permission denied creating home directory ${resolvedHome}: ${e.message}`
      };
    }
    return { status: "error", kind: "io_error", reason: e.message };
  }
  try {
    fs3.mkdirSync(ledgerDir, { recursive: true, mode: 448 });
  } catch (err2) {
    const e = err2;
    if (e.code === "EACCES") {
      return {
        status: "error",
        kind: "permission_denied",
        reason: `Permission denied creating ledger directory: ${e.message}`
      };
    }
    return { status: "error", kind: "io_error", reason: e.message };
  }
  try {
    fs3.mkdirSync(keyringDir, { recursive: true, mode: 448 });
  } catch (err2) {
    const e = err2;
    if (e.code === "EACCES") {
      return {
        status: "error",
        kind: "permission_denied",
        reason: `Permission denied creating keyring directory: ${e.message}`
      };
    }
    return { status: "error", kind: "io_error", reason: e.message };
  }
  fs3.chmodSync(resolvedHome, 448);
  const manifestErr = writeManifest(resolvedHome, opts.revocationOpts.keyId);
  if (manifestErr) return manifestErr;
  return { status: "ok", ...revocationWarning ? { warning: revocationWarning } : {} };
}
var TRAVERSAL_RE;
var init_provision = __esm({
  "src/bootstrap/provision.ts"() {
    "use strict";
    init_revocation();
    init_host();
    init_load();
    TRAVERSAL_RE = /\.\.|\/|\\/;
  }
});

// src/core/plan.ts
var plan_exports = {};
__export(plan_exports, {
  GateRefSchema: () => GateRefSchema,
  PlanSchema: () => PlanSchema,
  TEOTaskSchema: () => TEOTaskSchema
});
var GateRefSchema, BaseTaskSchema, ScriptTaskSchema, AgentTaskSchema, TEOTaskSchema, PlanSchema;
var init_plan = __esm({
  "src/core/plan.ts"() {
    "use strict";
    init_schema();
    GateRefSchema = external_exports.object({
      name: external_exports.string().min(1),
      on_fail: external_exports.enum(["block", "warn"])
    });
    BaseTaskSchema = external_exports.object({
      id: external_exports.string().min(1),
      needs: external_exports.array(external_exports.string()),
      gates: external_exports.array(GateRefSchema),
      // See BOUNDARY DECISION #2 above: allowed on SCRIPT tasks as a no-op.
      disallowedTools: external_exports.array(external_exports.string()).optional()
    });
    ScriptTaskSchema = BaseTaskSchema.extend({
      type: external_exports.literal("SCRIPT"),
      command: external_exports.string().min(1)
    });
    AgentTaskSchema = BaseTaskSchema.extend({
      type: external_exports.literal("AGENT"),
      agent_id: external_exports.string().min(1),
      prompt: external_exports.string().min(1),
      target_dir: external_exports.string().optional()
      // WS-CRYPTO-01: directory to hash for content_hash
    });
    TEOTaskSchema = external_exports.discriminatedUnion("type", [
      ScriptTaskSchema.strict(),
      AgentTaskSchema.strict()
    ]);
    PlanSchema = external_exports.object({
      plan_id: external_exports.string().min(1),
      project_id: external_exports.string().min(1),
      created_at: external_exports.string(),
      version: external_exports.literal("1"),
      directive: external_exports.enum(["BUILD", "FIX", "REVIEW", "PLAN", "ARCHITECTURAL"]).optional(),
      tasks: external_exports.array(TEOTaskSchema).min(1)
    });
  }
});

// node_modules/jsonrepair/lib/esm/utils/JSONRepairError.js
var JSONRepairError;
var init_JSONRepairError = __esm({
  "node_modules/jsonrepair/lib/esm/utils/JSONRepairError.js"() {
    JSONRepairError = class extends Error {
      constructor(message, position) {
        super(`${message} at position ${position}`);
        this.position = position;
      }
    };
  }
});

// node_modules/jsonrepair/lib/esm/utils/stringUtils.js
function isHex(char) {
  return /^[0-9A-Fa-f]$/.test(char);
}
function isDigit(char) {
  return char >= "0" && char <= "9";
}
function isValidStringCharacter(char) {
  return char >= " ";
}
function isDelimiter(char) {
  return ",:[]/{}()\n+".includes(char);
}
function isFunctionNameCharStart(char) {
  return char >= "a" && char <= "z" || char >= "A" && char <= "Z" || char === "_" || char === "$";
}
function isFunctionNameChar(char) {
  return char >= "a" && char <= "z" || char >= "A" && char <= "Z" || char === "_" || char === "$" || char >= "0" && char <= "9";
}
function isUnquotedStringDelimiter(char) {
  return ",[]/{}\n+".includes(char);
}
function isStartOfValue(char) {
  return isQuote(char) || regexStartOfValue.test(char);
}
function isControlCharacter(char) {
  return char === "\n" || char === "\r" || char === "	" || char === "\b" || char === "\f";
}
function isWhitespace(text, index) {
  const code = text.charCodeAt(index);
  return code === codeSpace || code === codeNewline || code === codeTab || code === codeReturn;
}
function isWhitespaceExceptNewline(text, index) {
  const code = text.charCodeAt(index);
  return code === codeSpace || code === codeTab || code === codeReturn;
}
function isSpecialWhitespace(text, index) {
  const code = text.charCodeAt(index);
  return code === codeNonBreakingSpace || code === codeMongolianVowelSeparator || code >= codeEnQuad && code <= codeZeroWidthSpace || code === codeNarrowNoBreakSpace || code === codeMediumMathematicalSpace || code === codeIdeographicSpace || code === codeZeroWidthNoBreakSpace;
}
function isQuote(char) {
  return isDoubleQuoteLike(char) || isSingleQuoteLike(char);
}
function isDoubleQuoteLike(char) {
  return char === '"' || char === "\u201C" || char === "\u201D";
}
function isDoubleQuote(char) {
  return char === '"';
}
function isSingleQuoteLike(char) {
  return char === "'" || char === "\u2018" || char === "\u2019" || char === "`" || char === "\xB4";
}
function isSingleQuote(char) {
  return char === "'";
}
function stripLastOccurrence(text, textToStrip) {
  let stripRemainingText = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;
  const index = text.lastIndexOf(textToStrip);
  return index !== -1 ? text.substring(0, index) + (stripRemainingText ? "" : text.substring(index + 1)) : text;
}
function insertBeforeLastWhitespace(text, textToInsert) {
  let index = text.length;
  if (!isWhitespace(text, index - 1)) {
    return text + textToInsert;
  }
  while (isWhitespace(text, index - 1)) {
    index--;
  }
  return text.substring(0, index) + textToInsert + text.substring(index);
}
function removeAtIndex(text, start, count) {
  return text.substring(0, start) + text.substring(start + count);
}
function endsWithCommaOrNewline(text) {
  return /[,\n][ \t\r]*$/.test(text);
}
var codeSpace, codeNewline, codeTab, codeReturn, codeNonBreakingSpace, codeMongolianVowelSeparator, codeEnQuad, codeZeroWidthSpace, codeNarrowNoBreakSpace, codeMediumMathematicalSpace, codeIdeographicSpace, codeZeroWidthNoBreakSpace, regexUrlStart, regexUrlChar, regexStartOfValue;
var init_stringUtils = __esm({
  "node_modules/jsonrepair/lib/esm/utils/stringUtils.js"() {
    codeSpace = 32;
    codeNewline = 10;
    codeTab = 9;
    codeReturn = 13;
    codeNonBreakingSpace = 160;
    codeMongolianVowelSeparator = 6158;
    codeEnQuad = 8192;
    codeZeroWidthSpace = 8203;
    codeNarrowNoBreakSpace = 8239;
    codeMediumMathematicalSpace = 8287;
    codeIdeographicSpace = 12288;
    codeZeroWidthNoBreakSpace = 65279;
    regexUrlStart = /^(http|https|ftp|mailto|file|data|irc):\/\/$/;
    regexUrlChar = /^[A-Za-z0-9-._~:/?#@!$&'()*+;=]$/;
    regexStartOfValue = /^[[{\w-]$/;
  }
});

// node_modules/jsonrepair/lib/esm/regular/jsonrepair.js
function jsonrepair(text) {
  let i = 0;
  let output = "";
  parseMarkdownCodeBlock(["```", "[```", "{```"]);
  const processed = parseValue();
  if (!processed) {
    throwUnexpectedEnd();
  }
  parseMarkdownCodeBlock(["```", "```]", "```}"]);
  const processedComma = parseCharacter(",");
  if (processedComma) {
    parseWhitespaceAndSkipComments();
  }
  if (isStartOfValue(text[i]) && endsWithCommaOrNewline(output)) {
    if (!processedComma) {
      output = insertBeforeLastWhitespace(output, ",");
    }
    parseNewlineDelimitedJSON();
  } else if (processedComma) {
    output = stripLastOccurrence(output, ",");
  }
  while (text[i] === "}" || text[i] === "]") {
    i++;
    parseWhitespaceAndSkipComments();
  }
  if (i >= text.length) {
    return output;
  }
  throwUnexpectedCharacter();
  function parseValue() {
    parseWhitespaceAndSkipComments();
    const processed2 = parseObject() || parseArray() || parseString() || parseNumber() || parseKeywords() || parseUnquotedString(false) || parseRegex();
    parseWhitespaceAndSkipComments();
    return processed2;
  }
  function parseWhitespaceAndSkipComments() {
    let skipNewline = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : true;
    const start = i;
    let changed = parseWhitespace(skipNewline);
    do {
      changed = parseComment();
      if (changed) {
        changed = parseWhitespace(skipNewline);
      }
    } while (changed);
    return i > start;
  }
  function parseWhitespace(skipNewline) {
    const _isWhiteSpace = skipNewline ? isWhitespace : isWhitespaceExceptNewline;
    let whitespace = "";
    while (true) {
      if (_isWhiteSpace(text, i)) {
        whitespace += text[i];
        i++;
      } else if (isSpecialWhitespace(text, i)) {
        whitespace += " ";
        i++;
      } else {
        break;
      }
    }
    if (whitespace.length > 0) {
      output += whitespace;
      return true;
    }
    return false;
  }
  function parseComment() {
    if (text[i] === "/" && text[i + 1] === "*") {
      while (i < text.length && !atEndOfBlockComment(text, i)) {
        i++;
      }
      i += 2;
      return true;
    }
    if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") {
        i++;
      }
      return true;
    }
    return false;
  }
  function parseMarkdownCodeBlock(blocks) {
    if (skipMarkdownCodeBlock(blocks)) {
      if (isFunctionNameCharStart(text[i])) {
        while (i < text.length && isFunctionNameChar(text[i])) {
          i++;
        }
      }
      parseWhitespaceAndSkipComments();
      return true;
    }
    return false;
  }
  function skipMarkdownCodeBlock(blocks) {
    parseWhitespace(true);
    for (const block of blocks) {
      const end = i + block.length;
      if (text.slice(i, end) === block) {
        i = end;
        return true;
      }
    }
    return false;
  }
  function parseCharacter(char) {
    if (text[i] === char) {
      output += text[i];
      i++;
      return true;
    }
    return false;
  }
  function skipCharacter(char) {
    if (text[i] === char) {
      i++;
      return true;
    }
    return false;
  }
  function skipEscapeCharacter() {
    return skipCharacter("\\");
  }
  function skipEllipsis() {
    parseWhitespaceAndSkipComments();
    if (text[i] === "." && text[i + 1] === "." && text[i + 2] === ".") {
      i += 3;
      parseWhitespaceAndSkipComments();
      skipCharacter(",");
      return true;
    }
    return false;
  }
  function parseObject() {
    if (text[i] === "{") {
      output += "{";
      i++;
      parseWhitespaceAndSkipComments();
      if (skipCharacter(",")) {
        parseWhitespaceAndSkipComments();
      }
      let initial = true;
      while (i < text.length && text[i] !== "}") {
        let processedComma2;
        if (!initial) {
          processedComma2 = parseCharacter(",");
          if (!processedComma2) {
            output = insertBeforeLastWhitespace(output, ",");
          }
          parseWhitespaceAndSkipComments();
        } else {
          processedComma2 = true;
          initial = false;
        }
        skipEllipsis();
        const processedKey = parseString() || parseUnquotedString(true);
        if (!processedKey) {
          if (text[i] === "}" || text[i] === "{" || text[i] === "]" || text[i] === "[" || text[i] === void 0) {
            output = stripLastOccurrence(output, ",");
          } else {
            throwObjectKeyExpected();
          }
          break;
        }
        parseWhitespaceAndSkipComments();
        const processedColon = parseCharacter(":");
        const truncatedText = i >= text.length;
        if (!processedColon) {
          if (isStartOfValue(text[i]) || truncatedText) {
            output = insertBeforeLastWhitespace(output, ":");
          } else {
            throwColonExpected();
          }
        }
        const processedValue = parseValue();
        if (!processedValue) {
          if (processedColon || truncatedText) {
            output += "null";
          } else {
            throwColonExpected();
          }
        }
      }
      if (text[i] === "}") {
        output += "}";
        i++;
      } else {
        output = insertBeforeLastWhitespace(output, "}");
      }
      return true;
    }
    return false;
  }
  function parseArray() {
    if (text[i] === "[") {
      output += "[";
      i++;
      parseWhitespaceAndSkipComments();
      if (skipCharacter(",")) {
        parseWhitespaceAndSkipComments();
      }
      let initial = true;
      while (i < text.length && text[i] !== "]") {
        if (!initial) {
          const processedComma2 = parseCharacter(",");
          if (!processedComma2) {
            output = insertBeforeLastWhitespace(output, ",");
          }
        } else {
          initial = false;
        }
        skipEllipsis();
        const processedValue = parseValue();
        if (!processedValue) {
          output = stripLastOccurrence(output, ",");
          break;
        }
      }
      if (text[i] === "]") {
        output += "]";
        i++;
      } else {
        output = insertBeforeLastWhitespace(output, "]");
      }
      return true;
    }
    return false;
  }
  function parseNewlineDelimitedJSON() {
    let initial = true;
    let processedValue = true;
    while (processedValue) {
      if (!initial) {
        const processedComma2 = parseCharacter(",");
        if (!processedComma2) {
          output = insertBeforeLastWhitespace(output, ",");
        }
      } else {
        initial = false;
      }
      processedValue = parseValue();
    }
    if (!processedValue) {
      output = stripLastOccurrence(output, ",");
    }
    output = `[
${output}
]`;
  }
  function parseString() {
    let stopAtDelimiter = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : false;
    let stopAtIndex = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : -1;
    let skipEscapeChars = text[i] === "\\";
    if (skipEscapeChars) {
      i++;
      skipEscapeChars = true;
    }
    if (isQuote(text[i])) {
      const isEndQuote = isDoubleQuote(text[i]) ? isDoubleQuote : isSingleQuote(text[i]) ? isSingleQuote : isSingleQuoteLike(text[i]) ? isSingleQuoteLike : isDoubleQuoteLike;
      const iBefore = i;
      const oBefore = output.length;
      let str = '"';
      i++;
      while (true) {
        if (i >= text.length) {
          const iPrev = prevNonWhitespaceIndex(i - 1);
          if (!stopAtDelimiter && isDelimiter(text.charAt(iPrev))) {
            i = iBefore;
            output = output.substring(0, oBefore);
            return parseString(true);
          }
          str = insertBeforeLastWhitespace(str, '"');
          output += str;
          return true;
        }
        if (i === stopAtIndex) {
          str = insertBeforeLastWhitespace(str, '"');
          output += str;
          return true;
        }
        if (isEndQuote(text[i])) {
          const iQuote = i;
          const oQuote = str.length;
          str += '"';
          i++;
          output += str;
          parseWhitespaceAndSkipComments(false);
          if (stopAtDelimiter || i >= text.length || isDelimiter(text[i]) || isQuote(text[i]) || isDigit(text[i])) {
            parseConcatenatedString();
            return true;
          }
          const iPrevChar = prevNonWhitespaceIndex(iQuote - 1);
          const prevChar = text.charAt(iPrevChar);
          if (prevChar === ",") {
            i = iBefore;
            output = output.substring(0, oBefore);
            return parseString(false, iPrevChar);
          }
          if (isDelimiter(prevChar)) {
            i = iBefore;
            output = output.substring(0, oBefore);
            return parseString(true);
          }
          output = output.substring(0, oBefore);
          i = iQuote + 1;
          str = `${str.substring(0, oQuote)}\\${str.substring(oQuote)}`;
        } else if (stopAtDelimiter && isUnquotedStringDelimiter(text[i])) {
          if (text[i - 1] === ":" && regexUrlStart.test(text.substring(iBefore + 1, i + 2))) {
            while (i < text.length && regexUrlChar.test(text[i])) {
              str += text[i];
              i++;
            }
          }
          str = insertBeforeLastWhitespace(str, '"');
          output += str;
          parseConcatenatedString();
          return true;
        } else if (text[i] === "\\") {
          const char = text.charAt(i + 1);
          const escapeChar = escapeCharacters[char];
          if (escapeChar !== void 0) {
            str += text.slice(i, i + 2);
            i += 2;
          } else if (char === "u") {
            let j = 2;
            while (j < 6 && isHex(text[i + j])) {
              j++;
            }
            if (j === 6) {
              str += text.slice(i, i + 6);
              i += 6;
            } else if (i + j >= text.length) {
              i = text.length;
            } else {
              throwInvalidUnicodeCharacter();
            }
          } else if (char === "\n") {
            str += "\\n";
            i += 2;
          } else {
            str += char;
            i += 2;
          }
        } else {
          const char = text.charAt(i);
          if (char === '"' && text[i - 1] !== "\\") {
            str += `\\${char}`;
            i++;
          } else if (isControlCharacter(char)) {
            str += controlCharacters[char];
            i++;
          } else {
            if (!isValidStringCharacter(char)) {
              throwInvalidCharacter(char);
            }
            str += char;
            i++;
          }
        }
        if (skipEscapeChars) {
          skipEscapeCharacter();
        }
      }
    }
    return false;
  }
  function parseConcatenatedString() {
    let processed2 = false;
    parseWhitespaceAndSkipComments();
    while (text[i] === "+") {
      processed2 = true;
      i++;
      parseWhitespaceAndSkipComments();
      output = stripLastOccurrence(output, '"', true);
      const start = output.length;
      const parsedStr = parseString();
      if (parsedStr) {
        output = removeAtIndex(output, start, 1);
      } else {
        output = insertBeforeLastWhitespace(output, '"');
      }
    }
    return processed2;
  }
  function parseNumber() {
    const start = i;
    if (text[i] === "-") {
      i++;
      if (atEndOfNumber()) {
        repairNumberEndingWithNumericSymbol(start);
        return true;
      }
      if (!isDigit(text[i])) {
        i = start;
        return false;
      }
    }
    while (isDigit(text[i])) {
      i++;
    }
    if (text[i] === ".") {
      i++;
      if (atEndOfNumber()) {
        repairNumberEndingWithNumericSymbol(start);
        return true;
      }
      if (!isDigit(text[i])) {
        i = start;
        return false;
      }
      while (isDigit(text[i])) {
        i++;
      }
    }
    if (text[i] === "e" || text[i] === "E") {
      i++;
      if (text[i] === "-" || text[i] === "+") {
        i++;
      }
      if (atEndOfNumber()) {
        repairNumberEndingWithNumericSymbol(start);
        return true;
      }
      if (!isDigit(text[i])) {
        i = start;
        return false;
      }
      while (isDigit(text[i])) {
        i++;
      }
    }
    if (!atEndOfNumber()) {
      i = start;
      return false;
    }
    if (i > start) {
      const num = text.slice(start, i);
      const hasInvalidLeadingZero = /^0\d/.test(num);
      output += hasInvalidLeadingZero ? `"${num}"` : num;
      return true;
    }
    return false;
  }
  function parseKeywords() {
    return parseKeyword("true", "true") || parseKeyword("false", "false") || parseKeyword("null", "null") || // repair Python keywords True, False, None
    parseKeyword("True", "true") || parseKeyword("False", "false") || parseKeyword("None", "null");
  }
  function parseKeyword(name, value) {
    if (text.slice(i, i + name.length) === name) {
      output += value;
      i += name.length;
      return true;
    }
    return false;
  }
  function parseUnquotedString(isKey) {
    const start = i;
    if (isFunctionNameCharStart(text[i])) {
      while (i < text.length && isFunctionNameChar(text[i])) {
        i++;
      }
      let j = i;
      while (isWhitespace(text, j)) {
        j++;
      }
      if (text[j] === "(") {
        i = j + 1;
        parseValue();
        if (text[i] === ")") {
          i++;
          if (text[i] === ";") {
            i++;
          }
        }
        return true;
      }
    }
    while (i < text.length && !isUnquotedStringDelimiter(text[i]) && !isQuote(text[i]) && (!isKey || text[i] !== ":")) {
      i++;
    }
    if (text[i - 1] === ":" && regexUrlStart.test(text.substring(start, i + 2))) {
      while (i < text.length && regexUrlChar.test(text[i])) {
        i++;
      }
    }
    if (i > start) {
      while (isWhitespace(text, i - 1) && i > 0) {
        i--;
      }
      const symbol = text.slice(start, i);
      output += symbol === "undefined" ? "null" : JSON.stringify(symbol);
      if (text[i] === '"') {
        i++;
      }
      return true;
    }
  }
  function parseRegex() {
    if (text[i] === "/") {
      const start = i;
      i++;
      while (i < text.length && (text[i] !== "/" || text[i - 1] === "\\")) {
        i++;
      }
      i++;
      output += JSON.stringify(text.substring(start, i));
      return true;
    }
  }
  function prevNonWhitespaceIndex(start) {
    let prev = start;
    while (prev > 0 && isWhitespace(text, prev)) {
      prev--;
    }
    return prev;
  }
  function atEndOfNumber() {
    return i >= text.length || isDelimiter(text[i]) || isWhitespace(text, i);
  }
  function repairNumberEndingWithNumericSymbol(start) {
    output += `${text.slice(start, i)}0`;
  }
  function throwInvalidCharacter(char) {
    throw new JSONRepairError(`Invalid character ${JSON.stringify(char)}`, i);
  }
  function throwUnexpectedCharacter() {
    throw new JSONRepairError(`Unexpected character ${JSON.stringify(text[i])}`, i);
  }
  function throwUnexpectedEnd() {
    throw new JSONRepairError("Unexpected end of json string", text.length);
  }
  function throwObjectKeyExpected() {
    throw new JSONRepairError("Object key expected", i);
  }
  function throwColonExpected() {
    throw new JSONRepairError("Colon expected", i);
  }
  function throwInvalidUnicodeCharacter() {
    const chars = text.slice(i, i + 6);
    throw new JSONRepairError(`Invalid unicode character "${chars}"`, i);
  }
}
function atEndOfBlockComment(text, i) {
  return text[i] === "*" && text[i + 1] === "/";
}
var controlCharacters, escapeCharacters;
var init_jsonrepair = __esm({
  "node_modules/jsonrepair/lib/esm/regular/jsonrepair.js"() {
    init_JSONRepairError();
    init_stringUtils();
    controlCharacters = {
      "\b": "\\b",
      "\f": "\\f",
      "\n": "\\n",
      "\r": "\\r",
      "	": "\\t"
    };
    escapeCharacters = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "	"
      // note that \u is handled separately in parseString()
    };
  }
});

// node_modules/jsonrepair/lib/esm/index.js
var init_esm = __esm({
  "node_modules/jsonrepair/lib/esm/index.js"() {
    init_jsonrepair();
  }
});

// src/core/artifacts.ts
var artifacts_exports = {};
__export(artifacts_exports, {
  repairJson: () => repairJson,
  validateArtifact: () => validateArtifact
});
function repairJson(raw) {
  const repaired = jsonrepair(raw);
  if (!raw.trimStart().startsWith('"')) {
    try {
      const parsed = JSON.parse(repaired);
      if (typeof parsed === "string" && repaired === JSON.stringify(raw)) {
        throw new Error(`Input is not repairable JSON: ${raw}`);
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
      } else {
        throw e;
      }
    }
  }
  return repaired;
}
function validateArtifact(input) {
  const { type, payload, strict = false } = input;
  let schema;
  switch (type) {
    case "GATE_RESULT_ARTIFACT":
      schema = strict ? GateResultArtifactSchema.strict() : GateResultArtifactSchema;
      break;
    case "STEP_RESULT_ARTIFACT":
      schema = strict ? StepResultArtifactSchema.strict() : StepResultArtifactSchema;
      break;
    case "PLAN_ARTIFACT":
      schema = strict ? PlanArtifactSchema.strict() : PlanArtifactSchema;
      break;
    case "AC_ARTIFACT": {
      const AcArtifactSchema = external_exports.object({
        workstream: external_exports.string().min(1),
        acs: external_exports.array(
          external_exports.object({
            id: external_exports.string().min(1),
            description: external_exports.string().min(1)
          })
        )
      });
      schema = strict ? AcArtifactSchema.strict() : AcArtifactSchema;
      break;
    }
    default:
      return {
        valid: false,
        errors: [`Unknown artifact type: ${type}`]
      };
  }
  const result = schema.safeParse(payload);
  if (result.success) {
    return { valid: true };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => i.message)
  };
}
var GateResultArtifactSchema, StepResultArtifactSchema, PlanArtifactSchema;
var init_artifacts = __esm({
  "src/core/artifacts.ts"() {
    "use strict";
    init_esm();
    init_schema();
    init_plan();
    GateResultArtifactSchema = external_exports.object({
      task_id: external_exports.string(),
      gate_name: external_exports.string(),
      verdict: external_exports.enum(["PASS", "FAIL", "WARN", "UNENFORCED_MOCK"]),
      timestamp: external_exports.string(),
      details: external_exports.string().optional()
    });
    StepResultArtifactSchema = external_exports.object({
      task_id: external_exports.string(),
      status: external_exports.enum(["COMPLETED", "FAILED", "SKIPPED"]),
      timestamp: external_exports.string(),
      agent_id: external_exports.string().optional()
    });
    PlanArtifactSchema = PlanSchema;
  }
});

// src/core/ledger.ts
var ledger_exports = {};
__export(ledger_exports, {
  AppendOnlyLedger: () => AppendOnlyLedger,
  LedgerClosedError: () => LedgerClosedError,
  LedgerPathError: () => LedgerPathError,
  LedgerSerializeError: () => LedgerSerializeError,
  resolveDefaultLedgerBase: () => resolveDefaultLedgerBase
});
import * as fs4 from "node:fs";
import * as path4 from "node:path";
import * as crypto from "node:crypto";
function resolveDefaultLedgerBase() {
  const envDir = process.env["TEO_LEDGER_DIR"];
  if (envDir && envDir.length > 0) return envDir;
  const homeDir = process.env["HOME"];
  if (homeDir && homeDir.length > 0) return path4.join(homeDir, ".teo");
  return path4.join(".teo-unresolved");
}
var LedgerClosedError, LedgerSerializeError, LedgerPathError, MAX_SESSION_ID_LENGTH, AppendOnlyLedger;
var init_ledger = __esm({
  "src/core/ledger.ts"() {
    "use strict";
    LedgerClosedError = class extends Error {
      constructor(message = "Ledger is closed \u2014 no further events may be appended.") {
        super(message);
        this.name = "LedgerClosedError";
      }
    };
    LedgerSerializeError = class extends Error {
      constructor(cause) {
        super(`Cannot serialize event detail to JSON: ${cause}`);
        this.name = "LedgerSerializeError";
      }
    };
    LedgerPathError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "LedgerPathError";
      }
    };
    MAX_SESSION_ID_LENGTH = 255;
    AppendOnlyLedger = class {
      session_id;
      ledgerDir;
      filePath;
      seq = 0;
      closed = false;
      constructor(options) {
        const { session_id, baseDir } = options;
        if (!session_id || session_id.length === 0) {
          throw new LedgerPathError("session_id must not be empty.");
        }
        if (session_id.includes("/") || session_id.includes("\\") || session_id.includes("..") || session_id.includes("\0")) {
          throw new LedgerPathError(
            `session_id "${session_id}" contains invalid characters (path separators, traversal sequences, or null bytes). Use a plain identifier with no slashes, dots, or null bytes.`
          );
        }
        if (session_id.length > MAX_SESSION_ID_LENGTH) {
          throw new LedgerPathError(
            `session_id is too long (${session_id.length} chars; max ${MAX_SESSION_ID_LENGTH}). Use a shorter identifier.`
          );
        }
        this.session_id = session_id;
        const resolvedBase = baseDir ?? resolveDefaultLedgerBase();
        this.ledgerDir = path4.join(resolvedBase, "ledger");
        this.filePath = path4.join(this.ledgerDir, `${this.session_id}.jsonl`);
      }
      /**
       * Append one event to the session JSONL file.
       *
       * - Assigns event_id (UUID v4), seq (auto-incremented), and ts (ISO-8601 UTC).
       * - Creates <baseDir>/ledger/ if it does not exist.
       * - Opens the file with the 'a' flag (creates if absent; never truncates).
       * - Throws LedgerClosedError if the ledger is closed.
       * - Throws LedgerSerializeError if `detail` is not JSON-serializable.
       *
       * @param input - The caller-provided semantic fields (no seq/event_id/ts).
       * @returns The assigned seq (monotonically increasing sequence number) and ts
       *   (ISO-8601 UTC timestamp) for this event. Callers that need to sign the event
       *   (e.g. HmacSigner) must use these values to reproduce the canonical payload.
       */
      append(input) {
        if (this.closed) {
          throw new LedgerClosedError();
        }
        const detailJson = this.serializeDetail(input.detail);
        this.seq += 1;
        const event = {
          event_id: this.generateUuidV4(),
          seq: this.seq,
          ts: (/* @__PURE__ */ new Date()).toISOString(),
          session_id: input.session_id,
          workflow_id: input.workflow_id,
          task_id: input.task_id,
          turn_id: input.turn_id,
          actor_id: input.actor_id,
          actor_type: input.actor_type,
          phase: input.phase,
          verdict: input.verdict,
          detail: input.detail
        };
        void detailJson;
        const line = JSON.stringify(event) + "\n";
        if (!fs4.existsSync(this.ledgerDir)) {
          fs4.mkdirSync(this.ledgerDir, { recursive: true });
        }
        fs4.appendFileSync(this.filePath, line, "utf8");
        return { seq: this.seq, ts: event.ts };
      }
      /**
       * Append the final CLOSE-phase event with a workflow summary, then seal the ledger.
       *
       * After close():
       * - No further calls to append() or close() are permitted (both throw LedgerClosedError).
       * - The CLOSE event is always the last line in the file.
       *
       * @param summary - Token/cost/step-count rollup for the workflow.
       * @returns The assigned `seq` (monotonically increasing sequence number) and `ts`
       *   (ISO-8601 UTC timestamp) for the CLOSE event. Callers that need to sign the
       *   CLOSE event (e.g. HmacSigner) must use these values to reproduce the canonical
       *   payload. Existing callers that ignore the return value are unaffected.
       */
      close(summary) {
        if (this.closed) {
          throw new LedgerClosedError("Ledger is already closed \u2014 close() may only be called once.");
        }
        const result = this.append({
          session_id: this.session_id,
          workflow_id: this.session_id,
          // workflow_id defaults to session_id for the CLOSE event
          task_id: null,
          turn_id: null,
          actor_id: "SYSTEM",
          actor_type: "SYSTEM",
          phase: "CLOSE",
          verdict: null,
          detail: {
            task_count: summary.task_count,
            pass: summary.pass,
            fail: summary.fail,
            skipped: summary.skipped,
            tokens: summary.tokens,
            cost_usd: summary.cost_usd,
            ...summary.torn === true ? { torn: true } : {}
          }
        });
        this.closed = true;
        return result;
      }
      // ---------------------------------------------------------------------------
      // Private helpers
      // ---------------------------------------------------------------------------
      /**
       * Serialize `detail` to JSON to validate it is serializable.
       * Throws LedgerSerializeError if JSON.stringify fails (circular ref, BigInt, etc.).
       * The serialized string is returned for the caller's use.
       */
      serializeDetail(detail) {
        if (detail === null) return "null";
        try {
          return JSON.stringify(detail);
        } catch (err2) {
          const reason = err2 instanceof Error ? err2.message : String(err2);
          throw new LedgerSerializeError(reason);
        }
      }
      /**
       * Generate a UUID v4 using Node's crypto.randomUUID().
       * Available natively since Node 15.6.0 / 14.17.0.
       */
      generateUuidV4() {
        return crypto.randomUUID();
      }
    };
  }
});

// src/core/sign.ts
var sign_exports = {};
__export(sign_exports, {
  HmacSigner: () => HmacSigner,
  SignKeyError: () => SignKeyError,
  SignKeyringError: () => SignKeyringError
});
import * as crypto2 from "node:crypto";
import * as fs5 from "node:fs";
import * as path5 from "node:path";
var SignKeyringError, SignKeyError, KEY_BYTES, SIG_HEX_LENGTH, HmacSigner;
var init_sign = __esm({
  "src/core/sign.ts"() {
    "use strict";
    init_ledger();
    SignKeyringError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "SignKeyringError";
      }
    };
    SignKeyError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "SignKeyError";
      }
    };
    KEY_BYTES = 32;
    SIG_HEX_LENGTH = 64;
    HmacSigner = class _HmacSigner {
      key;
      /**
       * Construct an HmacSigner.
       *
       * On first use the keyring directory is created (0700) and the key file is
       * generated (32 random bytes, 0600). On subsequent construction the key is
       * loaded from disk.
       *
       * Throws SignKeyringError if keyring_id is invalid.
       * Throws SignKeyError if the key file exists but is corrupt/wrong length.
       *
       * @param options - Injectable baseDir (required for tests); optional keyring_id.
       */
      constructor(options = {}) {
        const keyring_id = options.keyring_id ?? "default";
        if (!keyring_id || keyring_id.length === 0) {
          throw new SignKeyringError("keyring_id must not be empty.");
        }
        if (keyring_id.includes("/") || keyring_id.includes("\\") || keyring_id.includes("..") || keyring_id.includes("\0")) {
          throw new SignKeyringError(
            `keyring_id "${keyring_id}" contains path separators or traversal sequences. Use a plain identifier with no slashes, backslashes, or dots.`
          );
        }
        const resolvedBase = options.baseDir ?? resolveDefaultLedgerBase();
        const keyringDir = path5.join(resolvedBase, "keyring");
        const keyPath = path5.join(keyringDir, `${keyring_id}.key`);
        this.key = _HmacSigner.loadOrGenerateKey(keyringDir, keyPath);
      }
      // ---------------------------------------------------------------------------
      // Public API
      // ---------------------------------------------------------------------------
      /**
       * Sign a payload using HMAC-SHA-256.
       *
       * Builds the canonical length-prefixed pipe-delimited string:
       *   <len(plan_id)>:<plan_id>|<len(task_id_str)>:<task_id_str>|<len(actor_id)>:<actor_id>|<len(verdict_str)>:<verdict_str>|<len(ts)>:<ts>|<len(seq_str)>:<seq_str>|<len(content_hash_str)>:<content_hash_str>
       *
       * where null task_id → "", null verdict → "", null/absent content_hash → "".
       *
       * Returns 64 lowercase hex characters.
       *
       * @param payload - The seven fields to sign.
       * @returns Hex-encoded HMAC-SHA-256 (64 chars).
       */
      sign(payload) {
        const canonical = _HmacSigner.buildCanonical(payload);
        return crypto2.createHmac("sha256", this.key).update(canonical).digest("hex");
      }
      /**
       * Verify a signature against a payload using constant-time comparison.
       *
       * Uses crypto.timingSafeEqual to prevent timing side-channels.
       * A wrong-length signature returns false without calling timingSafeEqual
       * (length difference is public information from the fixed 64-char format).
       *
       * @param payload - The payload to verify against.
       * @param signature - The hex-encoded signature to check.
       * @returns true if the signature is valid; false otherwise. Never throws.
       */
      verify(payload, signature) {
        if (signature.length !== SIG_HEX_LENGTH) {
          return false;
        }
        const expected = this.sign(payload);
        const expectedBuf = Buffer.from(expected, "hex");
        const actualBuf = Buffer.from(signature, "hex");
        return crypto2.timingSafeEqual(expectedBuf, actualBuf);
      }
      // ---------------------------------------------------------------------------
      // Static helpers
      // ---------------------------------------------------------------------------
      /**
       * Build the canonical signed string from a SignPayload.
       *
       * Delimiter-collision defense: each field value is LENGTH-PREFIXED.
       * Format: "<len>:<value>" for each field, joined with "|".
       *
       * null task_id → "" (empty string sentinel, length 0).
       * null verdict → "" (empty string sentinel, length 0).
       *
       * This ensures {plan_id:"a|b", task_id:"c"} and {plan_id:"a", task_id:"b|c"}
       * produce different canonical strings and thus different signatures.
       */
      static buildCanonical(payload) {
        const task_id_str = payload.task_id ?? "";
        const verdict_str = payload.verdict ?? "";
        const seq_str = String(payload.seq);
        const content_hash_str = payload.content_hash ?? "";
        const fields = [
          payload.plan_id,
          task_id_str,
          payload.actor_id,
          verdict_str,
          payload.ts,
          seq_str,
          content_hash_str
        ];
        return fields.map((f) => `${f.length}:${f}`).join("|");
      }
      /**
       * Load the key from disk, or generate and persist a new one.
       *
       * - Creates the keyring directory at mode 0700 if absent.
       * - Generates 32 cryptographically-random bytes and writes them at mode 0600
       *   if the key file is absent.
       * - If the key file exists but is not exactly KEY_BYTES (32) bytes, throws
       *   SignKeyError (corrupt/wrong-length key — never sign with a bad key).
       * - Enforces 0600 on the key file and 0700 on the keyring directory after loading.
       */
      static loadOrGenerateKey(keyringDir, keyPath) {
        if (!fs5.existsSync(keyringDir)) {
          fs5.mkdirSync(keyringDir, { recursive: true, mode: 448 });
        }
        if (!fs5.existsSync(keyPath)) {
          const key = crypto2.randomBytes(KEY_BYTES);
          fs5.writeFileSync(keyPath, key, { mode: 384 });
          fs5.chmodSync(keyringDir, 448);
          return key;
        }
        const raw = fs5.readFileSync(keyPath);
        if (raw.length !== KEY_BYTES) {
          throw new SignKeyError(
            `Key file at "${keyPath}" is ${raw.length} bytes; expected exactly ${KEY_BYTES} bytes. The file may be corrupt or empty. Delete it to regenerate.`
          );
        }
        fs5.chmodSync(keyPath, 384);
        fs5.chmodSync(keyringDir, 448);
        return raw;
      }
    };
  }
});

// src/engine/gate-profiles/acceptance-criteria.ts
import * as fs6 from "node:fs";
import * as path6 from "node:path";
function runAcceptanceCriteriaGate(input) {
  const { cwd } = input;
  if (!cwd) {
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "Missing required context.cwd" }
    };
  }
  if (!fs6.existsSync(cwd)) {
    return { verdict: "FAIL", status: "ENFORCED", evidence: { reason: `cwd not found: ${cwd}` } };
  }
  const acPath = path6.join(cwd, "ac.json");
  if (!fs6.existsSync(acPath)) {
    return { verdict: "FAIL", status: "ENFORCED", evidence: { reason: "ac.json not found" } };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs6.readFileSync(acPath, "utf8"));
  } catch (err2) {
    const msg = err2 instanceof Error ? err2.message : String(err2);
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "ac.json is not valid JSON", errors: [msg] }
    };
  }
  const result = validateArtifact({ type: "AC_ARTIFACT", payload: parsed, strict: true });
  if (!result.valid) {
    const errors = result.errors?.map((e) => String(e)) ?? ["schema validation failed"];
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "ac.json schema invalid", errors }
    };
  }
  const payload = parsed;
  return { verdict: "PASS", status: "ENFORCED", evidence: { ac_count: payload.acs.length } };
}
var init_acceptance_criteria = __esm({
  "src/engine/gate-profiles/acceptance-criteria.ts"() {
    "use strict";
    init_artifacts();
  }
});

// src/engine/gate-profiles/qa-spec.ts
import * as fs7 from "node:fs";
import * as path7 from "node:path";
function collectTestFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = fs7.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path7.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTestFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts"))) {
      results.push(fullPath);
    }
  }
  return results;
}
function runQaSpecGate(input) {
  const { cwd } = input;
  if (!cwd) {
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "Missing required context.cwd" }
    };
  }
  if (!fs7.existsSync(cwd)) {
    return { verdict: "FAIL", status: "ENFORCED", evidence: { reason: `cwd not found: ${cwd}` } };
  }
  const acPath = path7.join(cwd, "ac.json");
  if (!fs7.existsSync(acPath)) {
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "ac.json not found", covered_acs: [], uncovered_acs: [] }
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs7.readFileSync(acPath, "utf8"));
  } catch (err2) {
    const msg = err2 instanceof Error ? err2.message : String(err2);
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "ac.json is not valid JSON", errors: [msg] }
    };
  }
  const result = validateArtifact({ type: "AC_ARTIFACT", payload: parsed, strict: true });
  if (!result.valid) {
    return { verdict: "FAIL", status: "ENFORCED", evidence: { reason: "ac.json schema invalid" } };
  }
  const payload = parsed;
  const acIds = payload.acs.map((ac) => ac.id);
  const testFiles = collectTestFiles(cwd);
  if (testFiles.length === 0) {
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "no test files found", covered_acs: [], uncovered_acs: acIds }
    };
  }
  const allContent = testFiles.map((f) => {
    try {
      return fs7.readFileSync(f, "utf8");
    } catch {
      return "";
    }
  }).join("\n");
  const coveredAcs = [];
  const uncoveredAcs = [];
  for (const id of acIds) {
    if (allContent.includes(`[${id}]`)) {
      coveredAcs.push(id);
    } else {
      uncoveredAcs.push(id);
    }
  }
  if (uncoveredAcs.length > 0) {
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { covered_acs: coveredAcs, uncovered_acs: uncoveredAcs }
    };
  }
  return {
    verdict: "PASS",
    status: "ENFORCED",
    evidence: { covered_acs: coveredAcs, uncovered_acs: [] }
  };
}
var init_qa_spec = __esm({
  "src/engine/gate-profiles/qa-spec.ts"() {
    "use strict";
    init_artifacts();
  }
});

// src/engine/gate-profiles/dev.ts
import * as childProcess from "node:child_process";
import * as fs8 from "node:fs";
function defaultRunner(command, args, cwd) {
  const result = childProcess.spawnSync(command, args, { cwd, encoding: "utf8", timeout: 12e4 });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr
  };
}
function parseCoverage(output) {
  const allFilesMatch = output.match(/All files\s*\|\s*([\d.]+)/);
  if (allFilesMatch) {
    const n = parseFloat(allFilesMatch[1] ?? "0");
    if (!isNaN(n)) return n;
  }
  const coverageMatch = output.match(/Coverage[:\s]+([\d.]+)%/i);
  if (coverageMatch) {
    const n = parseFloat(coverageMatch[1] ?? "0");
    if (!isNaN(n)) return n;
  }
  return 0;
}
function parseTestCount(output) {
  const passedMatch = output.match(/(\d+)\s+passed/);
  if (passedMatch) {
    const n = parseInt(passedMatch[1] ?? "0", 10);
    if (!isNaN(n)) return n;
  }
  return 0;
}
function runDevGate(input) {
  const { cwd } = input;
  if (!cwd) {
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "Missing required context.cwd" }
    };
  }
  if (!fs8.existsSync(cwd)) {
    return { verdict: "FAIL", status: "ENFORCED", evidence: { reason: `cwd not found: ${cwd}` } };
  }
  const runner = input.runner ?? defaultRunner;
  const threshold = typeof input.context?.["coverage_threshold"] === "number" ? input.context["coverage_threshold"] : 99;
  const result = runner("npm", ["run", "test:cov"], cwd);
  if (result.exitCode !== 0) {
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "test suite failed", raw_output: result.stdout.slice(0, 500) }
    };
  }
  const coverage_pct = parseCoverage(result.stdout);
  const test_count = parseTestCount(result.stdout);
  if (coverage_pct < threshold) {
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "coverage below threshold", coverage_pct, threshold, test_count }
    };
  }
  return { verdict: "PASS", status: "ENFORCED", evidence: { test_count, coverage_pct, threshold } };
}
var init_dev = __esm({
  "src/engine/gate-profiles/dev.ts"() {
    "use strict";
  }
});

// src/engine/gate-profiles/staff-review.ts
import * as childProcess2 from "node:child_process";
import * as fs9 from "node:fs";
function realRunner(command, args, cwd) {
  const result = childProcess2.spawnSync(command, args, { cwd, encoding: "utf8", timeout: 3e4 });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr
  };
}
function gitRunner(args, cwd) {
  const env = { ...process.env };
  for (const key of GIT_ENV_KEYS_TO_STRIP) {
    delete env[key];
  }
  const result = childProcess2.spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 3e4,
    env
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr
  };
}
function runStaffReviewGate(input) {
  const { cwd } = input;
  if (!cwd) {
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "Missing required context.cwd" }
    };
  }
  if (!fs9.existsSync(cwd)) {
    return { verdict: "FAIL", status: "ENFORCED", evidence: { reason: `cwd not found: ${cwd}` } };
  }
  const gitResult = gitRunner(["log", "--oneline", "-1"], cwd);
  const commit_present = gitResult.exitCode === 0 && gitResult.stdout.trim().length > 0;
  const npmRunner = input.runner ?? realRunner;
  const typecheckResult = npmRunner("npm", ["run", "typecheck"], cwd);
  const typecheck_clean = typecheckResult.exitCode === 0;
  const typecheck_errors = typecheck_clean ? void 0 : (typecheckResult.stderr || typecheckResult.stdout).slice(0, 1e3);
  if (commit_present && typecheck_clean) {
    return {
      verdict: "PASS",
      status: "ENFORCED",
      evidence: { commit_present: true, typecheck_clean: true }
    };
  }
  return {
    verdict: "FAIL",
    status: "ENFORCED",
    evidence: {
      commit_present,
      typecheck_clean,
      ...typecheck_errors !== void 0 ? { typecheck_errors } : {}
    }
  };
}
var GIT_ENV_KEYS_TO_STRIP;
var init_staff_review = __esm({
  "src/engine/gate-profiles/staff-review.ts"() {
    "use strict";
    GIT_ENV_KEYS_TO_STRIP = [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_INDEX_FILE",
      "GIT_OBJECT_DIRECTORY",
      "GIT_ALTERNATE_OBJECT_DIRECTORIES",
      "GIT_COMMON_DIR"
    ];
  }
});

// src/engine/gate-profiles/index.ts
var gate_profiles_exports = {};
__export(gate_profiles_exports, {
  runGateProfile: () => runGateProfile
});
function runGateProfile(input) {
  switch (input.gate_type) {
    case "acceptance-criteria":
      return runAcceptanceCriteriaGate(input);
    case "qa-spec":
      return runQaSpecGate(input);
    case "dev":
      return runDevGate(input);
    case "staff-review":
      return runStaffReviewGate(input);
    default:
      throw new Error(`Unknown gate_type: ${input.gate_type}`);
  }
}
var init_gate_profiles = __esm({
  "src/engine/gate-profiles/index.ts"() {
    "use strict";
    init_acceptance_criteria();
    init_qa_spec();
    init_dev();
    init_staff_review();
  }
});

// src/skill/teo-run-entry.ts
function writeJson(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
function exitError(obj) {
  writeJson(obj);
  process.exit(1);
}
async function handleProvision(args) {
  const { provision: provision2 } = await Promise.resolve().then(() => (init_provision(), provision_exports));
  const opts = args;
  const rev = opts.revocationOpts;
  if (Array.isArray(rev["signature"])) {
    const arr = rev["signature"];
    const isAllZeros = arr.length > 0 && arr.every((b) => b === 0);
    rev["signature"] = isAllZeros ? void 0 : new Uint8Array(arr);
  }
  if (Array.isArray(rev["publicKey"])) {
    rev["publicKey"] = new Uint8Array(rev["publicKey"]);
  }
  let result;
  try {
    result = await provision2(opts);
  } catch (err2) {
    const message = err2 instanceof Error ? err2.message : String(err2);
    result = { status: "error", kind: "io_error", reason: message };
  }
  if (result.status === "error") {
    writeJson(result);
    process.exit(1);
  }
  writeJson(result);
  if ("warning" in result && typeof result.warning === "string") {
    process.stderr.write(`[teo] provision warning: ${result.warning}
`);
  }
}
async function handleValidatePlan(args) {
  const { PlanSchema: PlanSchema2 } = await Promise.resolve().then(() => (init_plan(), plan_exports));
  const parsed = PlanSchema2.safeParse(args);
  if (parsed.success) {
    writeJson({ valid: true });
  } else {
    writeJson({
      valid: false,
      errors: parsed.error.issues
    });
  }
}
async function handleValidateArtifact(rawJsonArg) {
  const { repairJson: repairJson2, validateArtifact: validateArtifact2 } = await Promise.resolve().then(() => (init_artifacts(), artifacts_exports));
  let parsedArg;
  try {
    const repaired = repairJson2(rawJsonArg);
    parsedArg = JSON.parse(repaired);
  } catch (err2) {
    const msg = err2 instanceof Error ? err2.message : String(err2);
    writeJson({ valid: false, errors: [`JSON repair/parse error: ${msg}`] });
    return;
  }
  const a = parsedArg;
  const type = a["type"];
  const strictRaw = a["strict"];
  let payload = a["payload"];
  if (typeof payload === "string") {
    let reparsed;
    try {
      const repairedPayload = repairJson2(payload);
      reparsed = JSON.parse(repairedPayload);
    } catch (err2) {
      const msg = err2 instanceof Error ? err2.message : String(err2);
      writeJson({ valid: false, errors: [`JSON repair/parse error on payload: ${msg}`] });
      return;
    }
    if (typeof reparsed === "string") {
      writeJson({
        valid: false,
        errors: [`JSON repair/parse failed: payload string could not be parsed as a JSON object`]
      });
      return;
    }
    payload = reparsed;
  }
  const callArgs = typeof strictRaw === "boolean" ? { type, payload, strict: strictRaw } : { type, payload };
  const result = validateArtifact2(callArgs);
  writeJson(result);
}
async function handleSign(args) {
  const { HmacSigner: HmacSigner2 } = await Promise.resolve().then(() => (init_sign(), sign_exports));
  const a = args;
  const baseDir = a["baseDir"];
  const keyring_id = a["keyring_id"];
  const signerOpts = {};
  if (baseDir !== void 0) signerOpts.baseDir = baseDir;
  if (keyring_id !== void 0) signerOpts.keyring_id = keyring_id;
  const signer = new HmacSigner2(signerOpts);
  const payload = a["payload"];
  const signature = signer.sign(payload);
  writeJson({ signature });
}
async function handleLedgerAppend(args) {
  const { AppendOnlyLedger: AppendOnlyLedger2 } = await Promise.resolve().then(() => (init_ledger(), ledger_exports));
  const a = args;
  const baseDir = a["baseDir"];
  const ledgerOpts = {
    session_id: a["session_id"]
  };
  if (baseDir !== void 0) ledgerOpts.baseDir = baseDir;
  const ledger = new AppendOnlyLedger2(ledgerOpts);
  const entry = a["entry"];
  const result = ledger.append(entry);
  writeJson(result);
}
async function handleLedgerClose(args) {
  const { AppendOnlyLedger: AppendOnlyLedger2 } = await Promise.resolve().then(() => (init_ledger(), ledger_exports));
  const a = args;
  const baseDir = a["baseDir"];
  const ledgerOpts = {
    session_id: a["session_id"]
  };
  if (baseDir !== void 0) ledgerOpts.baseDir = baseDir;
  const ledger = new AppendOnlyLedger2(ledgerOpts);
  const summary = a["summary"];
  ledger.close(summary);
  writeJson({ ok: true });
}
var VALID_DIRECTIVES = /* @__PURE__ */ new Set(["BUILD", "FIX", "REVIEW", "PLAN", "ARCHITECTURAL"]);
function handlePlanInit(args) {
  const a = args;
  const session_id = a["session_id"];
  const project_id = a["project_id"];
  const directive = a["directive"];
  if (typeof session_id !== "string" || !session_id || session_id.length === 0) {
    exitError({ error: "Missing required field: session_id" });
  }
  if (typeof project_id !== "string" || !project_id || project_id.length === 0) {
    exitError({ error: "Missing required field: project_id" });
  }
  if (directive !== void 0 && !VALID_DIRECTIVES.has(directive)) {
    exitError({ error: `Invalid directive: ${directive}` });
  }
  const plan_id = `plan_${session_id}_${Date.now()}`;
  writeJson({ ok: true, session_id, plan_id, initialized_at: (/* @__PURE__ */ new Date()).toISOString() });
}
async function handleEvaluateGate(args) {
  const { AppendOnlyLedger: AppendOnlyLedger2 } = await Promise.resolve().then(() => (init_ledger(), ledger_exports));
  const { runGateProfile: runGateProfile2 } = await Promise.resolve().then(() => (init_gate_profiles(), gate_profiles_exports));
  const a = args;
  const gate_id = a["gate_id"];
  const task_id = a["task_id"];
  const session_id = a["session_id"];
  const gate_type = a["gate_type"];
  if (typeof gate_id !== "string" || gate_id.length === 0) {
    exitError({ error: "Missing required field: gate_id" });
  }
  if (typeof task_id !== "string" || task_id.length === 0) {
    exitError({ error: "Missing required field: task_id" });
  }
  if (typeof session_id !== "string" || session_id.length === 0) {
    exitError({ error: "Missing required field: session_id" });
  }
  const KNOWN_GATE_TYPES = ["acceptance-criteria", "qa-spec", "dev", "staff-review"];
  if (typeof gate_type !== "string" || gate_type.length === 0) {
    exitError({ error: "Missing required field: gate_type" });
  }
  if (!KNOWN_GATE_TYPES.includes(gate_type)) {
    exitError({ error: `Unknown gate_type: ${gate_type}` });
  }
  const baseDir = a["ledger_base_dir"];
  const ledgerOpts = {
    session_id
  };
  if (baseDir !== void 0) ledgerOpts.baseDir = baseDir;
  const ledger = new AppendOnlyLedger2(ledgerOpts);
  const context = a["context"];
  const cwd = typeof context?.["cwd"] === "string" ? context["cwd"] : "";
  const mockRunnerRaw = context?.["mock_runner"];
  let runner;
  if (mockRunnerRaw !== void 0) {
    runner = (_cmd, _args, _cwd) => ({
      exitCode: mockRunnerRaw.exit_code,
      stdout: mockRunnerRaw.stdout,
      stderr: mockRunnerRaw.stderr
    });
  }
  let profileResult;
  try {
    const profileInput = runner !== void 0 ? { cwd, gate_type, ...context !== void 0 ? { context } : {}, runner } : { cwd, gate_type, ...context !== void 0 ? { context } : {} };
    profileResult = runGateProfile2(profileInput);
  } catch (err2) {
    const msg = err2 instanceof Error ? err2.message : String(err2);
    exitError({ error: msg });
  }
  const { verdict, evidence } = profileResult;
  const entry = ledger.append({
    session_id,
    workflow_id: gate_id,
    task_id,
    turn_id: null,
    actor_id: "SYSTEM",
    actor_type: "SYSTEM",
    phase: "GATE",
    verdict,
    detail: {
      gate_id,
      gate_type,
      status: "ENFORCED"
    }
  });
  const evaluated_at = (/* @__PURE__ */ new Date()).toISOString();
  writeJson({
    gate_id,
    task_id,
    session_id,
    verdict,
    status: "ENFORCED",
    evaluated_at,
    gate_type,
    ledger_seq: entry.seq,
    evidence
  });
  if (verdict !== "PASS") {
    process.exit(1);
  }
}
async function handleVerifyLedger(args) {
  const fs10 = await import("node:fs");
  const crypto3 = await import("node:crypto");
  const { verifyAsync: verifyAsync2 } = await Promise.resolve().then(() => (init_ed255192(), ed25519_exports));
  const a = args;
  const ledger_file = a["ledger_file"];
  const public_key = a["public_key"];
  if (typeof ledger_file !== "string" || ledger_file.length === 0) {
    exitError({ ok: false, error: "Missing required field: ledger_file" });
  }
  if (!fs10.existsSync(ledger_file)) {
    exitError({ ok: false, error: `Ledger file not found: ${ledger_file}` });
  }
  const fileContent = fs10.readFileSync(ledger_file, "utf8");
  const rawLines = fileContent.split("\n").filter((l) => l.trim().length > 0);
  if (rawLines.length === 0) {
    exitError({ ok: false, error: "Ledger file is empty or contains no valid entries" });
  }
  const parsedEntries = [];
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      exitError({ ok: false, error: `Malformed JSON at line ${i + 1}: ${raw.slice(0, 80)}` });
    }
    parsedEntries.push({ raw, obj });
  }
  const hasAnyPrevHash = parsedEntries.some((e) => "prev_hash" in e.obj);
  if (hasAnyPrevHash) {
    for (let i = 0; i < parsedEntries.length; i++) {
      const entry = parsedEntries[i];
      const seq = entry.obj["seq"];
      if (i === 0) {
        const prev_hash = entry.obj["prev_hash"];
        if (prev_hash !== null && prev_hash !== void 0) {
          exitError({
            ok: false,
            error: "Hash chain broken: first entry must have prev_hash null or absent",
            broken_at_seq: seq
          });
        }
      } else {
        const prevRaw = parsedEntries[i - 1].raw;
        const expectedHash = crypto3.createHash("sha256").update(prevRaw, "utf8").digest("hex");
        const prev_hash = entry.obj["prev_hash"];
        if (prev_hash !== expectedHash) {
          exitError({
            ok: false,
            error: `Hash chain broken at seq ${String(seq)}: prev_hash mismatch`,
            broken_at_seq: seq
          });
        }
      }
    }
  } else {
    for (let i = 0; i < parsedEntries.length; i++) {
      const entry = parsedEntries[i];
      const seq = entry.obj["seq"];
      const expectedSeq = i + 1;
      if (seq !== expectedSeq) {
        exitError({
          ok: false,
          error: `Sequence broken: expected seq ${expectedSeq}, got ${String(seq)}`,
          broken_at_seq: seq
        });
      }
    }
  }
  if (typeof public_key === "string" && public_key.length > 0) {
    const pubKeyBytes = Buffer.from(public_key, "hex");
    for (const entry of parsedEntries) {
      const sig = entry.obj["signature"];
      if (typeof sig === "string" && sig.length > 0) {
        const sigBytes = Buffer.from(sig, "hex");
        const lineBytes = Buffer.from(entry.raw, "utf8");
        const valid = await verifyAsync2(
          new Uint8Array(sigBytes),
          new Uint8Array(lineBytes),
          new Uint8Array(pubKeyBytes)
        );
        if (!valid) {
          const seq = entry.obj["seq"];
          exitError({
            ok: false,
            error: `Signature verification failed at seq ${String(seq)}`
          });
        }
      }
    }
  }
  writeJson({ ok: true, entry_count: parsedEntries.length, chain_intact: true });
}
async function main() {
  const [, , command, jsonArg] = process.argv;
  if (!command) {
    exitError({ error: "No command specified. Usage: teo-run <command> '<json>'" });
  }
  if (command === "validate-artifact") {
    try {
      await handleValidateArtifact(jsonArg ?? "{}");
    } catch (err2) {
      const message = err2 instanceof Error ? err2.message : String(err2);
      exitError({ error: message });
    }
    return;
  }
  let args;
  try {
    args = JSON.parse(jsonArg ?? "{}");
  } catch {
    exitError({ error: `Invalid JSON argument: ${jsonArg}` });
  }
  try {
    switch (command) {
      case "provision":
        await handleProvision(args);
        break;
      case "validate-plan":
        await handleValidatePlan(args);
        break;
      case "sign":
        await handleSign(args);
        break;
      case "ledger-append":
        await handleLedgerAppend(args);
        break;
      case "ledger-close":
        await handleLedgerClose(args);
        break;
      case "plan-init":
        handlePlanInit(args);
        break;
      case "evaluate-gate":
        await handleEvaluateGate(args);
        break;
      case "verify-ledger":
        await handleVerifyLedger(args);
        break;
      default:
        exitError({ error: `Unknown command: ${command}` });
    }
  } catch (err2) {
    const message = err2 instanceof Error ? err2.message : String(err2);
    exitError({ error: message });
  }
}
main().catch((err2) => {
  const message = err2 instanceof Error ? err2.message : String(err2);
  exitError({ error: message });
});
/*! Bundled license information:

@noble/ed25519/index.js:
  (*! noble-ed25519 - MIT License (c) 2019 Paul Miller (paulmillr.com) *)
*/
