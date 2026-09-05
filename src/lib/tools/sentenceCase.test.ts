import { describe, expect, it } from 'vitest';
import { applySentenceCase, toggleGuessedCase, type NerClassifier, type NerEntity, type NerEntityType } from './sentenceCase';

/** The default classifier for every test that isn't specifically exercising NER behavior —
 *  equivalent to the model being unavailable, so these tests lock in compromise-only
 *  behavior exactly as before this module gained a second signal. */
const noEntities: NerClassifier = async () => [];

/** Builds a one-entity fake classifier result by locating `word` in `text` — avoids every
 *  NER-specific test having to hand-compute character offsets. */
function entityFor(text: string, word: string, type: NerEntityType, score: number): NerEntity {
  const start = text.indexOf(word);
  if (start === -1) throw new Error(`test setup error: "${word}" not found in "${text}"`);
  return { type, score, start, end: start + word.length };
}

describe('applySentenceCase', () => {
  it('returns empty output for empty input', async () => {
    const result = await applySentenceCase('', noEntities);
    expect(result).toEqual({ text: '', lowConfidenceRanges: [] });
  });

  it('returns whitespace-only input unchanged', async () => {
    const result = await applySentenceCase('   ', noEntities);
    expect(result).toEqual({ text: '   ', lowConfidenceRanges: [] });
  });

  it('capitalizes known people, places and organizations regardless of source casing', async () => {
    const result = await applySentenceCase('john smith went to paris and google.', noEntities);
    expect(result.text).toBe('John Smith went to Paris and Google.');
  });

  it('lowercases ordinary words while preserving sentence-start capitals', async () => {
    const result = await applySentenceCase('THE QUICK fox JUMPS over the lazy dog.', noEntities);
    expect(result.text).toBe('The quick fox jumps over the lazy dog.');
  });

  it('capitalizes standalone "i" and its contractions, in any input casing', async () => {
    const result = await applySentenceCase("i think i'm right, i've seen it, i'll go, i'd rather not.", noEntities);
    expect(result.text).toBe("I think I'm right, I've seen it, I'll go, I'd rather not.");
  });

  it('preserves acronyms in full caps instead of only capitalizing the first letter', async () => {
    const result = await applySentenceCase('the XML parser broke, said NASA.', noEntities);
    expect(result.text).toBe('The XML parser broke, said NASA.');
  });

  it('demotes a mid-sentence capitalized common word to lowercase by default, but flags it', async () => {
    const result = await applySentenceCase('I saw a Fox in the yard.', noEntities);
    // "fox" is also an ordinary English word, so it's a toss-up whether it was meant as a
    // name — demoted to lowercase by default (the guess is a click away via the flag).
    expect(result.text).toBe('I saw a fox in the yard.');
    const [range] = result.lowConfidenceRanges;
    expect(range).toBeDefined();
    expect(result.text.slice(range!.start, range!.end)).toBe('fox');
    expect(range!.reason).toBe('commonWord');
    expect(range!.original).toBe('Fox');
  });

  it('flags a capitalized, unrecognized word as "unrecognized" rather than "commonWord"', async () => {
    const result = await applySentenceCase('I met Pramil yesterday.', noEntities);
    const [range] = result.lowConfidenceRanges;
    expect(range).toBeDefined();
    expect(result.text.slice(range!.start, range!.end)).toBe('Pramil');
    expect(range!.reason).toBe('unrecognized');
  });

  it('does not flag a recognized name as low-confidence', async () => {
    const result = await applySentenceCase('Mary went to Paris.', noEntities);
    expect(result.lowConfidenceRanges).toEqual([]);
  });

  it('does not flag "I" or its contractions as low-confidence', async () => {
    const result = await applySentenceCase("i'm here.", noEntities);
    expect(result.lowConfidenceRanges).toEqual([]);
  });

  it('preserves whitespace and punctuation exactly, including multiple paragraphs', async () => {
    const input = 'First sentence.\n\nSecond   paragraph.  Third!';
    const result = await applySentenceCase(input, noEntities);
    expect(result.text).toBe('First sentence.\n\nSecond   paragraph.  Third!');
  });

  it('handles Unicode and emoji without throwing', async () => {
    const result = await applySentenceCase('café NAÏVE test 🎉 done.', noEntities);
    expect(() => result).not.toThrow();
    expect(result.text.startsWith('Café')).toBe(true);
  });

  it('handles a large input without throwing', async () => {
    const large = 'John went to Paris with Mary. THE WEATHER was Nice. '.repeat(300);
    const result = await applySentenceCase(large, noEntities);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('leaves already-correct lowercase prose alone except sentence starts', async () => {
    const result = await applySentenceCase('the weather is nice today.', noEntities);
    expect(result.text).toBe('The weather is nice today.');
  });

  it("preserves a stylized brand name's internal capital instead of flattening it", async () => {
    const result = await applySentenceCase('elon musk announced that SpaceX will launch a rocket.', noEntities);
    // Regression test: capitalize() used to force every character after the first to
    // lowercase for any proper noun, turning "SpaceX" into "Spacex".
    expect(result.text).toContain('SpaceX');
    expect(result.text).not.toContain('Spacex');
  });

  it('still normalizes a shouted proper noun with no genuine internal capital', async () => {
    const result = await applySentenceCase('PARIS is nice in the spring.', noEntities);
    expect(result.text).toBe('Paris is nice in the spring.');
  });

  it('capitalizes an unrecognized lowercase name sitting in a "name is X" slot', async () => {
    // Regression test: compromise never tags a lowercase, unrecognized word as a proper
    // noun at all when there's no capitalization to guess from — so without contextual
    // detection this word gets no signal and is silently left lowercase.
    const result = await applySentenceCase("my daughter's name is pranshi.", noEntities);
    expect(result.text).toBe("My daughter's name is Pranshi.");
    const flagged = result.lowConfidenceRanges.find((r) => result.text.slice(r.start, r.end) === 'Pranshi');
    expect(flagged?.reason).toBe('contextual');
  });

  it('capitalizes a name after "named" and "called"', async () => {
    const named = await applySentenceCase('my dog is named rex.', noEntities);
    expect(named.text).toBe('My dog is named Rex.');

    const called = await applySentenceCase('the boy called pranshi is my friend.', noEntities);
    expect(called.text).toBe('The boy called Pranshi is my friend.');
  });

  it('does not treat a function word after "named"/"called" as a name', async () => {
    // "named after" and "called for" are common phrasings where the following word is
    // clearly not a name — a naive "word right after the trigger" rule would wrongly
    // capitalize "after"/"for" here.
    const result = await applySentenceCase(
      'the mountain named after its discoverer is tall. this situation called for action.',
      noEntities
    );
    expect(result.text).toBe(
      'The mountain named after its discoverer is tall. This situation called for action.'
    );
  });

  it('carries the exact guessed form on each low-confidence range for click-to-toggle', async () => {
    const result = await applySentenceCase('I saw a Fox in the yard.', noEntities);
    const [range] = result.lowConfidenceRanges;
    expect(range).toBeDefined();
    expect(range!.original).toBe('Fox');
  });

  describe('with NER entity detection', () => {
    it('confirms a word outside compromise\'s own lexicon when NER is confident, with no flag', async () => {
      const text = 'I met pramil yesterday and he told me about his trip.';
      const classify: NerClassifier = async () => [entityFor(text, 'pramil', 'PER', 0.97)];
      const result = await applySentenceCase(text, classify);
      expect(result.text).toContain('Pramil');
      expect(result.lowConfidenceRanges).toEqual([]);
    });

    it('promotes a dictionary-ambiguous common word to confirmed when NER is confident', async () => {
      // Without NER this exact sentence demotes "Fox" to lowercase and flags it (see the
      // "demotes a mid-sentence..." test above) — a confident NER hit should override that
      // demotion instead of just adding a second, redundant flag.
      const text = 'I spoke with Fox about the merger.';
      const classify: NerClassifier = async () => [entityFor(text, 'Fox', 'PER', 0.93)];
      const result = await applySentenceCase(text, classify);
      expect(result.text).toContain('Fox');
      expect(result.lowConfidenceRanges).toEqual([]);
    });

    it('flags a low-score NER hit the same as any other uncertain guess, rather than trusting it outright', async () => {
      const text = 'the proposal was drafted by zenthra.';
      const classify: NerClassifier = async () => [entityFor(text, 'zenthra', 'ORG', 0.4)];
      const result = await applySentenceCase(text, classify);
      const [range] = result.lowConfidenceRanges;
      expect(range).toBeDefined();
      expect(result.text.slice(range!.start, range!.end)).toBe('Zenthra');
      expect(range!.reason).toBe('unrecognized');
    });

    it('falls back to compromise-only behavior when the NER classifier rejects', async () => {
      const failing: NerClassifier = async () => {
        throw new Error('model failed to load');
      };
      const result = await applySentenceCase('john smith went to paris.', failing);
      expect(result.text).toBe('John Smith went to Paris.');
    });
  });
});

describe('toggleGuessedCase', () => {
  it('lowercases the guessed form when it currently matches the guess', () => {
    expect(toggleGuessedCase('Fox', 'Fox')).toBe('fox');
  });

  it('restores the exact guessed form, including an internal capital, when toggled back', () => {
    expect(toggleGuessedCase('spacex', 'SpaceX')).toBe('SpaceX');
  });
});
