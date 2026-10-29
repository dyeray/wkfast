import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { KANA_ROWS, flickIndex } from './kana.js';

const html = htm.bind(h);
const DIRECTIONS = ['center', 'left', 'up', 'right', 'down'];

export function KanaKeyboard({ onKana, onBackspace, onClear, disabled }) {
  const [menu, setMenu] = useState(null);
  const gesture = useRef(null);
  const keyboard = useRef(null);

  useEffect(() => {
    const dismiss = event => {
      if (!keyboard.current?.contains(event.target)) { gesture.current = null; setMenu(null); }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);

  function open(row, button) {
    const box = button.getBoundingClientRect();
    const opened = { row, index: 0,
      x: Math.max(100, Math.min(innerWidth - 100, box.x + box.width / 2)),
      y: Math.max(100, Math.min(innerHeight - 100, box.y + box.height / 2)),
    };
    setMenu(opened);
    return opened;
  }

  function start(event, row) {
    if (disabled || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const center = open(row, event.currentTarget);
    gesture.current = { id: event.pointerId, row, x: event.clientX, y: event.clientY, center, moved: false };
  }

  function move(event) {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    const index = flickIndex(event.clientX - drag.center.x, event.clientY - drag.center.y);
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 8) drag.moved = true;
    setMenu(current => current && { ...current, index });
  }

  function finish(event) {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    gesture.current = null;
    if (drag.moved) {
      const kana = drag.row.kana[flickIndex(event.clientX - drag.center.x, event.clientY - drag.center.y)];
      if (kana && !disabled) onKana(kana);
      setMenu(null);
    }
  }

  return html`
    <div class="keyboard" ref=${keyboard} aria-label="Hiragana keyboard"
      onContextMenu=${event => event.preventDefault()}
      onKeyDown=${event => { if (event.key === 'Escape') { gesture.current = null; setMenu(null); } }}>
      <div class="keyboard-caption">
        <span>Hold a row and flick, or tap to choose</span>
        <div class="keyboard-tools">
          <button type="button" class="text-button" onClick=${() => { setMenu(null); onClear(); }} disabled=${disabled}>Clear</button>
          <button type="button" class="text-button backspace" aria-label="Backspace" onClick=${() => { setMenu(null); onBackspace(); }} disabled=${disabled}>⌫</button>
        </div>
      </div>
      <div class="kana-rows">
        ${KANA_ROWS.map(row => html`
          <button type="button" key=${row.hint} class="kana-key" aria-label=${`${row.label} row`}
            aria-expanded=${menu?.row === row} aria-controls=${menu?.row === row ? 'kana-options' : undefined}
            onPointerDown=${event => start(event, row)} onPointerMove=${move} onPointerUp=${finish}
            onPointerCancel=${() => { gesture.current = null; setMenu(null); }}
            onClick=${event => { if (event.detail === 0) open(row, event.currentTarget); }} disabled=${disabled}>
            <span lang="ja">${row.label}</span><small>${row.hint}</small>
          </button>
        `)}
      </div>
      ${menu && html`
        <div id="kana-options" class="radial-menu" role="group" aria-label=${`${menu.row.label} kana options`}
          style=${{ left: `${menu.x}px`, top: `${menu.y}px` }}>
          ${menu.row.kana.map((kana, index) => kana && html`
            <button key=${index} type="button" class=${`radial-option ${DIRECTIONS[index]} ${menu.index === index ? 'selected' : ''}`}
              lang="ja" aria-label=${kana} disabled=${disabled}
              onClick=${() => { onKana(kana); setMenu(null); }}>${kana}</button>
          `)}
        </div>
      `}
    </div>
  `;
}
