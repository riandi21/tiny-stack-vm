import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Tiny stack VM for tiny-stack-vm-01: runs each bytecode program and writes
// exactly the bytes it writes plus its exit code. ISA.md in the kit is the
// spec; the reference VM is what the expected answers come from.
// [immediate bytes, pops, pushes] per opcode; an absent byte is unknown.
const T: { [k: number]: number[] } = {
  0x00: [0, 0, 0], 0x01: [1, 0, 1], 0x02: [4, 0, 1], 0x03: [0, 1, 0],
  0x04: [0, 1, 2], 0x05: [0, 2, 2], 0x06: [0, 2, 3], 0x07: [0, 3, 3],
  0x10: [0, 2, 1], 0x11: [0, 2, 1], 0x12: [0, 2, 1], 0x13: [0, 2, 1],
  0x14: [0, 2, 1], 0x15: [0, 2, 1], 0x16: [0, 2, 1], 0x17: [0, 1, 1],
  0x18: [0, 2, 1], 0x19: [0, 2, 1], 0x1a: [0, 2, 1], 0x1b: [0, 1, 1],
  0x1c: [0, 2, 1], 0x1d: [0, 2, 1], 0x1e: [0, 2, 1],
  0x20: [0, 2, 1], 0x21: [0, 2, 1], 0x22: [0, 2, 1],
  0x30: [2, 0, 0], 0x31: [2, 1, 0], 0x32: [2, 1, 0], 0x33: [2, 0, 0],
  0x34: [0, 0, 0], 0x40: [0, 1, 1], 0x41: [0, 2, 0],
  0x50: [0, 1, 0], 0x51: [0, 1, 0], 0x52: [0, 0, 1], 0x53: [0, 1, 0],
};

function run(p: Uint8Array, inp: Uint8Array): { o: number[]; c: number } {
  const D: number[] = [];
  const C: number[] = [];
  const M = new Array(256).fill(0);
  const o: number[] = [];
  const n = p.length;
  let pc = 0;
  let ip = 0;
  let steps = 0;
  for (;;) {
    if (steps === 1e6) return { o, c: 10 };
    if (pc < 0 || pc >= n) return { o, c: 9 };
    const op = p[pc];
    const t = T[op];
    if (!t) return { o, c: 5 };
    if (pc + t[0] >= n) return { o, c: 9 };
    steps++;
    const nx = pc + 1 + t[0];
    if (D.length < t[1]) return { o, c: 2 };
    if (D.length - t[1] + t[2] > 256) return { o, c: 3 };
    pc = nx;
    if (op >= 0x10 && op <= 0x22 && op !== 0x17 && op !== 0x1b) {
      const b = D[D.length - 1];
      const a = D[D.length - 2];
      D.length -= 2;
      let r: number;
      if (op === 0x10) r = (a + b) | 0;
      else if (op === 0x11) r = (a - b) | 0;
      else if (op === 0x12) r = Math.imul(a, b);
      else if (op === 0x13) {
        if (b === 0) return { o, c: 4 };
        r = (a / b) | 0;
      } else if (op === 0x14) {
        if (b === 0) return { o, c: 4 };
        r = a % b;
      } else if (op === 0x15) {
        if (b === 0) return { o, c: 4 };
        r = ((a >>> 0) / (b >>> 0)) | 0;
      } else if (op === 0x16) {
        if (b === 0) return { o, c: 4 };
        r = ((a >>> 0) % (b >>> 0)) | 0;
      } else if (op === 0x18) r = a & b;
      else if (op === 0x19) r = a | b;
      else if (op === 0x1a) r = a ^ b;
      else if (op === 0x1c) r = a << (b & 31);
      else if (op === 0x1d) r = a >> (b & 31);
      else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
      else if (op === 0x20) r = a === b ? 1 : 0;
      else if (op === 0x21) r = a < b ? 1 : 0;
      else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
      D.push(r);
      continue;
    }
    switch (op) {
      case 0x00:
        return { o, c: 0 };
      case 0x01:
        D.push((p[nx - 1] << 24) >> 24);
        break;
      case 0x02:
        D.push(p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24));
        break;
      case 0x03:
        D.length--;
        break;
      case 0x04:
        D.push(D[D.length - 1]);
        break;
      case 0x05: {
        const t = D[D.length - 1];
        D[D.length - 1] = D[D.length - 2];
        D[D.length - 2] = t;
        break;
      }
      case 0x06:
        D.push(D[D.length - 2]);
        break;
      case 0x07: {
        const a = D[D.length - 3];
        D[D.length - 3] = D[D.length - 2];
        D[D.length - 2] = D[D.length - 1];
        D[D.length - 1] = a;
        break;
      }
      case 0x17:
        D[D.length - 1] = (-D[D.length - 1]) | 0;
        break;
      case 0x1b:
        D[D.length - 1] = ~D[D.length - 1];
        break;
      case 0x30:
      case 0x31:
      case 0x32: {
        const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        if (op === 0x30) pc = nx + rel;
        else {
          const v = D[D.length - 1];
          D.length--;
          if ((op === 0x31) === (v === 0)) pc = nx + rel;
        }
        break;
      }
      case 0x33:
        if (C.length === 64) return { o, c: 7 };
        C.push(nx);
        pc = p[nx - 2] | (p[nx - 1] << 8);
        break;
      case 0x34:
        if (C.length === 0) return { o, c: 8 };
        pc = C[C.length - 1];
        C.length--;
        break;
      case 0x40: {
        const addr = D[D.length - 1];
        if (addr < 0 || addr >= 256) return { o, c: 6 };
        D[D.length - 1] = M[addr];
        break;
      }
      case 0x41: {
        const addr = D[D.length - 1];
        const v = D[D.length - 2];
        if (addr < 0 || addr >= 256) return { o, c: 6 };
        D.length -= 2;
        M[addr] = v;
        break;
      }
      case 0x50: {
        const s = String(D[D.length - 1]);
        if (o.length + s.length > 65536) return { o, c: 11 };
        D.length--;
        for (let i = 0; i < s.length; i++) o.push(s.charCodeAt(i));
        break;
      }
      case 0x51:
        if (o.length + 1 > 65536) return { o, c: 11 };
        o.push(D[D.length - 1] & 255);
        D.length--;
        break;
      case 0x52:
        D.push(ip < inp.length ? inp[ip++] : -1);
        break;
      case 0x53:
        return { o, c: D[D.length - 1] & 255 };
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), Uint8Array.from(r.o));
  writeFileSync(join(O, id, 'exit.txt'), `${r.c}\n`);
}
