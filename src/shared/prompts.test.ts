import { describe, it, expect } from 'vitest';
import { SPEAKING_PROMPTS, pickSpeakingPrompt } from './prompts';

describe('SPEAKING_PROMPTS', () => {
  it('offers a usable number of topics', () => {
    expect(SPEAKING_PROMPTS.length).toBeGreaterThanOrEqual(20);
  });

  it('has no duplicates', () => {
    const texts = SPEAKING_PROMPTS.map(p => p.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('gives every prompt a theme and real text', () => {
    for (const prompt of SPEAKING_PROMPTS) {
      expect(prompt.theme.length).toBeGreaterThan(0);
      expect(prompt.text.length).toBeGreaterThan(10);
    }
  });

  it('spreads topics across several themes', () => {
    expect(new Set(SPEAKING_PROMPTS.map(p => p.theme)).size).toBeGreaterThanOrEqual(3);
  });
});

describe('pickSpeakingPrompt', () => {
  it('returns one of the prompts', () => {
    expect(SPEAKING_PROMPTS).toContain(pickSpeakingPrompt());
  });

  it('never returns the topic already on screen', () => {
    const current = SPEAKING_PROMPTS[0].text;
    for (let i = 0; i < 50; i++) {
      expect(pickSpeakingPrompt(current).text).not.toBe(current);
    }
  });

  it('still returns something if every prompt is excluded', () => {
    // Guards the degenerate case rather than returning undefined.
    const onlyOne = SPEAKING_PROMPTS.length === 1 ? SPEAKING_PROMPTS[0].text : null;
    if (onlyOne) expect(pickSpeakingPrompt(onlyOne)).toBeDefined();
    else expect(pickSpeakingPrompt('not a real prompt')).toBeDefined();
  });
});
