import { createItem, reviewPayload } from './review.js';

const BASE = 'https://api.wanikani.com/v2/';
const TYPES = ['kanji', 'vocabulary', 'radical', 'kana_vocabulary'];

function apiUrl(path) {
  const url = new URL(path, BASE);
  if (url.origin !== new URL(BASE).origin || !url.pathname.startsWith('/v2/') || url.username || url.password) {
    throw new Error('WaniKani returned an unsafe pagination URL.');
  }
  return url;
}

function isDue(assignment, now) {
  const data = assignment?.data;
  return data && data.started_at && !data.hidden && !data.burned_at &&
    data.available_at && Date.parse(data.available_at) <= now;
}

function validateAssignment(assignment) {
  const data = assignment?.data;
  const validDates = data && ['started_at', 'available_at', 'burned_at'].every(key =>
    data[key] === null || (typeof data[key] === 'string' && Number.isFinite(Date.parse(data[key]))));
  if (!Number.isSafeInteger(assignment?.id) || assignment.id <= 0 ||
      !Number.isSafeInteger(data?.subject_id) || data.subject_id <= 0 ||
      !TYPES.includes(data?.subject_type) || typeof data?.hidden !== 'boolean' ||
      !Number.isInteger(data?.srs_stage) || data.srs_stage < 0 || data.srs_stage > 9 || !validDates) {
    throw new Error('Could not verify the WaniKani assignment status. Please retry.');
  }
}

function validateSubject(subject) {
  const data = subject?.data;
  const hasReading = ['kanji', 'vocabulary'].includes(subject?.object);
  if (!Number.isInteger(subject?.id) || !TYPES.includes(subject?.object) ||
      !data?.meanings?.some(meaning => typeof meaning.meaning === 'string' && meaning.accepted_answer) ||
      (hasReading && !data.readings?.some(reading => typeof reading.reading === 'string' && reading.accepted_answer)) ||
      (!data.characters && !data.character_images?.some(image => image.content_type === 'image/svg+xml'))) {
    throw new Error('WaniKani returned an incomplete subject. Try loading your reviews again.');
  }
}

export function createApi(token, fetcher = fetch) {
  if (!token.trim()) throw new Error('Supply your WaniKani API key in the api_key query parameter.');
  const saving = new Set();
  const saved = new Set();

  async function request(path, body) {
    const url = apiUrl(path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetcher(url, {
        method: body ? 'POST' : 'GET', signal: controller.signal,
        credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token.trim()}`, 'Wanikani-Revision': '20170710',
          ...(body && { 'Content-Type': 'application/json' }),
        },
        ...(body && { body: JSON.stringify(body) }),
      });
      if (response.status === 401) throw new Error('The API key in the URL is invalid or expired. Open this page with a valid api_key query parameter.');
      if (response.status === 403) throw new Error('This API key lacks permission. Enable reviews:create in WaniKani, then retry.');
      if (response.status === 429) {
        const seconds = Number(response.headers.get('Retry-After')) || 60;
        throw new Error(`WaniKani's rate limit was reached. Wait ${seconds} seconds before retrying.`);
      }
      if (!response.ok) throw new Error(`WaniKani could not complete this request (${response.status}). Please retry.`);
      return await response.json();
    } catch (error) {
      if (error instanceof TypeError || error.name === 'AbortError') {
        throw new Error('Could not reach WaniKani. Check your connection and retry.');
      }
      if (error instanceof SyntaxError) throw new Error('WaniKani returned an unreadable response. Please retry.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function collect(path) {
    const items = [];
    const visited = new Set();
    while (path) {
      const url = apiUrl(path).href;
      if (visited.has(url)) throw new Error('WaniKani returned repeated pagination. Please retry.');
      visited.add(url);
      const page = await request(url);
      if (!Array.isArray(page.data) || !page.pages || !('next_url' in page.pages)) {
        throw new Error('WaniKani returned an incomplete page. Please retry.');
      }
      items.push(...page.data);
      path = page.pages.next_url;
    }
    return items;
  }

  return {
    async loadReviews() {
      const now = Date.now();
      const all = await collect(`assignments?started=true&hidden=false&burned=false&available_before=${encodeURIComponent(new Date(now).toISOString())}`);
      all.forEach(validateAssignment);
      const assignments = all.filter(assignment => isDue(assignment, now));
      const ids = [...new Set(assignments.map(assignment => assignment.data.subject_id))];
      const subjects = new Map();
      for (let start = 0; start < ids.length; start += 100) {
        for (const subject of await collect(`subjects?ids=${ids.slice(start, start + 100).join(',')}`)) {
          validateSubject(subject);
          subjects.set(subject.id, subject);
        }
      }
      return assignments.flatMap(assignment => {
        const subject = subjects.get(assignment.data.subject_id);
        if (!Number.isInteger(assignment.id) || !subject) {
          throw new Error('WaniKani did not return a required subject. Try loading your reviews again.');
        }
        return subject.data.hidden_at ? [] : [createItem(assignment, subject)];
      });
    },

    async saveReview(item, reconcile = false) {
      const payload = reviewPayload(item);
      const id = item.assignment.id;
      const occurrence = `${id}:${item.assignment.data.available_at}`;
      if (saved.has(occurrence)) return { alreadySaved: true };
      if (saving.has(id)) throw new Error('This review is already saving.');
      saving.add(id);
      try {
        if (reconcile) {
          const current = await request(`assignments/${id}`);
          validateAssignment(current);
          if (current.id !== id || current.data.subject_id !== item.assignment.data.subject_id) {
            throw new Error('Could not verify this assignment. Please retry.');
          }
          if (!isDue(current, Date.now()) ||
              Date.parse(current.data.available_at) !== Date.parse(item.assignment.data.available_at) ||
              current.data.srs_stage !== item.assignment.data.srs_stage) {
            saved.add(occurrence);
            return { alreadySaved: true };
          }
        }
        const result = await request('reviews', payload);
        saved.add(occurrence);
        return result;
      } finally {
        saving.delete(id);
      }
    },
  };
}
