import { h } from 'preact';
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { createApi } from './api.js';
import { reviewReducer, shuffleReviews, deferReview, meaningDetails } from './review.js';
import { normalizeReading, editKana } from './kana.js';
import { KanaKeyboard } from './KanaKeyboard.js';
import { KanjiDetails } from './KanjiDetails.js';

const html = htm.bind(h);
const LABELS = { kanji: 'Kanji', vocabulary: 'Vocabulary', radical: 'Radical', kana_vocabulary: 'Kana vocabulary' };

function FailedAnswer({ revealed, value, lang, onShow, onNext, onRetry }) {
  return html`
    <div class="failure-panel">
      <p class="error" role="status">Failed</p>
      <button type="button" class="primary" onClick=${onShow} aria-expanded=${revealed} disabled=${revealed}>Show</button>
      ${revealed && html`<p class="accepted-answer" lang=${lang}>${value}</p>`}
      <div class="failure-actions">
        <button type="button" class="square-action" aria-label="Next review" title="Next review" onClick=${onNext}><span aria-hidden="true">→</span></button>
        <button type="button" class="square-action" aria-label="Retry review" title="Retry review" onClick=${onRetry}><span aria-hidden="true">↻</span></button>
      </div>
    </div>
  `;
}

function Review({ initialItem, api, onDone, onNext }) {
  const [item, dispatch] = useReducer(reviewReducer, initialItem);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(false);
  const [selectedKanji, setSelectedKanji] = useState(null);
  const [touchInput] = useState(() => matchMedia('(pointer: coarse)').matches);
  const busy = useRef(false);
  const leaving = useRef(false);
  const field = useRef(null);
  const caret = useRef(null);
  const { subject, phase, feedback } = item;
  const image = subject.data.character_images?.find(image => image.content_type === 'image/svg+xml');
  const meanings = meaningDetails(subject);
  const readings = subject.data.readings?.filter(reading => reading.accepted_answer).map(reading => reading.reading).join(' / ');

  useLayoutEffect(() => {
    if (caret.current !== null && field.current) {
      field.current.focus({ preventScroll: true });
      field.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });

  async function save(completedItem, retry = false) {
    if (busy.current || leaving.current) return;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      await api.saveReview(completedItem, retry);
      leaving.current = true;
      onDone(false);
    } catch (error) {
      setError(error.message);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  function answer(action) {
    if (busy.current || leaving.current) return;
    const next = reviewReducer(item, action);
    if (action.type === 'meaning' && !action.correct && next !== item) {
      leaving.current = true;
      onNext(next);
      return;
    }
    dispatch(action);
    if (action.type === 'reading' && next.feedback === 'retry') {
      field.current.classList.remove('shake');
      void field.current.offsetWidth;
      field.current.classList.add('shake');
      field.current.setSelectionRange(0, input.length);
    }
    if (next.phase === 'ready' && phase !== 'ready') save(next);
  }

  function changeInput(value) {
    setInput(value);
    field.current?.classList.remove('shake');
    if (feedback === 'retry') dispatch({ type: 'retry' });
  }

  function edit(value) {
    const start = field.current?.selectionStart ?? input.length;
    const end = field.current?.selectionEnd ?? input.length;
    const edit = editKana(input, start, end, value);
    caret.current = edit.caret;
    changeInput(edit.value);
    if (edit.value === input) {
      field.current?.setSelectionRange(edit.caret, edit.caret);
      caret.current = null;
    }
  }

  function snooze() {
    if (busy.current || leaving.current || phase === 'ready') return;
    leaving.current = true;
    dispatch({ type: 'snooze' });
    onDone(true);
  }

  function next() {
    if (busy.current || leaving.current || feedback !== 'incorrect') return;
    leaving.current = true;
    onNext(item);
  }

  const failure = feedback === 'incorrect' && html`
    <${FailedAnswer} revealed=${item.revealed} value=${readings}
      lang="ja" onShow=${() => answer({ type: 'show' })}
      onNext=${next} onRetry=${() => { setInput(''); answer({ type: 'retry' }); }} />
  `;

  return html`
    <section class="review" aria-label="Current review">
      <div class=${`subject ${subject.object}`}>
        ${subject.data.characters
          ? html`<div class="characters" lang="ja"><span>${Array.from(subject.data.characters).map(character =>
              item.revealed && (subject.object === 'kanji' || (subject.object === 'vocabulary' && /\p{Unified_Ideograph}/u.test(character)))
                ? html`<button class="kanji-character" type="button" aria-label=${`Show details for ${character}`} aria-haspopup="dialog"
                    onClick=${() => setSelectedKanji(character)}>${character}</button>` : character
            )}</span></div>`
          : html`<div class="characters"><img src=${image.url} alt="Radical to review" referrerPolicy="no-referrer" /></div>`}
      </div>

      <div class=${`question-type ${phase === 'reading' ? 'reading' : 'meaning'}`}>
        <strong>${LABELS[subject.object]}</strong> ${phase === 'reading' ? 'Reading' : 'Meaning'}
      </div>

      ${phase === 'meaning' && html`
        <div class="meaning-answer" aria-live="polite">
          <p class="eyebrow">Meaning</p>
          <p class=${item.revealed ? 'answer' : 'prompt'}>${item.revealed ? meanings.primary : 'Think of the meaning.'}</p>
          ${item.revealed && meanings.alternatives.length > 0 && html`<p class="alternative-meanings"><strong>Alternative meanings:</strong> ${meanings.alternatives.join(', ')}</p>`}
        </div>
        ${item.revealed ? html`
          <div class="grading">
            <button class="incorrect" onClick=${() => answer({ type: 'meaning', correct: false })}>Incorrect</button>
            <button class="primary" onClick=${() => answer({ type: 'meaning', correct: true })}>Correct</button>
          </div>
        ` : html`<button class="primary" onClick=${() => answer({ type: 'show' })}>Show meaning</button>`}
      `}

      ${phase === 'reading' && html`
        <form class="reading-form" onSubmit=${event => {
          event.preventDefault();
          if (!composing) answer({ type: 'reading', value: input });
        }}>
          <label class="eyebrow" for="reading">Your reading</label>
          <input id="reading" class=${`reading-input ${feedback === 'incorrect' ? 'answer-incorrect' : ''}`} ref=${field} lang="ja" value=${input}
            inputMode="none" readOnly=${touchInput}
            onInput=${event => changeInput(event.currentTarget.value)} disabled=${feedback === 'incorrect'}
            onAnimationEnd=${() => field.current?.classList.remove('shake')}
            aria-describedby=${feedback === 'retry' ? 'reading-hint' : undefined}
            onCompositionStart=${() => setComposing(true)} onCompositionEnd=${() => setComposing(false)}
            autoComplete="off" autoCapitalize="off" spellCheck=${false} placeholder="ひらがな" />
          ${feedback === 'incorrect' ? failure : html`
            ${feedback === 'retry' && html`<p class="reading-notice" id="reading-hint" role="status">Try another reading.</p>`}
            <${KanaKeyboard} onKana=${kana => edit(kana)} onBackspace=${() => edit(null)} onClear=${() => changeInput('')} disabled=${false} />
            <button class="primary" type="submit" disabled=${!normalizeReading(input) || composing}>Check reading</button>
          `}
        </form>
      `}

      ${phase === 'ready' && html`
        <div class="save-status" aria-live="polite">
          <p class="eyebrow">Review complete</p>
          ${saving ? html`<p>Saving to WaniKani…</p>` : error ? html`
            <p class="error" role="alert">${error}</p>
            <button class="primary" onClick=${() => save(item, true)}>Retry save</button>
          ` : html`<p>Saved.</p>`}
        </div>
      `}

      <div class="review-footer">
        <span>${item.mistakes.meaning + item.mistakes.reading} mistakes</span>
        <button class="text-button snooze" onClick=${snooze} disabled=${phase === 'ready' || saving}>Snooze</button>
      </div>
      ${selectedKanji && html`<${KanjiDetails} character=${selectedKanji} subject=${subject} api=${api} onClose=${() => setSelectedKanji(null)} />`}
    </section>
  `;
}

export function App({ initialToken = '' }) {
  const [api] = useState(() => initialToken ? createApi(initialToken) : null);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [snoozed, setSnoozed] = useState(0);

  useEffect(() => {
    if (!api) return;
    let active = true;
    setItems(null);
    setError('');
    api.loadReviews().then(reviews => {
      if (!active) return;
      setCursor(0); setCompleted(0); setSnoozed(0); setItems(shuffleReviews(reviews));
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [api, reload]);

  function advance(skipped) {
    if (skipped) setSnoozed(value => value + 1);
    else setCompleted(value => value + 1);
    setCursor(value => value + 1);
  }

  function next(item) {
    setItems(current => deferReview(current, item));
    setCursor(value => value + 1);
  }

  return html`
    <div class="app-shell">
      <header class="app-header">
        <h1>WK<span>Fast</span><span class="brand-dot" aria-hidden="true"></span></h1>
        <span class="session-progress" aria-live="polite">${api && items ? `${completed} done · ${items.length - cursor} left` : 'Reviews, simplified.'}</span>
      </header>
      <main>
        ${!api ? html`
          <section class="session-message">
            <h2>Missing API key</h2>
            <p>Open this page with your WaniKani API key in the URL:</p>
            <code>?api_key=YOUR_KEY</code>
          </section>
        ` : error ? html`
          <section class="session-message">
            <h2>Couldn’t load reviews</h2><p class="error" role="alert">${error}</p>
            <button class="primary" onClick=${() => setReload(value => value + 1)}>Try loading again</button>
          </section>
        ` : !items ? html`
          <section class="session-message" role="status"><div class="loading-dot" aria-hidden="true"></div><h2>Getting your reviews…</h2><p>A moment to settle in.</p></section>
        ` : cursor < items.length ? html`
          <${Review} key=${`${cursor}:${items[cursor].assignment.id}`} initialItem=${items[cursor]} api=${api} onDone=${advance} onNext=${next} />
        ` : html`
          <section class="session-message complete">
            <div class="complete-mark" aria-hidden="true">✓</div>
            <p class="eyebrow">A good place to pause.</p>
            <h2>${items.length ? 'Session complete' : 'All caught up'}</h2>
            <p>${completed} reviewed · ${snoozed} snoozed</p>
            <p class="help">${snoozed ? 'Snoozed items are still waiting in WaniKani.' : 'Your completed reviews are saved to WaniKani.'}</p>
            <button class="primary" onClick=${() => setReload(value => value + 1)}>Check for more reviews</button>
          </section>
        `}
      </main>
      <footer class="app-footer">Independent client for WaniKani.</footer>
    </div>
  `;
}
