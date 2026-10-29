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
      { reading: 'いち', accepted_answer: true }, { reading: 'ひと', accepted_answer: false },
    ] } },
    { id: 441, object: 'vocabulary', data: data('学校', 'School', ['がっこう']) },
    { id: 442, object: 'radical', data: { ...data(null, 'Ground'), character_images: [
      { url: 'https://cdn.wanikani.com/test-radical.svg', content_type: 'image/svg+xml' },
    ] } },
    { id: 443, object: 'kana_vocabulary', data: data('ありがとう', 'Thank you') },
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
        await route.fulfill({ status: 500, json: { error: 'Temporary failure' } });
        return;
      }
      body = { id: 0, object: 'review' };
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
  await page.getByRole('button', { name: 'Show meaning', exact: true }).click();
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
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
  await page.getByRole('button', { name: 'Check reading', exact: true }).click();
  await page.getByRole('button', { name: 'Retry save', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await page.getByText('学校', { exact: true }).waitFor();
  assert(writes.length === 2, 'Unexpected duplicate save');
  assert(writes[1].incorrect_meaning_answers === 0 && writes[1].incorrect_reading_answers === 0, 'Retry must not commit pending mistakes');
  await page.getByRole('button', { name: 'Show meaning', exact: true }).click();
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  await page.getByRole('button', { name: 'Snooze', exact: true }).click();
  await page.getByRole('img', { name: 'Radical to review', exact: true }).waitFor();
  assert(await page.getByRole('img').getAttribute('alt') === 'Radical to review', 'Image alt leaks meaning');
  await page.getByRole('button', { name: 'Show meaning', exact: true }).click();
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
  await page.getByRole('heading', { name: 'Session complete' }).waitFor();
  assert(writes.length === 4, 'Snoozed item was written or completed item was lost');
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
  assert(writes.length === 4, 'Deferring a meaning must not write to WaniKani');
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
    await phone.getByRole('button', { name: 'Correct', exact: true }).tap();
    const input = phone.getByLabel('Your reading');
    assert(await input.evaluate(element => element.readOnly && element.inputMode === 'none'), 'Phone reading input must be readonly and suppress its software keyboard');
    await input.tap();
    await phone.getByRole('button', { name: 'あ row', exact: true }).tap();
    await phone.getByRole('button', { name: 'い', exact: true }).tap();
    assert(await input.inputValue() === 'い', 'Custom keyboard must still update the readonly phone input');
  } finally {
    await phoneContext.close();
  }
  return { passed: true, writes: writes.length, viewport: '390×844', errors };
}
