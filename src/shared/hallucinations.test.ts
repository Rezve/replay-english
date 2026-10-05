import { describe, it, expect } from 'vitest';
import { dropHallucinations } from './hallucinations';

const seg = (text: string) => ({ text });
const texts = (input: string[]) => dropHallucinations(input.map(seg)).map(s => s.text);

describe('dropHallucinations', () => {
  it('drops the "You" wall Whisper writes over silence', () => {
    expect(texts(['You', 'You', 'You', 'You'])).toEqual([]);
  });

  it('drops a lone "You" in any casing or punctuation', () => {
    expect(texts(['We shipped it.', ' you. ', 'Next item.'])).toEqual(['We shipped it.', 'Next item.']);
  });

  it('keeps "you" inside real speech', () => {
    expect(texts(['Can you hear me?', 'Thank you for joining.'])).toEqual(['Can you hear me?', 'Thank you for joining.']);
  });

  it('keeps a single stock phrase, which can be real', () => {
    expect(texts(['That is all.', 'Thank you.'])).toEqual(['That is all.', 'Thank you.']);
  });

  it('drops every copy of a repeated stock phrase', () => {
    expect(texts(['Thank you.', 'Thank you.', 'Real words.'])).toEqual(['Real words.']);
  });

  it('collapses a repetition loop of ordinary text to one line', () => {
    expect(texts(['I think so.', 'I think so.', 'I think so.', 'Moving on.'])).toEqual(['I think so.', 'Moving on.']);
  });

  it('leaves a genuine double repeat alone', () => {
    expect(texts(['No.', 'No.', 'Absolutely not.'])).toEqual(['No.', 'No.', 'Absolutely not.']);
  });

  it('keeps the original objects', () => {
    const input = [{ text: 'Hello.', startTime: 1 }];
    expect(dropHallucinations(input)[0]).toBe(input[0]);
  });
});
