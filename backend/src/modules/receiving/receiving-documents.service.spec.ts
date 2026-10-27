import { formatDocumentNumber } from './receiving-documents.service';

describe('document number (FR-22)', () => {
  it.each([
    [2026, 1n, 'RCV-2026-000001'],
    [2026, 42n, 'RCV-2026-000042'],
    [2027, 999_999n, 'RCV-2027-999999'],
    // D-17: past 999,999 the number grows instead of being cut to 6 digits.
    [2027, 1_000_000n, 'RCV-2027-1000000'],
  ])('FR-22 D-17 year %i, sequence %s → %s', (year, seq, expected) => {
    expect(formatDocumentNumber(year, seq)).toBe(expected);
  });
});
