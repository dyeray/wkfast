import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { meaningDetails } from './review.js';

const html = htm.bind(h);

export function KanjiDetails({ character, subject, api, onClose }) {
  const radical = subject.object === 'radical';
  const type = radical ? 'radical' : 'kanji';
  const image = subject.data.character_images?.find(image => image.content_type === 'image/svg+xml');
  const dialog = useRef(null);
  const [kanji, setKanji] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => { dialog.current.showModal(); }, []);

  useEffect(() => {
    let active = true;
    setError('');
    const lookup = subject.object !== 'vocabulary' ? Promise.resolve(subject) : api.loadKanji(character);
    lookup.then(kanji => { if (active) setKanji(kanji); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [character, subject, api, reload]);

  const meanings = kanji && meaningDetails(kanji);
  const readings = type => kanji.data.readings.filter(reading => reading.type === type).map(reading => reading.reading).join(', ') || '—';

  return html`
    <dialog class="kanji-details" ref=${dialog} aria-label=${`${character} ${type} details`} onClose=${onClose}
      onClick=${event => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div>
        <button class="text-button details-close" type="button" aria-label=${`Close ${type} details`} onClick=${() => dialog.current.close()}>Close</button>
        <h2 lang="ja">${radical && !subject.data.characters
          ? html`<img class="radical-detail-image" src=${image.url} alt=${`${character} radical`} referrerPolicy="no-referrer" />`
          : character}</h2>
        ${error ? html`
          <p class="error" role="alert">${error}</p>
          <button type="button" onClick=${() => setReload(value => value + 1)}>Retry kanji lookup</button>
        ` : !kanji ? html`<p role="status">Loading kanji details…</p>` : html`
          <dl>
            <dt>Meaning</dt><dd>${meanings.primary}</dd>
            ${meanings.alternatives.length > 0 && html`<dt>Alternative meanings</dt><dd>${meanings.alternatives.join(', ')}</dd>`}
            ${!radical && html`<dt>On’yomi</dt><dd lang="ja">${readings('onyomi')}</dd>
              <dt>Kun’yomi</dt><dd lang="ja">${readings('kunyomi')}</dd>`}
          </dl>
          ${radical && html`<p>Radicals do not have readings.</p>`}
        `}
      </div>
    </dialog>
  `;
}
