import { expect, test } from '@playwright/test';

for (const input of ['hover', 'focus', 'none'] as const) {
  test(`selective hydration order with ${input === 'none' ? 'no input' : input}`, async ({
    page,
  }) => {
    const errors: Array<string> = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });

    const response = await page.goto('/');
    expect(await response?.text()).toContain('<p>Rendered on the server</p>');

    const previews = ['A', 'B'].map((name) =>
      page.getByRole('region', { name: `Preview ${name}` }),
    );
    const originalNodes = await Promise.all(previews.map((preview) => preview.elementHandle()));
    await page.getByRole('button', { name: 'Edit title' }).click();
    await expect(page.locator('#live-title')).toHaveText('Edited in the browser');

    if (input === 'hover') {
      await previews[1].hover();
    } else if (input === 'focus') {
      await previews[1].focus();
    }

    for (const preview of previews) {
      await expect(preview.getByText('Rendered on the server')).toBeVisible();
    }

    // Release both boundaries without moving the pointer or changing focus.
    await page.getByRole('button', { name: 'Resolve previews' }).dispatchEvent('click');
    const expectedOrder = input === 'none' ? 'A, B' : 'B, A';
    await expect(page.locator('#hydration-order')).toHaveText(expectedOrder);
    for (const [index, preview] of previews.entries()) {
      await expect(preview.getByText('Edited in the browser')).toBeVisible();
      expect(
        await preview.evaluate((node, original) => node === original, originalNodes[index]),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}
