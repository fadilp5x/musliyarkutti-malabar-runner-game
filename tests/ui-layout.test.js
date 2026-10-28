import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../src/ui/screens.css', import.meta.url), 'utf8');

describe('full-screen UI overlay layout', () => {
  it('anchors the screen stack to the viewport instead of its content height', () => {
    expect(styles).toMatch(/\.mmr-screens\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*height:\s*100%/s);
    expect(styles).toMatch(/\.mmr-ui\s*\{[^}]*overflow:\s*hidden;/s);
    expect(styles).toMatch(/\.mmr-ui \.screen\s*\{[^}]*max-height:\s*100dvh;/s);
    expect(styles).toMatch(/#screen-tap > \*:not\(\.tap-bg\):not\(\.particle-layer\):not\(\.corner-links\)/);
  });
});
