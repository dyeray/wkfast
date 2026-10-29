import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../src/api.js';
import { createItem, reviewReducer } from '../src/review.js';

const due = {
  id: 12, data: {
    subject_id: 440, subject_type: 'kanji', hidden: false,
    started_at: '2020-01-01T00:00:00Z', available_at: '2020-01-01T01:00:00Z',
    burned_at: null, srs_stage: 3,
  },
};
const subject = {
  id: 440, object: 'kanji', data: {
    characters: '一', hidden_at: null,
    meanings: [{ meaning: 'One', accepted_answer: true }],
    readings: [{ reading: 'いち', accepted_answer: true }],
  },
};
const page = (data, next_url = null) => ({ data, pages: { next_url } });
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
function readyItem() {
  let item = createItem(due, subject);
  for (const action of [{ type: 'show' }, { type: 'meaning', correct: true }, { type: 'reading', value: 'いち' }]) {
    item = reviewReducer(item, action);
  }
  return item;
}

test('loads paginated assignments and subjects, filters unavailable assignments', async () => {
  const calls = [];
  const future = { ...due, id: 13, data: { ...due.data, available_at: '2999-01-01T00:00:00Z' } };
  const hidden = { ...due, id: 14, data: { ...due.data, hidden: true } };
  const lesson = { ...due, id: 15, data: { ...due.data, started_at: null } };
  const responses = [
    page([future, hidden, lesson], 'https://api.wanikani.com/v2/assignments?page_after_id=15'),
    page([due]), page([], 'https://api.wanikani.com/v2/subjects?page_after_id=1'), page([subject]),
  ];
  const api = createApi('test-token', async (url, options) => {
    calls.push({ url: String(url), options });
    return json(responses.shift());
  });
  const items = await api.loadReviews();
  assert.equal(items.length, 1);
  assert.equal(items[0].subject.id, 440);
  assert.equal(calls.length, 4);
  assert.equal(new URL(calls[0].url).searchParams.get('started'), 'true');
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, 'Bearer test-token');
    assert.equal(call.options.cache, 'no-store');
  }
});

test('empty sessions do not fetch all subjects', async () => {
  let calls = 0;
  const api = createApi('token', async () => { calls++; return json(page([])); });
  assert.deepEqual(await api.loadReviews(), []);
  assert.equal(calls, 1);
});

test('loads and caches a kanji lookup using an encoded character filter', async () => {
  const calls = [];
  const api = createApi('test-token', async (url, options) => {
    calls.push({ url: new URL(url), options });
    return json(page([subject]));
  });
  const first = await api.loadKanji('一');
  assert.equal(first.data.characters, '一');
  assert.equal(await api.loadKanji('一'), first);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get('types'), 'kanji');
  assert.equal(calls[0].url.searchParams.get('slugs'), '一');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
});

test('missing or malformed kanji lookups fail without being cached and can be retried', async () => {
  for (const result of [[], [{ ...subject, object: 'radical' }], [{ ...subject, data: { ...subject.data, characters: '二' } }], [{ ...subject, data: {} }]]) {
    let calls = 0;
    const api = createApi('test-token', async () => json(page(calls++ ? [subject] : result)));
    await assert.rejects(api.loadKanji('一'), /kanji|subject/i);
    assert.equal((await api.loadKanji('一')).data.characters, '一');
    assert.equal(calls, 2);
  }
});

test('pagination cannot send the credential to another host or leave the API', async () => {
  for (const next of ['https://evil.example/steal', 'https://api.wanikani.com/other', 'https://evil.example@api.wanikani.com/v2/subjects']) {
    let calls = 0;
    const api = createApi('secret', async () => { calls++; return json(page([due], next)); });
    await assert.rejects(api.loadReviews(), /pagination|URL/i);
    assert.equal(calls, 1);
  }
});

test('missing subjects and failed later pages cannot become a partial review session', async () => {
  let calls = 0;
  const missing = createApi('token', async () => json(page(calls++ ? [] : [due])));
  await assert.rejects(missing.loadReviews(), /subject/i);
  calls = 0;
  const failing = createApi('token', async () => calls++
    ? json({}, 500)
    : json(page([due], 'https://api.wanikani.com/v2/assignments?page_after_id=12')));
  await assert.rejects(failing.loadReviews(), /WaniKani/);
});

test('authentication, permission and rate limit errors are actionable without exposing the key', async () => {
  for (const [status, message] of [[401, /API key/i], [403, /permission/i], [429, /30 seconds/i]]) {
    const api = createApi('secret', async () => json({ error: 'secret' }, status, { 'Retry-After': '30' }));
    await assert.rejects(api.loadReviews(), error => {
      assert.match(error.message, message);
      assert.ok(!error.message.includes('secret'));
      return true;
    });
  }
});

test('submits the completed item once with separate meaning and reading counts', async () => {
  const calls = [];
  const api = createApi('token', async (url, options) => {
    calls.push({ url: String(url), options });
    return json({ id: 0, object: 'review' }, 201);
  });
  await api.saveReview(readyItem());
  await api.saveReview(readyItem());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    review: { assignment_id: 12, incorrect_meaning_answers: 0, incorrect_reading_answers: 0 },
  });
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
});

test('does not submit unfinished items or snoozes', async () => {
  const api = createApi('token', () => { throw new Error('Must not fetch'); });
  await assert.rejects(api.saveReview(createItem(due, subject)), /complete/i);
  await assert.rejects(api.saveReview({ ...readyItem(), phase: 'snoozed' }), /complete/i);
});

test('after an ambiguous failure, checks assignment before retry and avoids duplicate writes', async () => {
  const calls = [];
  const api = createApi('token', async (url, options) => {
    calls.push(options.method);
    if (options.method === 'POST') throw new TypeError('Failed to fetch');
    return json({ ...due, data: { ...due.data, available_at: '2999-01-01T00:00:00Z' } });
  });
  await assert.rejects(api.saveReview(readyItem()), /connection/i);
  const result = await api.saveReview(readyItem(), true);
  assert.equal(result.alreadySaved, true);
  assert.deepEqual(calls, ['POST', 'GET']);
});

test('retries a failed save only if the original assignment is still due', async () => {
  const calls = [];
  const api = createApi('token', async (url, options) => {
    calls.push(options.method);
    if (calls.length === 1) return json({}, 500);
    return json(options.method === 'GET' ? due : { id: 0, object: 'review' });
  });
  await assert.rejects(api.saveReview(readyItem()), /WaniKani/);
  await api.saveReview(readyItem(), true);
  assert.deepEqual(calls, ['POST', 'GET', 'POST']);
});

test('rejects duplicate concurrent saves', async () => {
  let resolve;
  let writes = 0;
  const api = createApi('token', async () => {
    writes++;
    return new Promise(done => { resolve = done; });
  });
  const first = api.saveReview(readyItem());
  await assert.rejects(api.saveReview(readyItem()), /saving/i);
  resolve(json({ id: 0, object: 'review' }));
  await first;
  assert.equal(writes, 1);
});

test('a new due occurrence of the same assignment must produce a new review', async () => {
  let writes = 0;
  const api = createApi('token', async () => { writes++; return json({ id: 0, object: 'review' }); });
  const first = readyItem();
  const later = { ...first, assignment: { ...due, data: { ...due.data, available_at: '2021-01-01T00:00:00Z' } } };
  await api.saveReview(first);
  await api.saveReview(first);
  await api.saveReview(later);
  assert.equal(writes, 2);
});

test('incomplete reconciliation preserves the unsaved item and does not infer success', async () => {
  let writes = 0;
  let broken = true;
  const api = createApi('token', async (url, options) => {
    if (options.method === 'POST') {
      writes++;
      if (writes === 1) throw new TypeError('Failed to fetch');
      return json({ id: 0, object: 'review' });
    }
    return json(broken ? { id: due.id, data: {} } : due);
  });
  const item = readyItem();
  await assert.rejects(api.saveReview(item), /connection/i);
  await assert.rejects(api.saveReview(item, true), /assignment|verify/i);
  assert.equal(item.phase, 'ready');
  broken = false;
  await api.saveReview(item, true);
  assert.equal(writes, 2);
});

test('malformed assignment status cannot be silently dropped during loading', async () => {
  const api = createApi('token', async () => json(page([{ id: due.id, data: {} }])));
  await assert.rejects(api.loadReviews(), /assignment/i);
});
