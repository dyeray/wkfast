# WKFast

A barebones mobile WaniKani review client. Preact + HTM, plain JavaScript modules, static hosting, no build step, backend, database, or browser storage.

## Run locally

Use Node 22.12+ for setup and tests, and Python 3 for the example static server:

```sh
npm install
npm run dev
```

Open the app with your WaniKani API key in the `api_key` query parameter. The key needs **reviews:create** permission:

```text
http://localhost:5173/?api_key=YOUR_KEY
```

Reviews start directly. The query parameter stays in the URL so refreshing works. There is no key-entry form or login flow; without the parameter, the page displays the required URL format.

Installation is local to `node_modules/`. The postinstall script copies Preact, its hooks, HTM, and their licenses into `vendor/`. Nothing is installed globally, and nothing is compiled. Run `npm run vendor` to repeat the copy after updating dependencies.

## Review

- Each session shuffles the due reviews. The order stays fixed while you work through that session.
- **Meaning:** think of the answer, tap **Show meaning**, then **Correct** or **Incorrect**. **Incorrect** immediately records one meaning mistake and moves to the next item, queuing the missed meaning for later without a retry/next screen.
- Revealed meanings show the main meaning and accepted alternatives, including WaniKani's whitelisted auxiliary meanings.
- **Kanji details:** after revealing an answer, tap a kanji in the subject to open its meanings and separate on’yomi/kun’yomi readings. Vocabulary kanji open individually. Close the popup with **Close**, Escape, or a tap outside it. Details are fetched as needed and cached only in memory; opening them never submits a review.
- **Reading:** hold a kana row and flick toward an option, or tap the row and then an option on its radial menu. Browser context menus and text selection are suppressed inside the kana keyboard. Vowels use the Japanese layout: a in the center, i left, u up, e right, o down. Voiced rows, small kana, ん, and ー are included. The reading input suppresses the software keyboard and is read-only on touch-first devices; the custom keyboard updates it directly. Desktop physical keyboard entry remains available. **Check reading** accepts WaniKani's accepted readings, with katakana converted to hiragana. A listed but nonaccepted reading only shakes the input and lets you retry: no answer revealed, no mistake counted, and no vibration.
- **Review colors:** radicals are blue, kanji pink, and vocabulary purple. Meaning prompts use a white bar; reading prompts use a dark bar.
- **Snooze:** excludes the entire item for this session. It makes no change to WaniKani.
- **Incorrect reading:** the failure remains pending and the answer stays hidden until you tap **Show**. The square **→** button commits that mistake and queues the reading for later. **↻** retries immediately without recording the pending mistake. Earlier committed mistakes and the passed meaning are preserved. Neither button submits an unfinished review.
- A review is submitted only after every required part is answered correctly. Mistake counts are sent separately for meaning and reading. Radicals and kana vocabulary require meaning only.
- A failed save keeps the completed item on screen. **Retry save** first checks the assignment's status so a timed-out successful save is not sent again.

## Host statically

The [GitHub Pages workflow](.github/workflows/pages.yml) runs the tests and deploys `index.html`, `src/`, and `vendor/` on every push to `main`. It only copies these static files into a deployment artifact; no compilation or dependency installation is needed. The site URL is <https://dyeray.github.io/wkfast/>.

One-time repository setup: under **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source. The workflow can also be run manually from the Actions tab.

Serve these paths together from any static host, using HTTPS in production:

```text
index.html
src/
vendor/
```

Use the directory layout above, including when hosting under a subdirectory. There is no `dist/`, build command, runtime npm, or Node server. No CDN scripts are loaded. Do not publish `.git/`, `node_modules/`, or your API key. The Python server above is for local development.

The app calls `https://api.wanikani.com/v2/` directly. Image-only radicals are loaded from WaniKani's CDN. A static host can add `Referrer-Policy: no-referrer`; the page and requests already set no-referrer policies.

## Checks

```sh
npm test
```

Tests use Node's built-in runner and do not need npm dependencies. `tests/browser-smoke.js` contains a Playwright browser-tool scenario that mocks WaniKani and verifies the mobile review flow without changing a real account. Run its function through the Playwright `browser_run_code` tool while the local server is running at port 5173. It uses no live token.

## Limits

Session state stays in memory and the key comes only from the URL. Reloading starts a new session using that query parameter; unfinished answers, their mistake counts, and snoozes are lost. Completed reviews already acknowledged by WaniKani remain saved. There is no offline queue, lessons, or persistent login. Avoid reviewing the same item in multiple clients at once.

The API key is visible in the URL and may appear in browser history and hosting access logs. Treat the URL as a credential.

Independent client; not affiliated with WaniKani. API behavior follows the [WaniKani API reference](https://docs.api.wanikani.com/20170710/).
