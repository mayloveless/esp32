export const alienDialects = [
  "cosmic-1",
  "machine-1",
  "continental-1",
] as const;

export const defaultAlienDialect = "cosmic-1";

export type AlienDialect = (typeof alienDialects)[number];

export const alienDialectOptions: Array<{
  label: string;
  value: AlienDialect;
}> = [
  { label: "柔和宇宙语", value: "cosmic-1" },
  { label: "机械通信语", value: "machine-1" },
  { label: "大陆异语", value: "continental-1" },
];

type Token =
  | { type: "word"; value: string }
  | { type: "punctuation"; value: string };

type Phonology = {
  codas: string[];
  onsets: string[];
  vowels: string[];
};

const phonologies: Record<AlienDialect, Phonology> = {
  "cosmic-1": {
    codas: [],
    onsets: ["k", "l", "m", "n", "r", "s", "t", "v", "z"],
    vowels: ["a", "e", "i", "o", "u", "ai", "ei", "ou"],
  },
  "machine-1": {
    codas: ["k", "t", "s", "r"],
    onsets: ["k", "t", "z", "v", "r", "sk", "kr", "tr", "ts"],
    vowels: ["a", "e", "i", "o", "u"],
  },
  "continental-1": {
    codas: ["n", "r", "s", "k", "t", "l"],
    onsets: [
      "k",
      "g",
      "t",
      "d",
      "p",
      "b",
      "v",
      "z",
      "s",
      "r",
      "l",
      "m",
      "n",
      "f",
      "sh",
      "zh",
      "ts",
      "kr",
      "gr",
      "tr",
      "dr",
      "vr",
      "st",
      "sk",
      "pr",
      "br",
    ],
    vowels: ["a", "e", "i", "o", "u", "ai", "ei"],
  },
};

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

export function isAlienDialect(value: unknown): value is AlienDialect {
  return typeof value === "string" && alienDialects.includes(value as AlienDialect);
}

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

function nextHash(hash: number) {
  return Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
}

function syllableCount(dialect: AlienDialect, word: string, hash: number) {
  const tokenLength = Array.from(word).length;
  if (dialect === "machine-1") {
    if (tokenLength <= 2) return 1;
    return hash % 4 === 0 ? 2 : 1;
  }
  if (tokenLength <= 1) return 1;
  if (tokenLength <= 3) return 1 + (hash % 2);
  return 1 + (hash % 3);
}

function pseudoWord(dialect: AlienDialect, word: string) {
  const phonology = phonologies[dialect];
  let hash = stableHash(`${dialect}\u0000${word}`);
  const count = syllableCount(dialect, word, hash);
  const syllables: string[] = [];
  for (let index = 0; index < count; index += 1) {
    hash = nextHash(hash);
    const onset = phonology.onsets[hash % phonology.onsets.length];
    const vowel = phonology.vowels[(hash >>> 8) % phonology.vowels.length];
    const isFinalSyllable = index === count - 1;
    const useCoda =
      isFinalSyllable &&
      phonology.codas.length > 0 &&
      (dialect === "machine-1" ? hash % 2 === 0 : hash % 3 === 0);
    const coda = useCoda
      ? phonology.codas[(hash >>> 16) % phonology.codas.length]
      : "";
    syllables.push(`${onset}${vowel}${coda}`);
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
 * 把语义文本转为可被中文 TTS 连续读出的拉丁音节。转换不产生随机值，
 * 同一方言中的同一词会稳定得到同一伪外星语词。
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
