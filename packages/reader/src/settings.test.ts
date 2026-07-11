// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  VOICE_CHOICE_KEY,
  getBestVoice,
  parseReaderSettings,
  rememberVoiceChoice,
} from './settings';

const dl = (name: string) => `/dl?filename=${name}`;

beforeEach(() => localStorage.clear());

describe('parseReaderSettings (reader.ts:223-257)', () => {
  it('defaults: popout on, no media, no exam gate', () => {
    const parsed = parseReaderSettings('{}', dl);
    expect(parsed.allowPopout).toBe(true);
    expect(parsed.youtube).toBe('');
    expect(parsed.video).toBe('');
    expect(parsed.startTimerButton).toBe(false);
    expect(parsed.slides).toBe('');
    expect(parsed.timeLimit).toBeNull();
  });

  it('string youtube/video pass through; popout/header/summary read', () => {
    const parsed = parseReaderSettings(
      JSON.stringify({
        youtube: 'abc123',
        popout: false,
        header: 'Chapter 1',
        summary: 'A summary.',
        time_limit: '45min',
      }),
      dl,
    );
    expect(parsed.youtube).toBe('abc123');
    expect(parsed.allowPopout).toBe(false);
    expect(parsed.header).toBe('Chapter 1');
    expect(parsed.summary).toBe('A summary.');
    expect(parsed.timeLimit).toBe('45min');
  });

  it('voice maps pick the remembered voice, else the first option', () => {
    const options = { Alice: 'vidA', Bob: 'vidB' };
    expect(parseReaderSettings(JSON.stringify({ youtube: options }), dl).youtube).toBe('vidA');
    localStorage.setItem(VOICE_CHOICE_KEY, JSON.stringify(['Bob']));
    expect(parseReaderSettings(JSON.stringify({ youtube: options }), dl).youtube).toBe('vidB');
  });

  it('slides: relative names resolve through download_file; https stays', () => {
    expect(parseReaderSettings(JSON.stringify({ slides: 'deck.pdf' }), dl).slides).toBe(
      '/dl?filename=deck.pdf',
    );
    expect(
      parseReaderSettings(JSON.stringify({ slides: 'https://x.test/deck.pdf' }), dl).slides,
    ).toBe('https://x.test/deck.pdf');
  });
});

describe('voice memory (reader.ts:183-221)', () => {
  it('rememberVoiceChoice moves the choice to the front', () => {
    rememberVoiceChoice('Alice');
    rememberVoiceChoice('Bob');
    rememberVoiceChoice('Alice');
    expect(JSON.parse(localStorage.getItem(VOICE_CHOICE_KEY)!)).toEqual(['Alice', 'Bob']);
  });

  it('getBestVoice skips remembered voices missing from the options', () => {
    localStorage.setItem(VOICE_CHOICE_KEY, JSON.stringify(['Ghost', 'Bob']));
    expect(getBestVoice({ Alice: 'vidA', Bob: 'vidB' })).toBe('vidB');
  });

  it('corrupt storage falls back to the first option', () => {
    localStorage.setItem(VOICE_CHOICE_KEY, 'not json');
    expect(getBestVoice({ Alice: 'vidA' })).toBe('vidA');
  });
});
