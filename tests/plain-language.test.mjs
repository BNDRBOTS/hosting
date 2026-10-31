import test from 'node:test';
import assert from 'node:assert/strict';
import { requirePlainEnglishPhrase } from '../src/lib/plain-language.ts';

test('agent progress accepts short everyday wording', () => {
  assert.equal(requirePlainEnglishPhrase('The welcome page now fits on a phone.', 'Progress'), 'The welcome page now fits on a phone.');
});

test('agent progress refuses developer words', () => {
  for (const phrase of ['I changed the endpoint.', 'The branch is ready.', 'The query was fixed.']) {
    assert.throws(() => requirePlainEnglishPhrase(phrase, 'Progress'), /without developer terms/);
  }
});
