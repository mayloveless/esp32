export const defaultAlienDialect = "cosmic-1";

export type AlienDialect = typeof defaultAlienDialect;

type Token =
  | { type: "word"; value: string }
  | { type: "punctuation"; value: string };

const syllableOnsets = ["k", "l", "m", "n", "r", "s", "t", "v", "z"];
const syllableVowels = ["a", "e", "i", "o", "u", "ai", "ei", "ou"];
const punctuationMap: Record<string, string> = {
  "，": ",",
  "。": ".",
  "！": "!",
  "？": "?",
  "；": ";",
  "：": ":",
  ",": ",",
  ".": ".",
  "!": "!",
  "?": "?",
  ";": ";",
  ":": ":",
};

function isPunctuation(value: string) {
  return value in punctuationMap;
}

function isWhitespace(value: string) {
  return /^\s+$/u.test(value);
}

function isCjk(value: string) {
  return /^[\u3400-\u9fff]$/u.test(value);
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function pseudoWord(dialect: AlienDialect, word: string) {
  let hash = stableHash(`${dialect}\u0000${word}`);
  const syllableCount = 2 + (hash % 3);
  const syllables: string[] = [];
  for (let index = 0; index < syllableCount; index += 1) {
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
    const onset = syllableOnsets[hash % syllableOnsets.length];
    const vowel = syllableVowels[(hash >>> 8) % syllableVowels.length];
    syllables.push(`${onset}${vowel}`);
  }
  return syllables.join("");
}

function fallbackTokens(text: string): Token[] {
  const tokens: Token[] = [];
  let latinWord = "";
  const flushLatinWord = () => {
    if (!latinWord) return;
    tokens.push({ type: "word", value: latinWord });
    latinWord = "";
  };

  for (const character of text) {
    if (isWhitespace(character)) {
      flushLatinWord();
      continue;
    }
    if (isPunctuation(character)) {
      flushLatinWord();
      tokens.push({ type: "punctuation", value: character });
      continue;
    }
    if (isCjk(character)) {
      flushLatinWord();
      tokens.push({ type: "word", value: character });
      continue;
    }
    latinWord += character;
  }
  flushLatinWord();
  return tokens;
}

function segmentTokens(text: string): Token[] {
  if (typeof Intl.Segmenter !== "function") return fallbackTokens(text);
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  const tokens: Token[] = [];
  for (const segment of segmenter.segment(text)) {
    if (isWhitespace(segment.segment)) continue;
    if (isPunctuation(segment.segment)) {
      tokens.push({ type: "punctuation", value: segment.segment });
      continue;
    }
    if (segment.isWordLike) {
      tokens.push({ type: "word", value: segment.segment });
      continue;
    }
    tokens.push(...fallbackTokens(segment.segment));
  }
  return tokens;
}

/**
 * 把语义文本转为可被中文 TTS 连续读出的拉丁音节。该转换不产生随机值，
 * 因而同一方言中的同一词会得到稳定的伪外星语词。
 */
export function toAlienSpokenText(
  text: string,
  dialect: AlienDialect = defaultAlienDialect,
) {
  const spokenTokens = segmentTokens(text).map((token) =>
    token.type === "punctuation"
      ? punctuationMap[token.value]
      : pseudoWord(dialect, token.value),
  );
  return spokenTokens
    .join(" ")
    .replace(/\s+([,.:;!?])/g, "$1")
    .trim();
}

export function getAlienWord(
  word: string,
  dialect: AlienDialect = defaultAlienDialect,
) {
  return pseudoWord(dialect, word);
}
