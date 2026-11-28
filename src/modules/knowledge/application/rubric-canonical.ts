export function canonicalRubricContent(value: unknown): string {
  const serialize = (item: unknown, depth: number): string => {
    if (depth > 32) {
      throw new Error('Invalid rubric canonical content');
    }

    if (typeof item === 'string' || typeof item === 'boolean') {
      return JSON.stringify(item);
    }

    if (typeof item === 'number' && Number.isSafeInteger(item)) {
      return JSON.stringify(item);
    }

    if (Array.isArray(item)) {
      return `[${item.map((child: unknown) => serialize(child, depth + 1)).join(',')}]`;
    }

    if (item !== null && typeof item === 'object') {
      return `{${Object.entries(item)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => `${JSON.stringify(key)}:${serialize(child, depth + 1)}`)
        .join(',')}}`;
    }

    throw new Error('Invalid rubric canonical content');
  };

  return serialize(value, 0);
}
