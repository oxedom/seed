import { expect, test } from '@playwright/test';

test('bootstrap UI and settings flow render', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/seed/);
  await expect(page.locator('#stage')).toContainText('seed');
  await expect(page.locator('#bp-prompt')).toBeVisible();
  await expect(page.locator('#control-modal')).toBeVisible();
  await expect(page.locator('#cm-config')).toBeVisible();
  await expect(page.locator('#cm-reset')).toBeVisible();

  await page.click('#cm-config');
  await expect(page.locator('#settings-modal')).toBeVisible();
  await expect(page.locator('#anthropic-key')).toBeVisible();
  await expect(page.locator('#anthropic-model')).toHaveValue('claude-opus-4-7');

  await page.selectOption('#provider-kind', 'openai-compat');
  await expect(page.locator('#oac-base')).toBeVisible();
  await page.fill('#oac-model', 'ci-smoke-model');
  await page.click('#settings-save');
  await expect(page.locator('#settings-modal')).toHaveClass(/hidden/);

  const config = await page.evaluate(() => JSON.parse(localStorage.getItem('seed_config_v1')));
  expect(config.kind).toBe('openai-compat');
  expect(config.openaiCompat.model).toBe('ci-smoke-model');

  await page.click('#cm-reset');
  await expect(page.locator('#bp-prompt')).toBeVisible();
  await expect(page.locator('#stage')).toContainText('seed');
});
