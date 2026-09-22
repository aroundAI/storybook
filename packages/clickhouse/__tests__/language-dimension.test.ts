import { describe, expect, it } from 'vitest';

import {
  LANGUAGE_NOT_SET,
  fromDimLanguage,
  toDimLanguage,
} from '../src/lib/language-dimension';

describe('language dimension (FILM-1702)', () => {
  describe('toDimLanguage', () => {
    it('writes a language nobody set as the not-set value, never as a code', () => {
      // `?? 'en'` here is what made English the bucket for every publish
      // nobody had labelled.
      expect(toDimLanguage(null)).toBe(LANGUAGE_NOT_SET);
      expect(toDimLanguage(undefined)).toBe(LANGUAGE_NOT_SET);
    });

    it('treats blank and whitespace as not set', () => {
      expect(toDimLanguage('')).toBe(LANGUAGE_NOT_SET);
      expect(toDimLanguage('  ')).toBe(LANGUAGE_NOT_SET);
    });

    it('keeps a real code as it is, including English', () => {
      expect(toDimLanguage('en')).toBe('en');
      expect(toDimLanguage('pt-BR')).toBe('pt-BR');
    });
  });

  describe('fromDimLanguage', () => {
    it('reads the not-set value back as null', () => {
      expect(fromDimLanguage(LANGUAGE_NOT_SET)).toBeNull();
      expect(fromDimLanguage(null)).toBeNull();
      expect(fromDimLanguage(undefined)).toBeNull();
    });

    it('reads a real code back unchanged', () => {
      expect(fromDimLanguage('en')).toBe('en');
      expect(fromDimLanguage('hi')).toBe('hi');
    });
  });

  it('uses the value ClickHouse fills in for a column an insert omits', () => {
    // A writer that was never updated leaves `channel_language` out. The
    // column's implicit default is the empty string, so that row must read
    // as not set. A sentinel like 'unknown' would not have this property.
    expect(LANGUAGE_NOT_SET).toBe('');
  });
});
