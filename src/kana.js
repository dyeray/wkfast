export const KANA_ROWS = [
  ['あ', 'a', 'あいうえお'], ['か', 'ka', 'かきくけこ'],
  ['さ', 'sa', 'さしすせそ'], ['た', 'ta', 'たちつてと'],
  ['な', 'na', 'なにぬねの'], ['は', 'ha', 'はひふへほ'],
  ['ま', 'ma', 'まみむめも'], ['や', 'ya', ['や', null, 'ゆ', null, 'よ']],
  ['ら', 'ra', 'らりるれろ'], ['わ', 'wa', ['わ', 'ゐ', null, 'ゑ', 'を']],
  ['が', 'ga', 'がぎぐげご'], ['ざ', 'za', 'ざじずぜぞ'],
  ['だ', 'da', 'だぢづでど'], ['ば', 'ba', 'ばびぶべぼ'],
  ['ぱ', 'pa', 'ぱぴぷぺぽ'], ['小', 'small a', 'ぁぃぅぇぉ'],
  ['ゃ', 'small y', ['ゃ', null, 'ゅ', null, 'ょ']],
  ['っ', 'small tsu', ['っ', null, null, null, 'ゎ']],
  ['ん・ー', 'other', ['ん', 'ー', 'ゔ', null, null]],
].map(([label, hint, kana]) => ({ label, hint, kana: Array.from(kana) }));

export function normalizeReading(value) {
  return value.trim().normalize('NFKC').replace(/[ァ-ヶ]/g,
    kana => String.fromCharCode(kana.charCodeAt(0) - 0x60));
}

export function flickIndex(x, y) {
  if (Math.hypot(x, y) < 20) return 0;
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? 1 : 3;
  return y < 0 ? 2 : 4;
}

export function editKana(input, start, end, kana) {
  const left = kana === null && start === end ? Math.max(0, start - 1) : start;
  const insertion = kana ?? '';
  return { value: input.slice(0, left) + insertion + input.slice(end), caret: left + insertion.length };
}
