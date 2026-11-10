import expect from "expect";

export const deepCompare = (actual: unknown, expected: unknown): void => {
  if (expected === "@any") {
    return;
  }

  if (expected === "@url") {
    expect(typeof actual).toBe("string");
    expect(() => new URL(actual as string)).not.toThrow();
    return;
  }

  if (actual === expected) return;

  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);

    const actualEntries = actual as unknown[];
    expect(actualEntries.length).toBe(expected.length);
    expected.forEach((entry, index) => {
      deepCompare(actualEntries[index], entry);
    });
    return;
  }

  if (typeof actual !== "object" || actual === null || typeof expected !== "object" || expected === null) {
    expect(actual).toBe(expected);
    return;
  }

  const actualRecord = actual as Record<string, unknown>;
  const expectedRecord = expected as Record<string, unknown>;
  const actualKeys = Object.keys(actualRecord);
  const expectedKeys = Object.keys(expectedRecord);

  expect(actualKeys.length).toBe(expectedKeys.length);

  for (const key of expectedKeys) {
    expect(actualKeys).toContain(key);
    deepCompare(actualRecord[key], expectedRecord[key]);
  }
};
