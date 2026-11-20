export function removeDiacritics(s: string) {
  // `NFD` splits letters+diacritics into separate codepoints.
  // Then we remove the combining diacritic marks.
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizeForCompare(raw: string) {
  const s = removeDiacritics(raw)
    .toLowerCase()
    .replace(/[¡!¿?.,;:()[\]{}"“”'’`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Strip common Spanish leading articles / contractions (helps with STT).
  return s.replace(/^(el|la|los|las|un|una|unos|unas|al|del)\s+/i, "").trim();
}

function levenshteinRatio(a: string, b: string) {
  if (a === b) return 1;
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  const maxLen = Math.max(n, m);

  // DP with two rows to keep it small.
  let prev = new Array<number>(m + 1);
  let cur = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      cur[j] = Math.min(del, ins, sub);
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  const dist = prev[m];
  return 1 - dist / maxLen;
}

// Words that never count as "the answer" on their own when the expected
// answer has several words (articles, prepositions, conjunctions — es + en).
const FILLER_WORDS = new Set([
  "el", "la", "los", "las", "lo", "un", "una", "unos", "unas", "al", "del",
  "de", "y", "e", "o", "u", "en", "con", "por", "para", "sin", "a",
  "the", "of", "and", "or", "in", "on", "an", "to", "for", "at", "with",
]);

const ROMAN_NUMERAL = /^[ivxlcdm]+$/;

/** Words of a multi-word answer that are meaningful enough to count alone. */
function significantWords(normalizedExpected: string) {
  return normalizedExpected
    .split(" ")
    .filter((w) => w.length >= 3 && !FILLER_WORDS.has(w) && !ROMAN_NUMERAL.test(w));
}

/** Exact match, ñ→n, or a tiny singular/plural difference. */
function wordsMatchStrict(s: string, e: string) {
  if (s === e) return true;
  if (s === `${e}s` || e === `${s}s`) return true;
  if (s === `${e}es` || e === `${s}es`) return true;
  return false;
}

/** Fuzzy match for single words (helps with phoneme confusions like d→k). */
function wordsMatchFuzzy(s: string, e: string) {
  return s.length >= 4 && e.length >= 4 && levenshteinRatio(s, e) >= 0.6;
}

export function isAnswerCorrect(spoken: string, expected: string) {
  // ñ is already folded to n by removeDiacritics (NFD splits off the tilde).
  const s = normalizeForCompare(spoken);
  const e = normalizeForCompare(expected);
  if (!s || !e) return false;
  if (s === e) return true;

  // If the spoken text contains the expected answer (like "pasalacabra" detection),
  // mark it as correct. This handles cases like "Es ADN" or "La respuesta es ADN".
  if (s.includes(e)) return true;

  if (wordsMatchStrict(s, e)) return true;

  const sWords = s.split(" ");
  const eWords = e.split(" ");

  // Fuzzy match for single-word answers: e.g. "delfin" vs "kelfin" is accepted.
  if (sWords.length === 1 && eWords.length === 1 && wordsMatchFuzzy(s, e)) return true;

  // Multi-word answers: saying any one meaningful word of it counts
  // (e.g. "Cervantes" for "Miguel de Cervantes", "Lovelace" for "Ada Lovelace").
  if (eWords.length > 1) {
    const keyWords = significantWords(e);
    for (const ew of keyWords) {
      if (sWords.some((sw) => wordsMatchStrict(sw, ew))) return true;
      // Only fuzzy-match when the player said a single word, to keep longer
      // sentences ("la respuesta es...") from matching by accident.
      if (sWords.length === 1 && wordsMatchFuzzy(s, ew)) return true;
    }
  }

  return false;
}
