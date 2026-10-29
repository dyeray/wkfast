// Run this function with Playwright's browser_run_code tool against a static server on port 5173.
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const data = (characters, meaning, readings) => ({
    characters, hidden_at: null,
    meanings: [{ meaning, accepted_answer: true }],
    ...(readings && { readings: readings.map(reading => ({ reading, accepted_answer: true })) }),
  });
  const subjects = [
    { id: 440, object: 'kanji', data: { ...data('一', 'One', ['いち']), readings: [
      { reading: 'いち', type: 'onyomi', accepted_answer: true }, { reading: 'ひと', type: 'kunyomi', accepted_answer: false },
    ], meanings: [
      { meaning: 'One', primary: true, accepted_answer: true },
      { meaning: 'Single', primary: false, accepted_answer: true },
    ], auxiliary_meanings: [
      { meaning: 'Unity', type: 'whitelist' }, { meaning: 'Wrong', type: 'blacklist' },
    ] } },
    { id: 441, object: 'vocabulary', data: data('学校', 'School', ['がっこう']) },
    { id: 442, object: 'radical', data: { ...data(null, 'Ground'), character_images: [
      { url: 'https://cdn.wanikani.com/test-radical.svg', content_type: 'image/svg+xml' },
    ] } },
    { id: 443, object: 'kana_vocabulary', data: data('ありがとう', 'Thank you') },
  ];
  const kanjiDetails = [
    { id: 500, object: 'kanji', data: { ...data('学', 'Study', ['がく']), readings: [
      { reading: 'がく', type: 'onyomi', accepted_answer: true },
      { reading: 'まなぶ', type: 'kunyomi', accepted_answer: false },
    ] } },
    { id: 501, object: 'kanji', data: { ...data('校', 'School', ['こう']), readings: [
      { reading: 'こう', type: 'onyomi', accepted_answer: true },
    ] } },
  ];
  const assignments = subjects.map((subject, index) => ({ id: index + 12, data: {
    subject_id: subject.id, subject_type: subject.object, hidden: false,
    started_at: '2020-01-01T00:00:00Z', available_at: '2020-01-01T01:00:00Z',
    burned_at: null, srs_stage: 3,
  } }));
  const writes = [];
  let vibrations = 0;
  await page.exposeFunction('recordVibration', () => { vibrations++; });
  await page.addInitScript(() => {
    navigator.vibrate = () => { window.recordVibration(); return true; };
    // Keep this scripted fixture in a predictable order while production sessions shuffle.
    Math.random = () => 0.999999;
  });
  let firstSave = true;
  let releaseFirstSave;
  const firstSaveGate = new Promise(resolve => { releaseFirstSave = resolve; });
  let releaseRadicalSave;
  const radicalSaveGate = new Promise(resolve => { releaseRadicalSave = resolve; });
  let firstRadicalSave = true;
  const warnsBeforeLeaving = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  let detailFetches = 0;
  await page.route('https://cdn.wanikani.com/**', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path stroke="white" stroke-width="10" d="M10 50h80"/></svg>',
  }));
  await page.route('https://api.wanikani.com/v2/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert(request.headers().authorization === 'Bearer smoke-test-token', 'Missing auth header');
    assert(!request.headers().referer, 'Token must not leak through a referrer');
    let body;
    if (request.method() === 'POST') {
      const review = request.postDataJSON().review;
      writes.push(review);
      if (firstSave) {
        firstSave = false;
        await firstSaveGate;
        await route.fulfill({ status: 500, json: { error: 'Temporary failure' } });
        return;
      }
      if (review.assignment_id === 14 && firstRadicalSave) {
        firstRadicalSave = false;
        await radicalSaveGate;
        await route.fulfill({ status: 500, json: { error: 'Temporary failure' } });
        return;
      }
      body = { id: 0, object: 'review' };
    } else if (url.searchParams.get('types') === 'kanji') {
      detailFetches++;
      if (detailFetches === 1) {
        await route.fulfill({ status: 500, json: { error: 'Temporary lookup failure' } });
        return;
      }
      body = { data: kanjiDetails.filter(subject => subject.data.characters === url.searchParams.get('slugs')), pages: { next_url: null } };
    } else if (/\/assignments\/\d+$/.test(url.pathname)) {
      body = assignments.find(assignment => assignment.id === Number(url.pathname.split('/').pop()));
    } else {
      body = { data: url.pathname.endsWith('/assignments') ? assignments : subjects, pages: { next_url: null } };
    }
    await route.fulfill({ json: body });
  });
  await page.goto('http://localhost:5173/?api_key=smoke-test-token');
  await page.getByRole('button', { name: 'Show meaning', exact: true }).waitFor();
  assert(new URL(page.url()).searchParams.get('api_key') === 'smoke-test-token', 'Query key must remain available for refresh');
  assert(await page.locator('input[type="password"]').count() === 0, 'No API-key entry form should exist');
  assert(await page.getByText('Unity', { exact: true }).count() === 0, 'Alternative meanings must remain hidden before Show');
  assert(await page.getByRole('button', { name: 'Show details for 一', exact: true }).count() === 0, 'Kanji details must not be available before revealing an answer');
  await page.getByRole('button', { name: 'Show meaning', exact: true }).click();
  assert(await page.locator('.answer').textContent() === 'One', 'The primary meaning must be shown separately');
  assert(await page.locator('.alternative-meanings').textContent() === 'Alternative meanings: Single, Unity', 'Accepted alternative meanings must be visible while grading');
  await page.getByRole('button', { name: 'Show details for 一', exact: true }).click();
  const ownKanji = page.getByRole('dialog', { name: '一 kanji details', exact: true });
  await ownKanji.getByText('ひと', { exact: true }).waitFor();
  assert(await ownKanji.getByText('いち', { exact: true }).count() === 1, 'Popup must include on’yomi');
  assert(await ownKanji.getByText('Single, Unity', { exact: true }).count() === 1, 'Popup must include alternative meanings');
  assert(await ownKanji.getByText('Wrong', { exact: true }).count() === 0, 'Blacklisted meanings must not be shown as alternatives');
  await page.keyboard.press('Escape');
  await ownKanji.waitFor({ state: 'detached' });
  assert(await page.getByRole('button', { name: 'Show details for 一', exact: true }).evaluate(button => button === document.activeElement), 'Closing the dialog must restore focus');
  assert(detailFetches === 0 && writes.length === 0, 'Opening the current kanji must reuse its data without submitting a review');
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  assert(await page.getByRole('button', { name: 'Show details for 一', exact: true }).count() === 0, 'Details must be hidden again during the unanswered reading');
  const contextMenus = await page.getByRole('button', { name: 'は row', exact: true }).evaluate(button => ({
    keyboard: !button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
    outside: document.querySelector('h1').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
  }));
  assert(contextMenus.keyboard && contextMenus.outside, 'Context menus must be suppressed only inside the keyboard');
  assert(await page.getByLabel('Your reading').evaluate(input => input.inputMode) === 'none', 'Reading input must suppress the software keyboard');
  await page.getByLabel('Your reading').fill('いぬ');
  await page.getByRole('button', { name: 'Check reading', exact: true }).click();
  await page.getByText('Failed', { exact: true }).waitFor();
  assert(await page.locator('.accepted-answer').count() === 0, 'Failed reading must remain hidden');
  await page.getByRole('button', { name: 'Show', exact: true }).click();
  assert(await page.locator('.accepted-answer').textContent() === 'いち', 'Show must reveal the correct reading');
  await page.getByRole('button', { name: 'Retry review', exact: true }).click();
  await page.getByLabel('Your reading').fill('ひと');
  await page.getByRole('button', { name: 'Check reading', exact: true }).click();
  await page.getByText('Try another reading.', { exact: true }).waitFor();
  assert(await page.getByLabel('Your reading').isEnabled(), 'Retry input must stay editable');
  assert(await page.locator('.reading-input.shake').count() === 1, 'Retry must shake the input');
  assert(await page.locator('.accepted-answer').count() === 0, 'Retry must not reveal the accepted reading');
  assert(await page.getByRole('button', { name: 'Retry review', exact: true }).count() === 0, 'Retry must not require acknowledgement');
  assert(vibrations === 0, 'Retry must never vibrate');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('button', { name: 'あ row', exact: true }).click();
  await page.getByRole('group', { name: 'あ kana options', exact: true }).waitFor();
  await page.getByRole('button', { name: 'い', exact: true }).click({ button: 'right' });
  assert(await page.getByLabel('Your reading').inputValue() === '', 'Right-clicking an option must not enter kana');
  await page.getByRole('button', { name: 'い', exact: true }).click();
  await page.getByRole('button', { name: 'た row', exact: true }).click();
  await page.getByRole('button', { name: 'ち', exact: true }).click();
  assert(await page.getByLabel('Your reading').inputValue() === 'いち', 'Radial tap keyboard failed');
  for (const [row, kana] of [['は', 'ふ'], ['あ', 'い'], ['な', 'な']]) {
    const box = await page.getByRole('button', { name: `${row} row`, exact: true }).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const option = await page.getByRole('button', { name: kana, exact: true }).boundingBox();
    await page.mouse.move(option.x + option.width / 2, option.y + option.height / 2, { steps: 4 });
    await page.mouse.up();
    assert(await page.getByLabel('Your reading').inputValue() === `いち${kana}`, `Flick on ${row} must enter displayed ${kana}`);
    await page.getByRole('button', { name: 'Backspace', exact: true }).click();
  }
  await page.getByLabel('Your reading').fill('かこう');
  await page.getByLabel('Your reading').evaluate(input => input.setSelectionRange(1, 1));
  await page.getByRole('button', { name: 'っ row', exact: true }).click();
  await page.getByRole('button', { name: 'っ', exact: true }).click();
  assert(await page.getByLabel('Your reading').inputValue() === 'かっこう', 'Middle insertion failed');
  assert(await page.getByLabel('Your reading').evaluate(input => input.selectionStart) === 2, 'Insertion moved caret to end');
  await page.getByRole('button', { name: 'Backspace', exact: true }).click();
  assert(await page.getByLabel('Your reading').inputValue() === 'かこう', 'Middle backspace failed');
  await page.getByLabel('Your reading').fill('いち');
  await page.getByRole('button', { name: 'Check reading', exact: true }).evaluate(button => { button.click(); button.click(); });
  await page.getByText('学校', { exact: true }).waitFor();
  assert(writes.length === 1, 'Next review must appear before the save returns, without a duplicate write');
  assert(await warnsBeforeLeaving(), 'Pending saves must warn before leaving the page');
  releaseFirstSave();
  await page.getByRole('button', { name: 'Retry save', exact: true }).waitFor();
  assert(await page.getByRole('button', { name: 'Show meaning', exact: true }).isEnabled(), 'Failed saves must not block the current review');
  await page.getByRole('button', { name: 'Retry save', exact: true }).evaluate(button => { button.click(); button.click(); });
  await page.getByRole('region', { name: 'Review saves', exact: true }).waitFor({ state: 'detached' });
  assert(writes.length === 2, 'Unexpected duplicate save');
  assert(writes[1].incorrect_meaning_answers === 0 && writes[1].incorrect_reading_answers === 0, 'Retry must not commit pending mistakes');
  assert(await page.getByRole('button', { name: 'Show details for 学', exact: true }).count() === 0, 'Vocabulary kanji must stay unrevealed before Show');
  await page.getByRole('button', { name: 'Show meaning', exact: true }).click();
  await page.getByRole('button', { name: 'Show details for 学', exact: true }).click();
  const study = page.getByRole('dialog', { name: '学 kanji details', exact: true });
  await study.getByRole('alert').waitFor();
  await study.getByRole('button', { name: 'Retry kanji lookup', exact: true }).click();
  await study.getByText('まなぶ', { exact: true }).waitFor();
  assert(await study.getByText('Study', { exact: true }).count() === 1, 'Vocabulary popup must show the clicked kanji’s meaning');
  await study.getByRole('button', { name: 'Close kanji details', exact: true }).click();
  await study.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Show details for 学', exact: true }).click();
  await study.getByText('Study', { exact: true }).waitFor();
  assert(detailFetches === 2, 'Successful kanji details must be cached for this session');
  await page.keyboard.press('Escape');
  await study.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Show details for 校', exact: true }).click();
  const school = page.getByRole('dialog', { name: '校 kanji details', exact: true });
  await school.getByText('こう', { exact: true }).waitFor();
  assert(await school.getByText('—', { exact: true }).count() === 1, 'Missing kun’yomi must be represented without inventing a reading');
  await school.getByRole('button', { name: 'Close kanji details', exact: true }).click();
  await school.waitFor({ state: 'detached' });
  assert(writes.length === 2, 'Kanji lookups must not submit reviews');
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  await page.getByRole('button', { name: 'Snooze', exact: true }).click();
  await page.getByRole('img', { name: 'Radical to review', exact: true }).waitFor();
  assert(await page.getByRole('img').getAttribute('alt') === 'Radical to review', 'Image alt leaks meaning');
  assert(await page.getByRole('button', { name: 'Show radical details', exact: true }).count() === 0, 'Radical details must remain hidden before Show');
  await page.getByRole('button', { name: 'Show meaning', exact: true }).click();
  await page.getByRole('button', { name: 'Show radical details', exact: true }).click();
  const radicalDetails = page.getByRole('dialog', { name: 'Ground radical details', exact: true });
  await radicalDetails.getByText('Ground', { exact: true }).waitFor();
  assert(await radicalDetails.getByRole('img', { name: 'Ground radical', exact: true }).count() === 1, 'Image radical must also appear in its popup');
  assert(await radicalDetails.getByText('Radicals do not have readings.', { exact: true }).count() === 1, 'Radicals must not invent kanji readings');
  assert(detailFetches === 3 && writes.length === 2, 'Radical popup must reuse its subject and preserve the review');
  await radicalDetails.getByRole('button', { name: 'Close radical details', exact: true }).click();
  await radicalDetails.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  await page.getByText('ありがとう', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Show meaning', exact: true }).click();
  await page.getByRole('button', { name: 'Incorrect', exact: true }).click();
  await page.getByRole('button', { name: 'Show meaning', exact: true }).waitFor();
  assert(await page.locator('.failure-panel').count() === 0, 'Meaning grading must skip the reading failure panel');
  assert(await page.getByText('1 mistakes', { exact: true }).count() === 1, 'Incorrect meaning must count immediately');
  assert(writes.length === 3, 'Incorrect meaning must not submit an unfinished review');
  await page.getByRole('button', { name: 'Show meaning', exact: true }).click();
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  await page.getByRole('heading', { name: 'Answers complete', exact: true }).waitFor();
  await page.getByText('Saving 1 review…', { exact: true }).waitFor();
  assert(writes.length === 4, 'Multiple reviews must save independently while earlier writes are pending');
  assert(await page.getByRole('heading', { name: 'Session complete', exact: true }).count() === 0, 'Session must not claim success with an unconfirmed save');
  assert(await page.getByRole('button', { name: 'Check for more reviews', exact: true }).isDisabled(), 'Starting another session must not discard pending saves');
  assert(await warnsBeforeLeaving(), 'The last pending save must keep the unload warning active');
  releaseRadicalSave();
  await page.getByRole('button', { name: 'Retry save', exact: true }).waitFor();
  assert(await page.getByRole('heading', { name: 'Session complete', exact: true }).count() === 0, 'A failed final save must not be called complete');
  assert(await page.getByRole('button', { name: 'Check for more reviews', exact: true }).isDisabled(), 'Failed saves must be retained before starting a new session');
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await page.getByRole('heading', { name: 'Session complete' }).waitFor();
  await page.getByRole('region', { name: 'Review saves', exact: true }).waitFor({ state: 'detached' });
  assert(!await warnsBeforeLeaving(), 'Saved sessions must not keep warning on unload');
  assert(writes.length === 5, 'Snoozed item was written or completed item was lost');
  assert(writes[3].incorrect_meaning_answers === 1, 'Deferring lost the meaning mistake');
  assert(!writes.some(review => review.assignment_id === 13), 'Snoozed assignment submitted');
  assert(await page.getByText('3 reviewed · 1 snoozed', { exact: true }).count() === 1, 'Session counts are wrong');
  const storage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length,
    overflow: document.documentElement.scrollWidth > innerWidth }));
  assert(storage.local === 0 && storage.session === 0, 'Credentials or session persisted');
  assert(!storage.overflow, 'Horizontal overflow at phone width');
  assert(errors.length === 0, errors.join('\n'));
  await page.reload();
  await page.getByRole('button', { name: 'Show meaning', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Show meaning', exact: true }).click();
  await page.getByRole('button', { name: 'Incorrect', exact: true }).click();
  await page.getByText('学校', { exact: true }).waitFor();
  assert(await page.locator('.failure-panel').count() === 0, 'Incorrect meaning must advance directly to the next item');
  assert(writes.length === 5, 'Deferring a meaning must not write to WaniKani');
  await page.goto('http://localhost:5173/');
  await page.getByRole('heading', { name: 'Missing API key', exact: true }).waitFor();
  assert(await page.locator('input').count() === 0, 'Missing query parameter must not introduce a key-entry form');
  const phoneContext = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const phone = await phoneContext.newPage();
    await phone.route('https://api.wanikani.com/v2/**', route => route.fulfill({ json: {
      data: new URL(route.request().url()).pathname.endsWith('/assignments') ? [assignments[0]] : [subjects[0]],
      pages: { next_url: null },
    } }));
    await phone.goto('http://localhost:5173/?api_key=smoke-test-token');
    await phone.getByRole('button', { name: 'Show meaning', exact: true }).tap();
    await phone.getByRole('button', { name: 'Show details for 一', exact: true }).tap();
    const phoneDetails = phone.getByRole('dialog', { name: '一 kanji details', exact: true });
    await phoneDetails.getByText('ひと', { exact: true }).waitFor();
    assert(await phoneDetails.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), 'Kanji popup must fit the phone viewport');
    await phoneDetails.getByRole('button', { name: 'Close kanji details', exact: true }).tap();
    await phoneDetails.waitFor({ state: 'detached' });
    await phone.getByRole('button', { name: 'Correct', exact: true }).tap();
    const input = phone.getByLabel('Your reading');
    assert(await input.evaluate(element => element.readOnly && element.inputMode === 'none'), 'Phone reading input must be readonly and suppress its software keyboard');
    await input.tap();
    await phone.getByRole('button', { name: 'あ row', exact: true }).tap();
    assert(await input.inputValue() === '', 'Opening a kana row must not enter a character on the same tap');
    await phone.getByRole('group', { name: 'あ kana options', exact: true }).waitFor();
    await phone.getByRole('button', { name: 'い', exact: true }).tap();
    assert(await input.inputValue() === 'い', 'Custom keyboard must still update the readonly phone input');
    await phone.getByRole('button', { name: 'た row', exact: true }).tap();
    await phone.getByRole('button', { name: 'ち', exact: true }).tap();
    assert(await input.inputValue() === 'いち', 'Consecutive phone taps must preserve kana order');
    await phone.getByRole('button', { name: 'か row', exact: true }).focus();
    await phone.getByRole('button', { name: 'か row', exact: true }).press('Enter');
    await phone.getByRole('button', { name: 'か', exact: true }).focus();
    await phone.getByRole('button', { name: 'か', exact: true }).press('Enter');
    assert(await input.inputValue() === 'いちか', 'Keyboard activation must still select a kana once');
    await phone.unroute('https://api.wanikani.com/v2/**');
    let radical;
    await phone.route('https://api.wanikani.com/v2/**', route => route.fulfill({ json: {
      data: new URL(route.request().url()).pathname.endsWith('/assignments') ? [assignments[2]] : [radical],
      pages: { next_url: null },
    } }));
    await phone.route('https://cdn.wanikani.com/**', route => route.fulfill({
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path stroke="white" stroke-width="10" d="M10 50h80"/></svg>',
    }));
    for (const characters of [null, '一']) {
      radical = { ...subjects[2], data: { ...subjects[2].data, characters } };
      await phone.goto('http://localhost:5173/?api_key=smoke-test-token');
      const trigger = phone.getByRole('button', { name: characters ? 'Show details for 一' : 'Show radical details', exact: true });
      await phone.getByRole('button', { name: 'Show meaning', exact: true }).waitFor();
      assert(await trigger.count() === 0, 'Touch radical details must stay hidden before revealing');
      await phone.getByRole('button', { name: 'Show meaning', exact: true }).tap();
      await trigger.tap();
      const details = phone.getByRole('dialog', { name: `${characters || 'Ground'} radical details`, exact: true });
      await details.getByText('Ground', { exact: true }).waitFor();
      assert(await details.getByText('On’yomi', { exact: true }).count() === 0, 'Radical popup must not show kanji-only reading labels');
      await details.getByRole('button', { name: 'Close radical details', exact: true }).tap();
      await details.waitFor({ state: 'detached' });
      assert(await phone.getByText('0 mistakes', { exact: true }).count() === 1, 'Closing radical details must preserve grading state');
    }
  } finally {
    await phoneContext.close();
  }
  return { passed: true, writes: writes.length, viewport: '390×844', errors };
}
