export const camelKey = (key) =>
  (key === key.toUpperCase() ? key.toLowerCase() : key).replace(/_([a-z])/g, (_match, letter) =>
    letter.toUpperCase(),
  );

// Rename object keys only. Strings, enums, IDs, Japanese text and null amounts are data.
export function camelBody(value) {
  if (Array.isArray(value)) {
    return value.map(camelBody);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [camelKey(key), camelBody(child)]),
  );
}

export function httpSchema(value) {
  if (Array.isArray(value)) {
    return value.map(httpSchema);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === 'properties') {
        return [
          key,
          Object.fromEntries(
            Object.entries(child).map(([name, schema]) => [camelKey(name), httpSchema(schema)]),
          ),
        ];
      }

      if (key === 'required') {
        return [key, child.map(camelKey)];
      }

      return [key, httpSchema(child)];
    }),
  );
}
