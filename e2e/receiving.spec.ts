import { expect, test, type Page } from '@playwright/test';

// The seeded users (spec §3.4); their passwords come from the repository's .env, like the stack's seed.
const USERS = { supervisor: 'SEED_SUPERVISOR_PASSWORD', operator: 'SEED_OPERATOR_PASSWORD' } as const;

async function logIn(page: Page, username: keyof typeof USERS) {
  const password = process.env[USERS[username]];
  if (!password) throw new Error(`${USERS[username]} is not set: put the password the stack was seeded with in the repository's .env`);
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/receiving$/); // AC-01.1
}

async function logOut(page: Page) {
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

// From the document list, newest first, to the document's page (NFR-06: one click).
async function openDocument(page: Page, documentNumber: string) {
  await page.getByRole('link', { name: documentNumber, exact: true }).click();
  await expect(page.getByRole('heading', { name: documentNumber, exact: true })).toBeVisible();
}

// A Mantine Select searched on the server: type, wait for the option, pick it. Its option list carries the same
// label as the input, hence the textbox role.
async function pickProduct(page: Page, label: string, sku: string) {
  await page.getByRole('textbox', { name: label, exact: true }).fill(sku);
  await page.getByRole('option', { name: new RegExp(`^${sku} — `) }).click();
}

async function receive(page: Page, sku: string, quantity: number) {
  await page.getByLabel(`Quantity to receive for ${sku}`).fill(String(quantity));
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  await expect(page.getByText(`Received ${quantity} CTN of ${sku}`)).toBeVisible();
}

// The document's status badge; the status words also appear as header labels ("Completed"), so match the badge.
const statusBadge = (page: Page, label: string) => page.locator('.mantine-Badge-root').filter({ hasText: new RegExp(`^${label}$`) });

const cells = (page: Page, sku: string) => page.getByRole('table', { name: 'Lines' }).getByRole('row', { name: new RegExp(sku) }).getByRole('cell');

test('T-E2E-01 US-03 → US-06 a supervisor creates and opens a document, an operator receives it in two counts, the supervisor completes it; inventory and history show the totals', async ({ page }) => {
  // A new product per run, so the run repeats on the same stack and the totals below are this run's only.
  const sku = `E2E-${Date.now()}`;

  // US-03 (FR-11, FR-12): the supervisor creates the product, which starts with 0 on hand.
  await logIn(page, 'supervisor');
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await page.getByRole('button', { name: 'New product' }).click();
  const dialog = page.getByRole('dialog', { name: 'New product' });
  await dialog.getByLabel('SKU').fill(sku);
  await dialog.getByLabel('Name').fill(`E2E product ${sku}`);
  await dialog.getByLabel('Unit of measure').fill('CTN');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(`Product ${sku} created`)).toBeVisible();

  // US-04 (FR-21, FR-22, FR-27): a draft with one line of 10, then opened for receiving.
  await page.getByRole('link', { name: 'Receiving', exact: true }).click();
  await page.getByRole('link', { name: 'New document' }).click();
  await page.getByLabel('Supplier name').fill('E2E Supplier');
  await page.getByRole('button', { name: 'Add line' }).click();
  await pickProduct(page, 'Product for line 1', sku);
  await page.getByLabel('Expected quantity for line 1').fill('10');
  await page.getByRole('button', { name: 'Create draft' }).click();
  const heading = page.getByRole('heading', { level: 2, name: /^RCV-\d{4}-\d{6,}$/ });
  const documentNumber = (await heading.textContent())!;
  await expect(statusBadge(page, 'Draft')).toBeVisible();
  await page.getByRole('button', { name: 'Open for receiving' }).click();
  await expect(statusBadge(page, 'Open')).toBeVisible();
  await logOut(page);

  // US-05 (FR-31, FR-32): the operator receives 4, then the remaining 6.
  await logIn(page, 'operator');
  await openDocument(page, documentNumber);
  await receive(page, sku, 4);
  await expect(statusBadge(page, 'In progress')).toBeVisible();
  await expect(cells(page, sku).nth(4)).toHaveText('4'); // received
  await expect(cells(page, sku).nth(5)).toHaveText('6'); // remaining
  await receive(page, sku, 6);
  await expect(cells(page, sku).nth(4)).toHaveText('10');
  await expect(cells(page, sku).nth(5)).toHaveText('0');
  await expect(statusBadge(page, 'Fully received')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete' })).toHaveCount(0); // FR-04: not an operator action
  await logOut(page);

  // US-05 (FR-28): the supervisor completes the document.
  await logIn(page, 'supervisor');
  await openDocument(page, documentNumber);
  await page.getByRole('button', { name: 'Complete' }).click();
  await expect(statusBadge(page, 'Completed')).toBeVisible();

  // US-06 (FR-40): on hand is the sum of both receipts.
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await page.getByPlaceholder('Search SKU or name').fill(sku);
  const balance = page.getByRole('row', { name: new RegExp(sku) });
  await expect(balance).toHaveCount(1);
  await expect(balance.getByRole('cell').nth(3)).toHaveText('10');

  // US-06 (FR-41): the ledger, newest first: +6 leaving 10, then +4 leaving 4, both on this document.
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  await pickProduct(page, 'Product', sku);
  const rows = page.getByRole('row', { name: new RegExp(sku) });
  await expect(rows).toHaveCount(2);
  for (const [index, change, after] of [[0, '+6', '10'], [1, '+4', '4']] as const) {
    const row = rows.nth(index).getByRole('cell');
    await expect(row.nth(3)).toHaveText('Receipt');
    await expect(row.nth(4)).toHaveText(change);
    await expect(row.nth(5)).toHaveText(after);
    await expect(row.nth(6)).toHaveText(documentNumber);
  }
});

test('T-E2E-02 AC-02.5 an operator does not see "New product"', async ({ page }) => {
  await logIn(page, 'operator');
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
  await expect(page.getByRole('row').nth(1)).toBeVisible(); // the list has loaded
  await expect(page.getByRole('button', { name: 'New product' })).toHaveCount(0);
});
