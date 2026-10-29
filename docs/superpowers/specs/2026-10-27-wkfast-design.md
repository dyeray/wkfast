# WKFast first version

Status: approved by the user on 2026-10-27; implementation authorized in this repository.

## Intent and scope

A barebones, phone-friendly WaniKani review website. Preact and HTM run entirely in the browser. The app needs no backend, database, account system, or browser persistence. WaniKani remains the source of review assignments and completed results.

The user confirmed that meanings are self-graded and hiragana readings are checked automatically.

## Approach

User-selected implementation: Preact with HTM, using native JavaScript modules without a compiler or bundler. npm installs the dependencies locally; a short copy script places their browser modules and licenses in `vendor/`. Any static server can serve `index.html`, `src/`, and `vendor/`. WaniKani explicitly supports cross-origin browser access.

React with Vite would provide JSX compilation and bundling, but those are unnecessary with HTM. Server-rendered React adds a server without helping this session-only interface. A native phone app adds installation and platform work; a responsive website covers the requested use case. No keyboard dependency is needed for a two-tap kana selector.

## Review flow

1. Read the token exclusively from `?api_key=…` and start reviews directly. Keep the parameter in the URL so refresh can start another session. Without a token, display the required URL format. Do not provide a key-entry form, login, disconnect flow, or credential persistence.
2. Fetch due, started, visible assignments and their subjects, handling pagination. Include kanji, vocabulary, radicals, and kana vocabulary; only request readings for subjects that have them. Show image-only radicals using their WaniKani image.
3. Present one item with large text and thumb-friendly controls. Show meaning first: **Show**, then **Correct** or **Incorrect**. **Incorrect** immediately counts one meaning mistake and advances to the next item, queuing the missed meaning for later. There is no failure panel or extra confirmation for meanings.
4. For reading, enter kana using a radial flick keypad: hold a consonant row, drag toward a kana, and release, or tap the row then an option. The usual vowel layout is a in the center, i left, u up, e right, o down. Include voiced and semi-voiced rows, small kana, ん, the long-vowel mark, backspace, and clear. Allow desktop physical keyboard input, but suppress the reading field's software keyboard using `inputmode="none"` and a read-only field on touch-first devices. The custom keyboard still changes its value. Check only readings marked `accepted_answer`, normalizing Unicode and katakana to hiragana. A wrong reading creates a pending failure with its answer concealed until **Show** is clicked. Square **→** counts the mistake and queues the reading for later; **↻** retries immediately without counting the pending mistake. Both preserve earlier committed mistakes and the passed meaning. A listed but nonaccepted reading only shakes the input with a generic retry notice: no answer revelation, no mistake, no acknowledgement step, and no vibration.
5. Once all required parts have been answered correctly, immediately advance and save one combined review in the background with this session's meaning and reading mistake counts. The session owns pending saves so they survive item changes. Guard duplicate completion and retry clicks. Keep failed saves visible with retry actions while allowing further reviews. Show **Answers complete** while any save is pending or failed and **Session complete** only after every save is acknowledged. Disable starting another session until saves finish and request a browser leave warning while anything remains unsaved.
6. **Snooze** removes the whole item from this session without submitting a review. Snoozes disappear on reload.
7. Show a simple completed count and an end-of-session message.

Completing meaning and reading together limits partially finished work if the browser closes. This ordering is an implementation choice, not a user requirement.

Use WaniKani-style subject backgrounds (blue radical, pink kanji, purple vocabulary), white meaning prompts, and dark reading prompts. Keep the original self-grading meaning flow and independent client branding.

Revealed meanings show the primary meaning and accepted alternatives, including whitelisted auxiliary meanings. Only while an answer is revealed, radicals and kanji in the displayed subject become tappable, including image-only radicals. A native modal dialog shows meanings and, for kanji, separately labeled on’yomi and kun’yomi, including nonaccepted dictionary readings. Radicals show their character or image and a note that they have no readings. Vocabulary kanji are looked up individually through WaniKani's subject filter; current radical and kanji subjects reuse their data. Handle lookup failures with a retry inside the dialog and keep successful lookups in memory only. Closing the dialog restores focus and preserves the review, input, and mistake counts.

## Errors and credentials

Show actionable authentication, permission, rate-limit, loading, and saving errors. Keep unsaved completed items in the session's in-memory pending list with retry actions. Before retrying an ambiguous failed submission, check whether its assignment is still due to avoid submitting it twice.

Use an API token allowed to create reviews. Do not log tokens, save credentials in browser storage, use analytics, or load third-party scripts. Set a no-referrer policy. The token stays in the query string as requested, so the URL itself is a credential and can appear in browser history and hosting logs.

Reloading loses unfinished answers, their mistake counts, and unconfirmed saves. Previously acknowledged reviews remain in WaniKani. Keep the page open until all saves finish; leave warnings are best effort and cannot prevent every mobile shutdown. No persistent offline queue or resume mechanism is included.

## Files and checks

Create the Preact entry point, review session logic, kana keypad, WaniKani API client, mobile styles, package configuration and vendor copy script, and a short README for running and static hosting. Use a small meaningful test suite for review counts, subject-specific requirements, accepted readings, kana input, pagination, snoozing, failed submissions, and vendor copying. Verify JavaScript syntax and the review flow in a phone-sized browser with mocked API responses; live account writes require a real token.

Skip lessons, audio, mnemonics, dashboards, settings, service workers, installation flows, and persistent storage.

## Reference

[WaniKani API reference](https://docs.api.wanikani.com/20170710/): browser access, assignments, subjects, and review submission.
