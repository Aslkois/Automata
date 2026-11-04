import { expect, test, type Page } from '@playwright/test';

const go = (page: Page, name: 'Construct' | 'Program' | 'Simulate') => page.getByRole('tablist').first().getByRole('tab', { name }).click();
const clock = async (page: Page) => Number((await page.getByTestId('sim-clock').textContent())!.match(/[\d.]+/)![0]);
const storedBrains = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('automata.library') ?? '{"brains":[]}').brains.length as number);

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto('/');
  await expect(page.getByRole('tablist').first()).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
});

test('construct: a new drone is a working machine; sections, mounting and rotation are functional', async ({ page }) => {
  await page.getByTestId('drone-switcher').click();
  await page.getByRole('button', { name: 'New drone' }).click();
  await go(page, 'Construct');
  await expect(page.getByLabel('Drone name')).toHaveValue('New drone');
  // integrated propulsion, CPU, power, cooling and sensing: nothing to install first
  await expect(page.getByTestId('issues-toggle')).toContainText('Ready to deploy');
  const mass0 = await page.getByTestId('stat-mass').textContent();
  await page.getByTestId('section-rear').click();
  await page.getByRole('group', { name: 'rear class' }).getByRole('button', { name: /Heavy/ }).click();
  await expect(page.getByTestId('stat-mass')).not.toHaveText(mass0!);
  // select an empty slot, then pick equipment from the tray: installed directly
  await page.getByTestId('slot-R.H1').click();
  await expect(page.getByTestId('slot-editor')).toContainText('Empty hardpoint');
  await page.getByRole('list', { name: 'Equipment library' }).getByRole('listitem', { name: 'Heavy Cannon' }).click();
  await expect(page.getByTestId('slot-R.H1')).toHaveAttribute('aria-label', /Heavy Cannon/);
  await expect(page.getByTestId('mount-rotation')).toHaveText('180°');
  await page.getByRole('button', { name: 'Rotate right' }).click();
  await expect(page.getByTestId('mount-rotation')).toHaveText('-135°');
  // arm a part without a selection, then place it
  await page.keyboard.press('Escape');
  await page.getByRole('list', { name: 'Equipment library' }).getByRole('listitem', { name: 'Optical Camera' }).click();
  await expect(page.getByRole('status')).toContainText('Placing Optical Camera');
  await page.getByTestId('slot-R.H2').click();
  await expect(page.getByTestId('slot-R.H2')).toHaveAttribute('aria-label', /Optical Camera/);
  // remove with the properties surface
  await page.getByTestId('properties').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('slot-R.H2')).toHaveAttribute('aria-label', /empty/);
  // the four chassis types
  for (const c of ['Walking', 'Flying', 'Tracked']) {
    await page.getByRole('radiogroup', { name: 'Chassis' }).getByRole('radio', { name: c }).click();
    await expect(page.getByRole('radiogroup', { name: 'Chassis' }).getByRole('radio', { name: c })).toHaveAttribute('aria-checked', 'true');
  }
  // persisted, with exactly one brain per drone
  await page.waitForTimeout(500);
  const designs = await page.evaluate(() => JSON.parse(localStorage.getItem('automata.library')!).designs.length as number);
  expect(await storedBrains(page)).toBe(designs);
  await page.reload();
  await go(page, 'Construct');
  await expect(page.getByLabel('Drone name')).toHaveValue('New drone');
  await expect(page.getByTestId('slot-R.H1')).toHaveAttribute('aria-label', /Heavy Cannon/);
});

test('program: one brain, three editors; edits in one view appear in the others', async ({ page }) => {
  await go(page, 'Program');
  await page.waitForTimeout(500);
  const brains = await storedBrains(page);
  const editor = page.getByRole('radiogroup', { name: 'Editor' });
  await editor.getByRole('radio', { name: 'Code' }).click();
  await expect(page.getByTestId('code-editor')).toBeVisible();
  await expect(page.getByTestId('compile-status')).toContainText('Brain compiles');
  // edit the code: add a timer reset at the top of update()
  const text = await page.locator('.cm-content').innerText();
  expect(text).toContain('function update() {');
  await page.getByText('function update() {').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('\ndrone.resetTimer("probe");');
  await page.waitForTimeout(600);
  // the same program, as nodes and as blocks
  await editor.getByRole('radio', { name: 'Nodes' }).click();
  await expect(page.getByTestId('node-editor')).toBeVisible();
  await expect(page.locator('.bn').filter({ has: page.locator('input[value="drone.resetTimer"]') })).toHaveCount(1);
  await editor.getByRole('radio', { name: 'Blocks' }).click();
  await expect(page.getByTestId('block-editor')).toBeVisible();
  await expect(page.locator('.blocklyDraggable .blocklyText', { hasText: 'drone.resetTimer' })).toHaveCount(1);
  // insert from the drawer in blocks: the code view shows it
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByLabel('Search insertable items').fill('stop');
  await page.getByRole('complementary', { name: 'Insert' }).getByRole('button', { name: /^stop/ }).first().click();
  await expect(page.getByRole('complementary', { name: 'Insert' }).getByRole('status')).toContainText('Inserted');
  await page.getByRole('button', { name: 'Close Insert' }).click();
  await editor.getByRole('radio', { name: 'Code' }).click();
  await expect(page.locator('.cm-content')).toContainText('drone.resetTimer("probe");');
  // switching views never created another program
  await page.waitForTimeout(500);
  expect(await storedBrains(page)).toBe(brains);
  // a syntax error is a draft: diagnostics, and the brain keeps its last valid version
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\nfunction broken( {\n');
  await expect(page.getByTestId('compile-status')).toContainText('problem');
  await expect(page.getByRole('status').filter({ hasText: 'Unfinished' })).toBeVisible();
  await editor.getByRole('radio', { name: 'Nodes' }).click();
  await expect(page.getByTestId('compile-status')).toContainText('Brain compiles');
  await editor.getByRole('radio', { name: 'Code' }).click();
  // CodeMirror renders only visible lines: go to the end first
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await expect(page.locator('.cm-content')).toContainText('function broken(');
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await expect(page.locator('.cm-content')).not.toContainText('function broken(');
});

test('simulate: transport controls, spectating, events, and the trace opens the brain', async ({ page }) => {
  await go(page, 'Simulate');
  const controls = page.getByTestId('sim-controls');
  await expect(page.getByTestId('sim-clock')).toContainText('0.00');
  await controls.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(800);
  await controls.getByRole('button', { name: 'Pause' }).click();
  const t1 = await clock(page);
  expect(t1).toBeGreaterThan(0.2);
  await page.waitForTimeout(400);
  expect(await clock(page)).toBe(t1);
  const tick = async () => Number((await page.getByTestId('sim-tick').textContent())!.replace(/\D/g, ''));
  const k1 = await tick();
  await controls.getByRole('button', { name: 'Step tick' }).click();
  await expect.poll(tick).toBe(k1 + 1);
  await controls.getByRole('button', { name: 'Step decision' }).click();
  await expect.poll(async () => (await tick()) % 6).toBe(1);
  await controls.getByRole('button', { name: 'Restart' }).click();
  await expect(page.getByTestId('sim-clock')).toContainText('0.00');
  await controls.getByRole('radio', { name: '4×' }).click();
  await controls.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(900);
  await controls.getByRole('button', { name: 'Pause' }).click();
  expect(await clock(page)).toBeGreaterThan(1.5);
  // spectate
  await page.getByTestId('drone-list').getByRole('button', { name: /Assault Platform/ }).click();
  await expect(page.getByTestId('inspected-name')).toContainText('Assault Platform');
  await expect(page.getByTestId('weapons-table')).toContainText('F.H1');
  await expect(page.getByTestId('trace-entries')).toContainText('nearestEnemy()');
  // events drawer
  await page.getByRole('button', { name: /^Events/ }).click();
  await expect(page.locator('.tl-list')).toBeVisible();
  await page.getByRole('button', { name: /^Events/ }).click();
  // a trace entry opens the same brain at that logic
  await page.getByTestId('trace-entries').getByRole('button', { name: /Show line/ }).first().click();
  await expect(page.getByTestId('programs')).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Editor' }).getByRole('radio', { name: 'Code' }).click();
  await expect(page.locator('.cm-trace-line')).toHaveCount(1);
  // back on the field, freecam closes the spectator
  await go(page, 'Simulate');
  await page.getByRole('button', { name: 'Freecam' }).click();
  await expect(page.getByTestId('inspector')).toHaveCount(0);
});

test('deployment is blocked by a brain that does nothing, and explains why', async ({ page }) => {
  await page.getByTestId('drone-switcher').click();
  await page.getByRole('button', { name: 'New drone' }).click();
  await go(page, 'Program');
  await page.getByRole('radiogroup', { name: 'Editor' }).getByRole('radio', { name: 'Code' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('// nothing here yet\n');
  await expect(page.getByTestId('compile-status')).toContainText('1 problem');
  await expect(page.getByRole('button', { name: 'Test' })).toBeDisabled();
  await go(page, 'Simulate');
  await page.getByTestId('scenario-button').click();
  await page.getByLabel('Drone 1', { exact: true }).selectOption({ label: 'New drone' });
  await expect(page.getByTestId('roster-0')).toContainText('does nothing');
  await expect(page.getByRole('button', { name: 'Deploy' })).toBeDisabled();
  await page.getByLabel('Drone 1', { exact: true }).selectOption({ label: 'Skirmisher' });
  await expect(page.getByRole('button', { name: 'Deploy' })).toBeEnabled();
  await page.getByRole('button', { name: 'Deploy' }).click();
  await expect(page.getByTestId('drone-list')).toContainText('Skirmisher');
});


test('construct: hardpoint layouts relocate parts, ask before removing any, and undo restores', async ({ page }) => {
  await go(page, 'Construct');
  await page.getByTestId('section-front').click();
  // Assault Platform front: two heavy cannons on a heavy Maximum section; Medium has one large mount
  await expect(page.getByTestId('layout-pick-front').getByTestId('layout-max')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('layout-pick-front').getByTestId('layout-medium').click();
  const confirm = page.getByTestId('layout-confirm');
  await expect(confirm).toContainText('Heavy Cannon');
  await confirm.getByRole('button', { name: 'Keep current' }).click();
  await expect(page.getByTestId('layout-pick-front').getByTestId('layout-max')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('layout-pick-front').getByTestId('layout-medium').click();
  await page.getByTestId('layout-confirm').getByRole('button', { name: /Change and remove/ }).click();
  await expect(page.getByTestId('layout-pick-front').getByTestId('layout-medium')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('slot-F.H1')).toHaveAttribute('aria-label', /Heavy Cannon/);
  // undo brings the second cannon back
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('notice')).toContainText('front section');
  await expect(page.getByTestId('layout-pick-front').getByTestId('layout-max')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('slot-F.H2')).toHaveAttribute('aria-label', /Heavy Cannon/);
  // engineering diagnostics come from the design data
  await page.getByTestId('diagnostics-toggle').click();
  await expect(page.getByTestId('diagnostics')).toContainText('Rated mass on this chassis');
  await expect(page.getByTestId('diagnostics')).toContainText('Recoil and mounts');
  await page.getByTestId('diagnostics-toggle').click();
  // a mount setting: the rocket cassette's interceptor split on an empty bay
  await page.getByTestId('slot-F.H3').click();
  await page.getByTestId('move-part').click();
  await expect(page.locator('.hint')).toContainText('Moving Optical Camera');
  await page.getByRole('radio', { name: 'Internal bays' }).click();
  await page.getByRole('radio', { name: 'Hardpoints' }).click();
  await page.getByTestId('slot-M.H3').click();
  // M.H3 holds the radar; the heavy Maximum F.H3 mount is medium-size, so the two swap
  await expect(page.getByTestId('notice')).toContainText('Swapped');
  await expect(page.getByTestId('slot-F.H3')).toHaveAttribute('aria-label', /Search Radar/);
  await expect(page.getByTestId('slot-M.H3')).toHaveAttribute('aria-label', /Optical Camera/);
  // and a part that cannot fit back is refused with a reason: the heavy cannon onto a medium mount
  await page.getByTestId('slot-F.H1').click();
  await page.getByTestId('move-part').click();
  await page.getByTestId('slot-M.H1').click();
  await expect(page.getByTestId('notice')).toContainText('does not fit');
});

test('simulate: a training course deploys with its targets, objective and goal', async ({ page }) => {
  await go(page, 'Simulate');
  await page.getByTestId('scenario-button').click();
  await page.getByTestId('course').selectOption('maze');
  await expect(page.getByTestId('course-brief')).toContainText('reach the goal');
  await page.getByLabel('Drone 1', { exact: true }).selectOption({ label: 'Pathfinder' });
  await page.getByRole('button', { name: 'Remove drone 2' }).click();
  await page.getByRole('button', { name: 'Deploy' }).click();
  await expect(page.getByTestId('drone-list')).toContainText('Pathfinder');
  const controls = page.getByTestId('sim-controls');
  await controls.getByRole('radio', { name: '8×' }).click();
  await controls.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(1500);
  await controls.getByRole('button', { name: 'Pause' }).click();
  expect(await clock(page)).toBeGreaterThan(3);
  // the weapon range has built-in targets on the other team
  await page.getByTestId('scenario-button').click();
  await page.getByTestId('course').selectOption('range');
  await page.getByRole('button', { name: 'Deploy' }).click();
  await expect(page.getByTestId('drone-list')).toContainText('Target 4');
});

test.describe('touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('every workspace is usable by touch', async ({ page }) => {
    await go(page, 'Construct');
    await page.getByTestId('slot-F.H1').tap();
    await expect(page.getByTestId('properties')).toBeVisible();
    await page.getByRole('button', { name: 'Close properties' }).tap();
    await expect(page.getByTestId('properties')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await go(page, 'Program');
    await page.getByRole('radiogroup', { name: 'Editor' }).getByRole('radio', { name: 'Code' }).tap();
    await expect(page.getByRole('toolbar', { name: 'Programming symbols' })).toBeVisible();
    await page.getByRole('button', { name: 'Insert', exact: true }).tap();
    await expect(page.getByRole('complementary', { name: 'Insert' })).toBeVisible();
    // the editor stays visible above the sheet
    const sheet = (await page.getByRole('complementary', { name: 'Insert' }).boundingBox())!;
    expect(sheet.y).toBeGreaterThan(200);
    await page.getByRole('button', { name: 'Close Insert' }).tap();
    await go(page, 'Simulate');
    await page.getByTestId('sim-controls').getByRole('button', { name: 'Play' }).tap();
    await page.waitForTimeout(600);
    await page.getByTestId('drone-list').getByRole('button', { name: /Assault Platform/ }).tap();
    await expect(page.getByTestId('inspected-name')).toBeVisible();
    // previous / next drone and the sheet sizes
    await page.getByRole('button', { name: 'Next drone' }).tap();
    await expect(page.getByTestId('inspected-name')).toContainText('AA Destroyer');
    await page.getByTestId('sheet-grab').tap();
    await expect(page.getByTestId('inspector')).toHaveAttribute('data-sheet', /full|peek|half/);
    await page.getByRole('button', { name: 'Close diagnostics' }).tap();
    await expect(page.getByTestId('inspector')).toHaveCount(0);
  });

  test('a part can be moved to another slot by touch, and the drone stays visible', async ({ page }) => {
    await go(page, 'Construct');
    await page.getByTestId('slot-M.H1').tap();
    await page.getByTestId('move-part').tap();
    await expect(page.locator('.hint')).toContainText('Moving');
    // the tray folds away while moving so the stage keeps its height
    const stage = (await page.locator('.stage').boundingBox())!;
    expect(stage.height).toBeGreaterThan(250);
    await page.getByTestId('slot-M.H2').tap();
    await expect(page.getByTestId('notice')).toContainText('Swapped');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
