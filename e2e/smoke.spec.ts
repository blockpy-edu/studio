import { expect, test } from '@playwright/test';

test('dev harness mounts the app shell from the BootConfig JSON block', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'BlockPy Studio' })).toBeVisible();
  await expect(page.getByText('Dev Student (learner)')).toBeVisible();
});
