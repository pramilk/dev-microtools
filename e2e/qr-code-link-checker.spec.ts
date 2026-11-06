import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

// A 100x100 plain white PNG: a valid image that contains no QR code.
const BLANK_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAYUlEQVR4nO3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4G8CmgABzVkL4wAAAABJRU5ErkJggg==';

test.describe('QR Code Link Checker', () => {
  test('flags a dynamic-QR link, compares to the expected address, copies and clears', async ({ page }) => {
    await gotoTool(page, 'qr-code-link-checker');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByText('Goes through a middleman first')).toBeVisible();
    await expect(tool.getByText(/does not match/i)).toBeVisible();

    await expectCopies(page, tool.getByTitle(/copy decoded qr code contents/i), 'https://qrco.de/bgK4mP');

    await tool.getByRole('button', { name: /^clear$/i }).click();
    await expect(tool.getByLabel(/qr code contents/i)).toHaveValue('');
  });

  test('recognises a plain address as direct', async ({ page }) => {
    await gotoTool(page, 'qr-code-link-checker');
    const tool = widget(page);

    await tool.getByLabel(/qr code contents/i).fill('https://example.com/menu');
    await expect(tool.getByText('Goes directly to this address')).toBeVisible();
  });

  test('reads a QR code out of an uploaded image', async ({ page }) => {
    // Render a real QR code with the sibling generator tool, screenshot it, then feed the
    // PNG to the checker — exercises canvas + jsQR in a real browser.
    await gotoTool(page, 'qr-code-generator');
    // The generator renders its preview asynchronously and replaces the <svg> node on every
    // regeneration, so a handle to the <svg> itself can detach mid-screenshot. Screenshot the
    // wrapper (which persists) and wait for the preview to settle on the new text first.
    const image = widget(page).locator('.qr-preview__image');
    await expect(image.locator('svg')).toBeVisible();
    const initialSvg = await image.innerHTML();
    await widget(page).locator('textarea, input[type="text"]').first().fill('https://bit.ly/3abc12');
    await expect.poll(() => image.innerHTML()).not.toBe(initialSvg);
    // Let any trailing re-render finish: the markup must be identical across two reads.
    let previous = '';
    await expect
      .poll(async () => {
        const current = await image.innerHTML();
        const stable = current === previous;
        previous = current;
        return stable;
      })
      .toBe(true);
    const png = await image.screenshot({ type: 'png' });

    await gotoTool(page, 'qr-code-link-checker');
    const tool = widget(page);
    await tool.getByLabel(/choose an image containing a qr code/i).setInputFiles({
      name: 'code.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await expect(tool.getByAltText(/uploaded qr code/i)).toBeVisible();
    await expect(tool.getByLabel(/qr code contents/i)).toHaveValue('https://bit.ly/3abc12');
    await expect(tool.getByText('Goes through a middleman first')).toBeVisible();
  });

  test('shows a visible error when the image has no QR code', async ({ page }) => {
    await gotoTool(page, 'qr-code-link-checker');
    const tool = widget(page);
    await tool.getByLabel(/choose an image containing a qr code/i).setInputFiles({
      name: 'blank.png',
      mimeType: 'image/png',
      buffer: Buffer.from(BLANK_PNG, 'base64'),
    });
    await expect(tool.getByRole('alert')).toBeVisible();
  });
});
