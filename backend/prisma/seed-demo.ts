// Demo data for trying the app by hand (D-27): receiving documents in every status, with receipts and one
// reversal. Everything goes through the running API (API_URL, default http://localhost:3000) as the seeded
// supervisor and operator, so every rule is checked and stock changes only in ReceiptsService (spec §5).
// Run after `npm run seed`, with the API up: `npm run seed:demo`. Skips when any document exists.
// Like seed.ts: erasable TypeScript only, run by Node's type stripping (D-02).

const API = `${process.env.API_URL ?? 'http://localhost:3000'}/api/v1`;

// Response bodies are untyped JSON from our own API (a third-party boundary for this standalone script).
type Json = any;

function fail(message: string): never {
  throw new Error(message);
}

async function call(token: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Json> {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((e: Error) => fail(`cannot reach the API at ${API} (${e.message}): is it running? Set API_URL if it is elsewhere`));
  // Read as text first, so an HTML error page from a wrong host or port still reports its status.
  const text = await res.text();
  if (!res.ok) fail(`${method} ${path} → ${res.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

async function main(): Promise<void> {
  const login = async (username: string, passwordVar: string) =>
    (await call(null, 'POST', '/auth/login', { username, password: process.env[passwordVar] || fail(`${passwordVar} is not set`) })).accessToken as string;
  const supervisor = await login('supervisor', 'SEED_SUPERVISOR_PASSWORD');
  const operator = await login('operator', 'SEED_OPERATOR_PASSWORD');

  if ((await call(supervisor, 'GET', '/receiving-documents?pageSize=1')).meta.totalItems > 0) {
    console.log('Demo data skipped: receiving documents already exist (start over with `docker compose down -v`)');
    return;
  }

  const products: { id: string; sku: string }[] = (await call(supervisor, 'GET', '/products?pageSize=100')).data;
  const productId = (sku: string) => products.find((p) => p.sku === sku)?.id ?? fail(`Product ${sku} not found: run \`npm run seed\` first`);
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  const create = (supplierName: string, referenceNumber: string, expectedDate: string, lines: [string, number][], notes?: string) =>
    call(supervisor, 'POST', '/receiving-documents', {
      supplierName,
      referenceNumber,
      expectedDate,
      notes,
      items: lines.map(([sku, expectedQuantity]) => ({ productId: productId(sku), expectedQuantity })),
    });
  const act = (doc: Json, action: string, reason?: string) =>
    call(supervisor, 'POST', `/receiving-documents/${doc.id}/${action}`, reason ? { reason } : undefined);
  const receive = async (doc: Json, sku: string, quantity: number) => {
    const line = doc.items.find((i: Json) => i.product.sku === sku) ?? fail(`${sku} is not a line of ${doc.documentNumber}`);
    return (await call(operator, 'POST', `/receiving-documents/${doc.id}/items/${line.id}/receipts`, { quantity }, { 'Idempotency-Key': crypto.randomUUID() })).receipt;
  };
  const opened = async (...args: Parameters<typeof create>) => act(await create(...args), 'open');

  // COMPLETED: everything arrived, received in two counts for the chicken, then signed off.
  const completed = await opened('PT Sumber Beku Nusantara', 'SJ-2026-10-0101', inDays(-3), [['FRZ-CHK-001', 120], ['CHL-DRY-003', 200]]);
  await receive(completed, 'FRZ-CHK-001', 80);
  await receive(completed, 'FRZ-CHK-001', 40);
  await receive(completed, 'CHL-DRY-003', 200);
  await act(completed, 'complete');

  // CLOSED_SHORT: the beef never fully arrived; the shortage of 12 stays on record.
  const short = await opened('CV Samudra Segar', 'DO-88213', inDays(-2), [['FRZ-FSH-002', 50], ['CHL-MEA-005', 30]]);
  await receive(short, 'FRZ-FSH-002', 50);
  await receive(short, 'CHL-MEA-005', 18);
  await act(short, 'close-short', 'Supplier out of stock for the remaining beef');

  // IN_PROGRESS with a mistake fixed: 100 typed instead of 10, reversed, then received again.
  const partial = await opened('PT Dairy Prima', 'SJ-2026-10-0144', inDays(-1), [['CHL-DRY-003', 300], ['FRZ-VEG-004', 150]], 'Second truck expected tomorrow');
  const typo = await receive(partial, 'CHL-DRY-003', 100);
  await call(supervisor, 'POST', `/receiving-documents/${partial.id}/receipts/${typo.id}/reverse`, { reason: 'Typo: counted 10, entered 100' });
  await receive(partial, 'CHL-DRY-003', 10);
  await receive(partial, 'FRZ-VEG-004', 60);

  // IN_PROGRESS and fully received: ready for the supervisor to complete.
  const ready = await opened('PT Sumber Beku Nusantara', 'SJ-2026-10-0150', inDays(0), [['FRZ-CHK-001', 40], ['FRZ-FSH-002', 20]]);
  await receive(ready, 'FRZ-CHK-001', 40);
  await receive(ready, 'FRZ-FSH-002', 20);

  // OPEN: released to the dock, nothing counted yet.
  await opened('CV Kebun Hijau', 'KH-5521', inDays(1), [['FRZ-VEG-004', 200], ['CHL-MEA-005', 25]]);

  // DRAFT: still being prepared; lines can be edited.
  await create('CV Samudra Segar', 'DO-88240', inDays(3), [['FRZ-FSH-002', 60], ['FRZ-CHK-001', 30]]);

  // CANCELLED: the supplier called the delivery off before anything arrived.
  await act(await opened('PT Kirim Cepat Logistik', 'KC-0093', inDays(2), [['CHL-DRY-003', 100]]), 'cancel', 'Supplier cancelled shipment');

  console.log('Demo data created: 7 receiving documents (DRAFT, OPEN, 2 × IN_PROGRESS, COMPLETED, CLOSED_SHORT, CANCELLED)');
}

main().catch((error: unknown) => {
  console.error(`Demo seed failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Documents created before the failure stay; to start over: docker compose down -v, then up again and rerun.');
  process.exitCode = 1;
});
