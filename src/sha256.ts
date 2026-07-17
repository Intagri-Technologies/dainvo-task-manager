// Small synchronous SHA-256 implementation for identity and line hashes.
// Keeping this synchronous lets Vault.process() revalidate task lines while
// removing the plugin's former dependency on node:crypto.

const INITIAL_HASH: readonly number[] = [
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
];

const ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

export function sha256(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const lengthView = new DataView(padded.buffer);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  lengthView.setUint32(paddedLength - 8, high, false);
  lengthView.setUint32(paddedLength - 4, low, false);

  const hash = [...INITIAL_HASH];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const view = new DataView(padded.buffer, offset, 64);
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15] ?? 0;
      const word2 = words[index - 2] ?? 0;
      const sigma0 =
        rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3);
      const sigma1 =
        rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10);
      words[index] = add(
        words[index - 16] ?? 0,
        sigma0,
        words[index - 7] ?? 0,
        sigma1,
      );
    }

    let [a, b, c, d, e, f, g, h] = hash;

    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = add(
        h,
        bigSigma1,
        choice,
        ROUND_CONSTANTS[index] ?? 0,
        words[index] ?? 0,
      );
      const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = add(bigSigma0, majority);

      h = g;
      g = f;
      f = e;
      e = add(d, temp1);
      d = c;
      c = b;
      b = a;
      a = add(temp1, temp2);
    }

    hash[0] = add(hash[0] ?? 0, a);
    hash[1] = add(hash[1] ?? 0, b);
    hash[2] = add(hash[2] ?? 0, c);
    hash[3] = add(hash[3] ?? 0, d);
    hash[4] = add(hash[4] ?? 0, e);
    hash[5] = add(hash[5] ?? 0, f);
    hash[6] = add(hash[6] ?? 0, g);
    hash[7] = add(hash[7] ?? 0, h);
  }

  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

function add(...values: number[]): number {
  return values.reduce((sum, value) => (sum + value) >>> 0, 0);
}
