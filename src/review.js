import { normalizeReading } from './kana.js';

export function shuffleReviews(items) {
  const queue = [...items];
  for (let index = queue.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [queue[index], queue[other]] = [queue[other], queue[index]];
  }
  return queue;
}

export function createItem(assignment, subject) {
  return {
    assignment, subject, phase: 'meaning', revealed: false, feedback: null,
    mistakes: { meaning: 0, reading: 0 },
  };
}

export function deferReview(items, item) {
  return [...items, reviewReducer(item, { type: 'next' })];
}

export function checkReading(subject, input) {
  const answer = normalizeReading(input);
  if (!answer) return 'empty';
  const matches = subject.data.readings.filter(reading => normalizeReading(reading.reading) === answer);
  if (matches.some(reading => reading.accepted_answer)) return 'correct';
  return matches.length ? 'retry' : 'incorrect';
}

export function reviewReducer(item, action) {
  if (action.type === 'snooze' && ['meaning', 'reading'].includes(item.phase)) {
    return { ...item, phase: 'snoozed' };
  }
  if (action.type === 'show' && ((item.phase === 'meaning' && !item.feedback) || item.feedback === 'incorrect')) {
    return { ...item, revealed: true };
  }
  if (['retry', 'next'].includes(action.type) && item.feedback) {
    const mistakes = { ...item.mistakes };
    if (action.type === 'next' && item.feedback === 'incorrect') mistakes[item.phase]++;
    return { ...item, feedback: null, revealed: false, mistakes };
  }
  if (item.feedback && item.feedback !== 'retry') return item;
  if (action.type === 'meaning' && item.phase === 'meaning' && item.revealed) {
    if (action.correct) {
      const hasReading = ['kanji', 'vocabulary'].includes(item.subject.object);
      return { ...item, phase: hasReading ? 'reading' : 'ready', revealed: false };
    }
    return { ...item, feedback: 'incorrect', revealed: false };
  }
  if (action.type === 'reading' && item.phase === 'reading') {
    const result = checkReading(item.subject, action.value);
    if (result === 'empty') return item;
    if (result === 'correct') return { ...item, phase: 'ready', feedback: null };
    return { ...item, feedback: result };
  }
  return item;
}

export function reviewPayload(item) {
  if (item.phase !== 'ready') throw new Error('Complete the review before submitting it.');
  return {
    review: {
      assignment_id: item.assignment.id,
      incorrect_meaning_answers: item.mistakes.meaning,
      incorrect_reading_answers: item.mistakes.reading,
    },
  };
}
