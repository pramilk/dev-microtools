import { test, expect } from '@playwright/test';
import { gotoTool, widget, expectCopies } from './support/toolPage';

test.describe('Phishing Email Checker', () => {
  test('flags the example email, copies the report and clears', async ({ page }) => {
    await gotoTool(page, 'phishing-email-checker');
    const tool = widget(page);

    await tool.getByRole('button', { name: /load example/i }).click();
    await expect(tool.getByText(/strong phishing signals/i)).toBeVisible();
    await expect(tool.getByText(/claims to be paypal/i)).toBeVisible();
    await expect(tool.getByText('SPF failed')).toBeVisible();

    await expectCopies(page, tool.getByTitle(/copy phishing check report/i), 'risk score 100/100');

    await tool.getByRole('button', { name: /^clear$/i }).click();
    await expect(tool.getByLabel(/email source/i)).toHaveValue('');
  });

  test('analyses pasted text and gives a cautious low-risk result', async ({ page }) => {
    await gotoTool(page, 'phishing-email-checker');
    const tool = widget(page);

    await tool.getByLabel(/email source/i).fill('From: Jane <jane@acme.com>\nSubject: Lunch?\nMessage-ID: <1@acme.com>\n\nFree Thursday?');
    await expect(tool.getByText(/no strong phishing signals/i)).toBeVisible();
    await expect(tool.getByText(/not a guarantee/i)).toBeVisible();
  });

  test('shows how to get the raw email from Gmail and Outlook', async ({ page }) => {
    await gotoTool(page, 'phishing-email-checker');
    const tool = widget(page);

    // Collapsed by default; the summary opens it.
    await expect(tool.getByText(/show original/i)).toBeHidden();
    await tool.getByText(/how do i get the raw email/i).click();
    await expect(tool.getByText(/show original/i)).toBeVisible();
    await expect(tool.getByText(/view message source/i)).toBeVisible();
    await expect(tool.getByText(/internet headers/i).first()).toBeVisible();
  });
});
