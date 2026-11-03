import { expect, test, type Page } from '@playwright/test';

const tab = (page: Page, name: string) => page.getByRole('tablist').first().getByRole('tab', { name, exact: true });
const clock = async (page: Page) => Number((await page.getByTestId('sim-clock').textContent())!.match(/[\d.]+/)![0]);

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto('/');
  await expect(page.getByTestId('battle')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
});

test('construction editor: section classes, mounting, rotation and validation are functional', async ({ page }) => {
  await tab(page, 'Hangar').click();
  const hangar = page.getByTestId('hangar');
  await hangar.getByRole('button', { name: 'New', exact: true }).click();
  await expect(hangar.getByLabel('Design name')).toHaveValue('New Drone');
  const checks = () => page.getByRole('tab', { name: /Checks/ }).click();
  // An empty design cannot run a program: shown on the canvas and in Checks.
  await expect(page.getByRole('list', { name: 'Construction problems' })).toContainText('No control unit');
  await checks();
  await expect(page.getByTestId('issues')).toContainText('No control unit');
  const mass0 = await page.getByTestId('stat-mass').textContent();
  // Select the front section on the rail and make it heavy: mass changes.
  await page.getByTestId('section-front').click();
  await page.getByRole('group', { name: 'front class' }).getByRole('button', { name: /Heavy/ }).click();
  await expect(page.getByTestId('stat-mass')).not.toHaveText(mass0!);
  // Mount a heavy cannon on F.H1 and rotate it.
  await page.getByTestId('slot-F.H1').click();
  await page.getByTestId('slot-editor').getByRole('button', { name: 'Heavy Cannon', exact: true }).click();
  await expect(page.getByTestId('mount-rotation')).toHaveText('0°');
  await page.getByRole('button', { name: 'Rotate right' }).click();
  await expect(page.getByTestId('mount-rotation')).toHaveText('45°');
  // Library placement: arm a part, see the hint, click a highlighted slot.
  await page.getByRole('region', { name: 'Equipment library' }).getByRole('button', { name: 'Machine Gun', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Placing Machine Gun');
  await page.getByTestId('slot-F.H2').click();
  await expect(page.getByTestId('slot-F.H2')).toHaveAttribute('aria-label', /Machine Gun/);
  // Escape cancels an armed part.
  await page.getByRole('region', { name: 'Equipment library' }).getByRole('button', { name: 'Optical Camera', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status')).toHaveCount(0);
  // Install a controller in an internal bay: the error disappears.
  await hangar.getByRole('button', { name: 'Internal' }).click();
  await page.getByTestId('slot-M.I1').click();
  await page.getByTestId('slot-editor').getByRole('button', { name: 'Control Unit', exact: true }).click();
  await checks();
  await expect(page.getByTestId('issues')).not.toContainText('No control unit');
  // Armor beyond class capacity is impossible via the slider; armor changes mass.
  const mass1 = await page.getByTestId('stat-mass').textContent();
  await page.getByTestId('section-front').click();
  await page.getByLabel('front armor').fill('60');
  await expect(page.getByTestId('stat-mass')).not.toHaveText(mass1!);
  // Persisted across reload.
  await page.waitForTimeout(400);
  await page.reload();
  await tab(page, 'Hangar').click();
  await expect(page.getByRole('option', { name: /New Drone/ })).toBeVisible();
});

test('programming interfaces: code, block and node editors compile real programs', async ({ page }) => {
  await tab(page, 'Programs').click();
  const programs = page.getByTestId('programs');
  // Code
  await programs.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.getByTestId('code-editor')).toBeVisible();
  await expect(page.getByTestId('compile-status')).toContainText('Compiles');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\nclass Broken {}\n');
  await expect(page.getByTestId('compile-status')).toContainText('classes are not available');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('compile-status')).toContainText('Compiles');
  // The side palette inserts real API calls at the cursor.
  await page.getByRole('region', { name: 'Insert API call' }).getByRole('button', { name: 'nearestEnemy', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('drone.nearestEnemy()');
  // The inspector resizes from the keyboard.
  const insp = page.getByRole('complementary', { name: 'Program inspector' });
  const w0 = (await insp.boundingBox())!.width;
  await page.getByRole('button', { name: 'Resize program inspector' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await insp.boundingBox())!.width).toBeGreaterThan(w0 + 10);
  // Blocks
  await page.getByRole('option', { name: /AA Orbit/ }).click();
  await expect(page.getByTestId('block-editor')).toBeVisible();
  await expect(page.locator('.blocklyDraggable').first()).toBeVisible();
  expect(await page.locator('.blocklyDraggable').count()).toBeGreaterThan(20);
  await expect(page.getByTestId('compile-status')).toContainText('Compiles');
  await programs.getByRole('radio', { name: 'AutoScript' }).click();
  await expect(page.locator('.cm-content')).toContainText('function update()');
  await programs.getByRole('radio', { name: 'Blocks' }).click();
  await expect(page.getByTestId('block-editor')).toBeVisible();
  // Nodes: adding a node from the palette changes the graph.
  await page.getByRole('option', { name: /Brawler/ }).click();
  await expect(page.getByTestId('node-editor')).toBeVisible();
  const before = await page.locator('.gnode').count();
  await page.getByTestId('node-palette').getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.gnode')).toHaveCount(before + 1);
  await expect(page.getByTestId('compile-status')).toContainText('Compiles');
  // Convert node program to code: a new, compiling code program.
  await programs.getByRole('button', { name: 'Convert to code' }).click();
  await expect(page.getByTestId('code-editor')).toBeVisible();
  await expect(page.getByTestId('compile-status')).toContainText('Compiles');
});

test('battle controls: play, pause, step, restart, speed and spectating', async ({ page }) => {
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
  await expect.poll(tick).toBeGreaterThan(k1 + 1);
  await expect.poll(async () => (await tick()) % 6).toBe(1);
  await controls.getByRole('button', { name: 'Restart' }).click();
  await expect(page.getByTestId('sim-clock')).toContainText('0.00');
  await controls.getByRole('radio', { name: '4×' }).click();
  await expect(controls.getByRole('radio', { name: '4×' })).toHaveAttribute('aria-checked', 'true');
  await controls.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(800);
  await controls.getByRole('button', { name: 'Pause' }).click();
  expect(await clock(page)).toBeGreaterThan(1.5);
  // Spectate a drone: inspector shows its live state and program trace.
  await page.getByTestId('drone-list').getByText('Assault Platform').click();
  await expect(page.getByTestId('inspected-name')).toContainText('Assault Platform');
  await expect(page.getByTestId('weapons-table')).toContainText('F.H1');
  await page.getByTestId('inspector').getByRole('tab', { name: 'Program' }).click();
  await expect(page.getByTestId('trace-entries')).toContainText('nearestEnemy()');
  await page.getByTestId('trace-entries').locator('.trace-entry').first().click();
  await page.getByRole('button', { name: 'Show in editor' }).click();
  await expect(page.getByTestId('programs')).toBeVisible();
  await expect(page.locator('.cm-trace-line')).toHaveCount(1);
  // Back to freecam
  await tab(page, 'Battle').click();
  await expect(page.getByText('Spectating Assault Platform')).toBeVisible();
  await page.getByRole('button', { name: 'Freecam' }).click();
  await expect(page.getByTestId('inspector')).toContainText('Click a drone');
  // Panels collapse to give the battlefield the space.
  const canvas = page.getByTestId('battle-canvas');
  const cw0 = (await canvas.boundingBox())!.width;
  await controls.getByRole('button', { name: 'Roster' }).click();
  await controls.getByRole('button', { name: 'Debugger' }).click();
  await expect(page.getByTestId('drone-list')).toBeHidden();
  await expect(page.getByTestId('inspector')).toHaveCount(0);
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(cw0 + 400);
  // The event timeline is collapsible.
  await controls.getByRole('button', { name: 'Timeline' }).click();
  await expect(page.locator('.timeline-body')).toBeVisible();
  await controls.getByRole('button', { name: 'Timeline' }).click();
  await expect(page.locator('.timeline-body')).toHaveCount(0);
});

test('deployment is blocked for invalid designs', async ({ page }) => {
  await tab(page, 'Hangar').click();
  await page.getByTestId('hangar').getByRole('button', { name: 'New', exact: true }).click();
  await tab(page, 'Battle').click();
  await page.getByRole('tab', { name: 'Scenario' }).click();
  await page.getByLabel('Design 1').selectOption({ label: 'New Drone' });
  await expect(page.getByTestId('roster-0')).toContainText('construction errors');
  await expect(page.getByRole('button', { name: 'Deploy' })).toBeDisabled();
  await page.getByLabel('Design 1').selectOption({ label: 'Skirmisher' });
  await page.getByLabel('Program 1').selectOption({ label: 'Brawler (nodes) · nodes' });
  await expect(page.getByRole('button', { name: 'Deploy' })).toBeEnabled();
  await page.getByRole('button', { name: 'Deploy' }).click();
  await expect(page.getByTestId('drone-list')).toContainText('Skirmisher');
});
