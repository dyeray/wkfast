import assert from 'node:assert/strict';
import test from 'node:test';
import { createItem, reviewReducer, reviewPayload, checkReading, shuffleReviews, deferReview, meaningDetails } from '../src/review.js';
import { KANA_ROWS, normalizeReading, flickIndex, editKana } from '../src/kana.js';

const assignment = { id: 12, data: { subject_id: 440 } };
const kanji = {
  id: 440, object: 'kanji',
  data: {
    characters: '一', meanings: [{ meaning: 'One', accepted_answer: true }],
    readings: [
      { reading: 'いち', accepted_answer: true },
      { reading: 'いつ', accepted_answer: true },
      { reading: 'ひと', accepted_answer: false },
    ],
  },
};
const act = (item, type, values = {}) => reviewReducer(item, { type, ...values });

test('meaning details include accepted alternatives and whitelist meanings, excluding rejected meanings', () => {
  const subject = { data: {
    meanings: [
      { meaning: 'Single', primary: false, accepted_answer: true },
      { meaning: 'One', primary: true, accepted_answer: true },
      { meaning: 'Zero', primary: false, accepted_answer: false },
    ],
    auxiliary_meanings: [
      { meaning: 'Unity', type: 'whitelist' },
      { meaning: 'Single', type: 'whitelist' },
      { meaning: 'Wrong', type: 'blacklist' },
    ],
  } };
  assert.deepEqual(meaningDetails(subject), { primary: 'One', alternatives: ['Single', 'Unity'] });
  assert.deepEqual(meaningDetails(kanji), { primary: 'One', alternatives: [] });
});

test('session shuffling reorders the queue without mutating or losing review items', context => {
  context.mock.method(Math, 'random', () => 0);
  const items = [createItem(assignment, kanji), createItem({ ...assignment, id: 13 }, kanji), createItem({ ...assignment, id: 14 }, kanji)];
  const shuffled = shuffleReviews(items);
  assert.deepEqual(shuffled.map(item => item.assignment.id), [13, 14, 12]);
  assert.deepEqual(items.map(item => item.assignment.id), [12, 13, 14]);
  assert.equal(shuffled[2], items[0]);
  assert.deepEqual(shuffleReviews([]), []);
  assert.deepEqual(shuffleReviews([items[0]]), [items[0]]);
});

test('meanings must be shown and both required parts passed before submitting', () => {
  let item = createItem(assignment, kanji);
  assert.equal(act(item, 'meaning', { correct: true }).phase, 'meaning');
  assert.throws(() => reviewPayload(item), /complete/i);
  item = act(item, 'show');
  item = act(item, 'meaning', { correct: true });
  assert.equal(item.phase, 'reading');
  assert.equal(act(item, 'meaning', { correct: true }), item);
  item = act(item, 'reading', { value: 'いち' });
  assert.equal(item.phase, 'ready');
  assert.deepEqual(reviewPayload(item), {
    review: { assignment_id: 12, incorrect_meaning_answers: 0, incorrect_reading_answers: 0 },
  });
});

test('incorrect meanings count once and can be deferred without a pending failure', () => {
  for (const object of ['kanji', 'vocabulary', 'radical', 'kana_vocabulary']) {
    const original = act(createItem(assignment, { ...kanji, object }), 'show');
    const failed = act(original, 'meaning', { correct: false });
    assert.equal(original.mistakes.meaning, 0);
    assert.equal(failed.phase, 'meaning');
    assert.equal(failed.feedback, null);
    assert.equal(failed.revealed, false);
    assert.equal(failed.mistakes.meaning, 1);
    assert.equal(act(failed, 'meaning', { correct: false }), failed);
    const other = createItem({ ...assignment, id: 13 }, kanji);
    const queue = deferReview([original, other], failed);
    assert.equal(queue[1], other);
    let item = queue[2];
    assert.equal(item.mistakes.meaning, 1);
    assert.throws(() => reviewPayload(item), /complete/i);
    item = act(act(item, 'show'), 'meaning', { correct: true });
    if (['kanji', 'vocabulary'].includes(object)) item = act(item, 'reading', { value: 'いち' });
    assert.equal(reviewPayload(item).review.incorrect_meaning_answers, 1);
  }
});

test('incorrect readings stay pending until next commits their mistake counts', () => {
  let item = act(act(createItem(assignment, kanji), 'show'), 'meaning', { correct: true });
  item = act(item, 'reading', { value: 'いぬ' });
  assert.equal(item.feedback, 'incorrect');
  assert.equal(item.mistakes.reading, 0);
  assert.equal(act(item, 'reading', { value: 'いぬ' }), item);
  item = act(item, 'next');
  item = act(item, 'reading', { value: 'ひと' });
  assert.equal(item.feedback, 'retry');
  item = act(item, 'retry');
  item = act(item, 'reading', { value: 'イチ' });
  assert.deepEqual(reviewPayload(item).review, {
    assignment_id: 12, incorrect_meaning_answers: 0, incorrect_reading_answers: 1,
  });
});

test('show reveals a pending reading failure and retry discards it without recording a mistake', () => {
  let item = act(act(createItem(assignment, kanji), 'show'), 'meaning', { correct: true });
  item = act(item, 'reading', { value: 'いぬ' });
  assert.equal(item.revealed, false);
  item = act(item, 'show');
  assert.equal(item.revealed, true);
  item = act(item, 'retry');
  assert.equal(item.revealed, false);
  assert.equal(item.mistakes.reading, 0);
});

test('retry preserves earlier committed mistakes and next cannot commit the same failure twice', () => {
  let item = createItem(assignment, kanji);
  for (let count = 1; count <= 2; count++) {
    item = act(act(item, 'show'), 'meaning', { correct: false });
    assert.equal(item.mistakes.meaning, count);
  }
  item = act(act(item, 'show'), 'meaning', { correct: true });
  item = act(act(item, 'reading', { value: 'いぬ' }), 'next');
  assert.equal(act(item, 'next'), item);
  item = act(act(item, 'reading', { value: 'いぬ' }), 'retry');
  item = act(item, 'reading', { value: 'いち' });
  assert.deepEqual(reviewPayload(item).review, {
    assignment_id: 12, incorrect_meaning_answers: 2, incorrect_reading_answers: 1,
  });
});

test('next defers an unfinished review, retaining its passed meaning and mistake counts', () => {
  let item = act(act(createItem(assignment, kanji), 'show'), 'meaning', { correct: true });
  item = act(item, 'reading', { value: 'いぬ' });
  assert.equal(item.mistakes.reading, 0);
  const queue = [item];
  const deferred = deferReview(queue, act(item, 'show'));
  assert.equal(queue.length, 1);
  assert.equal(deferred.length, 2);
  assert.equal(deferred[0], item);
  assert.equal(deferred[1].phase, 'reading');
  assert.equal(deferred[1].feedback, null);
  assert.equal(deferred[1].revealed, false);
  assert.equal(deferred[1].mistakes.reading, 1);
  assert.throws(() => reviewPayload(deferred[1]), /complete/i);
  const passed = act(deferred[1], 'reading', { value: 'いち' });
  assert.equal(reviewPayload(passed).review.incorrect_reading_answers, 1);
});

test('radicals and kana vocabulary require only meaning; vocabulary requires reading', () => {
  for (const object of ['radical', 'kana_vocabulary']) {
    const subject = { ...kanji, object, data: { ...kanji.data, readings: undefined } };
    const item = act(act(createItem(assignment, subject), 'show'), 'meaning', { correct: true });
    assert.equal(item.phase, 'ready');
    assert.equal(reviewPayload(item).review.incorrect_reading_answers, 0);
  }
  const item = act(act(createItem(assignment, { ...kanji, object: 'vocabulary' }), 'show'), 'meaning', { correct: true });
  assert.equal(item.phase, 'reading');
});

test('snoozing skips the whole item without allowing submission', () => {
  const item = act(createItem(assignment, kanji), 'snooze');
  assert.equal(item.phase, 'snoozed');
  assert.throws(() => reviewPayload(item), /complete/i);
  assert.equal(createItem(assignment, kanji).phase, 'meaning');
});

test('checks every accepted reading, normalizes Unicode, and ignores empty submissions', () => {
  assert.equal(checkReading(kanji, 'いつ'), 'correct');
  assert.equal(checkReading(kanji, 'ひと'), 'retry');
  assert.equal(checkReading(kanji, 'いぬ'), 'incorrect');
  assert.equal(checkReading(kanji, '  '), 'empty');
  assert.equal(normalizeReading('  ｶﾞｯｺｳ  '), 'がっこう');
  assert.equal(normalizeReading('は\u3099'), 'ば');
  const item = act(act(createItem(assignment, kanji), 'show'), 'meaning', { correct: true });
  assert.equal(act(item, 'reading', { value: ' ' }), item);
});

test('a nonaccepted kanji reading can be edited and resubmitted without acknowledgement or a mistake', () => {
  const left = { ...kanji, data: { ...kanji.data, characters: '左', readings: [
    { reading: 'さ', accepted_answer: true }, { reading: 'ひだり', accepted_answer: false },
  ] } };
  let item = act(act(createItem(assignment, left), 'show'), 'meaning', { correct: true });
  item = act(item, 'reading', { value: 'ひだり' });
  assert.equal(item.phase, 'reading');
  assert.equal(item.feedback, 'retry');
  assert.equal(item.revealed, false);
  assert.equal(item.mistakes.reading, 0);
  item = act(item, 'reading', { value: 'さ' });
  assert.equal(item.phase, 'ready');
  assert.equal(item.feedback, null);
  assert.equal(item.mistakes.reading, 0);
});

test('flick directions follow the Japanese layout: a center, i left, u up, e right, o down', () => {
  for (const [x, y, index] of [[0, 0, 0], [19, 0, 0], [-40, 0, 1], [0, -40, 2], [40, 0, 3], [0, 40, 4], [-50, 10, 1], [10, -50, 2]]) {
    assert.equal(flickIndex(x, y), index);
  }
  const ha = KANA_ROWS.find(row => row.label === 'は');
  assert.equal(ha.kana[flickIndex(-50, 0)], 'ひ');
  assert.equal(ha.kana[flickIndex(0, -50)], 'ふ');
  for (const row of KANA_ROWS) assert.equal(row.kana.length, 5, `${row.label} must fit the radial menu`);
});

test('the keypad covers ordinary, voiced, semi-voiced, small kana, n, and long vowels', () => {
  const available = new Set(KANA_ROWS.flatMap(row => row.kana).filter(Boolean));
  for (const kana of 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽぁぃぅぇぉゃゅょっゎんーゔ') {
    assert.ok(available.has(kana), `Missing ${kana}`);
  }
});

test('kana edits preserve the insertion point for consecutive edits in the middle', () => {
  let edit = editKana('かこう', 1, 1, 'っ');
  assert.deepEqual(edit, { value: 'かっこう', caret: 2 });
  edit = editKana(edit.value, edit.caret, edit.caret, 'が');
  assert.deepEqual(edit, { value: 'かっがこう', caret: 3 });
  edit = editKana(edit.value, edit.caret, edit.caret, null);
  assert.deepEqual(edit, { value: 'かっこう', caret: 2 });
  assert.deepEqual(editKana('かっこう', 0, 2, 'が'), { value: 'がこう', caret: 1 });
  assert.deepEqual(editKana('かっこう', 1, 3, null), { value: 'かう', caret: 1 });
  assert.deepEqual(editKana('かこう', 0, 0, null), { value: 'かこう', caret: 0 });
});
