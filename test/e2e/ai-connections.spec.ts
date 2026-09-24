import { expect, test } from '@playwright/test';

test('adds, edits, reloads, and removes an OpenAI-compatible connection', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const suffix = Math.random().toString(36).slice(2, 8);
  const apiKey = `e2e-provider-key-${suffix}`;
  const row = page.locator('.table tbody tr').filter({ hasText: suffix.slice(-4) });

  const connectionsLoaded = page.waitForResponse((response) =>
    response.request().method() === 'GET' &&
    response.url().endsWith('/api/ai/connections') &&
    response.ok()
  );
  await page.goto('/ai');
  await connectionsLoaded;
  await expect(page.getByRole('heading', { name: 'AI', exact: true })).toBeVisible();
  const closeTour = page.getByRole('button', { name: 'Close tour' });
  await expect(closeTour).toBeVisible();
  await closeTour.click();

  try {
    await page.getByRole('button', { name: '+ Add key' }).click();
    await page.getByPlaceholder('API key').fill(apiKey);
    await page.getByPlaceholder('Base URL (optional) — https://api.openai.com/v1')
      .fill('https://openrouter.ai/api/v1');
    await page.getByPlaceholder('Model name required for this provider').fill(`e2e/model-${suffix}`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(row).toContainText('OpenAI / compatible');
    await expect(row).toContainText(`••••••${apiKey.slice(-4)}`);

    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByLabel('Base URL')).toHaveValue('https://openrouter.ai/api/v1');
    await expect(page.getByLabel('Model (optional)')).toHaveValue(`e2e/model-${suffix}`);

    await page.getByLabel('Base URL').fill('https://api.groq.com/openai/v1');
    await page.locator('.edit-row').getByRole('button', { name: 'Save changes' }).click();
    await page.reload();
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByLabel('Base URL')).toHaveValue('https://api.groq.com/openai/v1');

    await page.locator('.edit-row').getByRole('button', { name: 'Cancel' }).click();
    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(row).toHaveCount(0);
  } finally {
    if (!page.isClosed() && await row.count()) {
      await row.getByRole('button', { name: 'Remove' }).click().catch(() => {});
    }
  }
});
