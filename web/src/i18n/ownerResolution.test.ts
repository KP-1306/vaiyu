import { describe, it, expect, beforeAll } from 'vitest';
import i18n from './index';

// Proves the reveal-gate MECHANISM and the no-raw-key guarantee at the i18n
// resolution layer (jsdom/@testing-library aren't in the repo, so we exercise
// the same i18n instance the owner hook uses rather than rendering React).
//
// useOwnerT, while gated, calls t(key, { defaultValue, lng: 'en' }). The first
// test pins the critical safety property: that returns English EVEN WHEN the
// active language is Hindi — which matters because vaiyu.lang is SHARED with the
// guest portal, so a guest-side Hindi switch must NOT leak into the owner console
// before reveal. The second test shows the post-reveal behaviour (no lng pin →
// Hindi). The third shows a missing key degrades to the English default.

describe('owner i18n resolution + reveal-gate', () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await new Promise<void>((resolve) => i18n.on('initialized', () => resolve()));
    }
    await i18n.changeLanguage('hi');
    await i18n.loadNamespaces(['owner-common', 'owner-pickup']);
  });

  it('gated owner calls (lng:en) stay English even when the language is Hindi', () => {
    expect(i18n.language).toMatch(/^hi/);
    expect(i18n.t('owner-pickup:title', { defaultValue: 'Pick-up', lng: 'en' })).toBe('Pick-up');
    expect(i18n.t('owner-common:actions.save', { defaultValue: 'Save', lng: 'en' })).toBe('Save');
  });

  it('post-reveal (no lng pin) owner strings resolve to Hindi', () => {
    expect(i18n.t('owner-pickup:title', { defaultValue: 'Pick-up' })).toBe('पिकअप');
    expect(i18n.t('owner-common:actions.save', { defaultValue: 'Save' })).toBe('सेव करें');
  });

  it('a missing key degrades to the English default, never a raw key', () => {
    expect(i18n.t('owner-pickup:does.not.exist', { defaultValue: 'Fallback', lng: 'en' })).toBe('Fallback');
  });
});
