const technicalTerms = /\b(?:repo(?:sitory)?|branch|commit|pull request|\bpr\b|\bci\b|merge conflict|regression|endpoint|token|cache|sync|render|query|docker|playwright|sha|stack trace)\b/i;

export function requirePlainEnglishPhrase(value: string, label: string): string {
  const phrase = value.trim();
  if (!phrase || phrase.length > 500 || technicalTerms.test(phrase)) {
    throw new Error(`${label} must be a short, clear sentence without developer terms.`);
  }
  return phrase;
}
