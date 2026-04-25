import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The wallet boundary from the spec: cow-mcp must never sign, broadcast, or
// hold private keys. This test enforces that as a static check on src/.
// If any of these patterns has a legitimate use, exclude it explicitly.
const FORBIDDEN = [
  'signTypedData',
  'sendTransaction',
  'sendRawTransaction',
  'eth_sendRawTransaction',
  'privateKey',
  'PRIVATE_KEY',
  'mnemonic',
  'MNEMONIC',
  'privateKeyToAccount',
  'mnemonicToAccount',
  'hdKeyToAccount',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('wallet boundary invariant', () => {
  it('src/ contains no signing or key-handling references', () => {
    const root = new URL('../src', import.meta.url).pathname;
    const files = walk(root);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const pat of FORBIDDEN) {
        if (text.includes(pat)) hits.push(`${file}: ${pat}`);
      }
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });
});
