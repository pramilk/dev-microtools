import { describe, it, expect } from 'vitest';
import { looksLikeImageFile } from './imageFile';

describe('looksLikeImageFile', () => {
  it('trusts a declared image/* type', () => {
    expect(looksLikeImageFile({ type: 'image/png', name: 'photo.png' })).toBe(true);
    expect(looksLikeImageFile({ type: 'image/jpeg', name: 'weird-name' })).toBe(true);
  });

  it('rejects a declared non-image type regardless of extension', () => {
    expect(looksLikeImageFile({ type: 'application/pdf', name: 'photo.png' })).toBe(false);
    expect(looksLikeImageFile({ type: 'text/plain', name: 'notes.txt' })).toBe(false);
  });

  it('falls back to the extension when the type is blank', () => {
    expect(looksLikeImageFile({ type: '', name: 'photo.jpg' })).toBe(true);
    expect(looksLikeImageFile({ type: '', name: 'photo.PNG' })).toBe(true);
    expect(looksLikeImageFile({ type: '', name: 'icon.webp' })).toBe(true);
  });

  it('rejects a blank type with no recognizable image extension', () => {
    expect(looksLikeImageFile({ type: '', name: 'resume.docx' })).toBe(false);
    expect(looksLikeImageFile({ type: '', name: 'unknown' })).toBe(false);
  });
});
