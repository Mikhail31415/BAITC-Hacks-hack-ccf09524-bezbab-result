// Минимальная замена node:assert/strict для браузерного запуска тестов.
const fail = (message, fallback) => { throw new Error(message ?? fallback); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const assert = {
  ok: (value, message) => value || fail(message, "ожидалось истинное значение"),
  equal: (actual, expected, message) => Object.is(actual, expected) || fail(message, `${actual} !== ${expected}`),
  notEqual: (actual, expected, message) => !Object.is(actual, expected) || fail(message, `${actual} === ${expected}`),
  deepEqual: (actual, expected, message) => same(actual, expected) || fail(message, `${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`),
  match: (text, pattern, message) => pattern.test(text) || fail(message, `«${text}» не содержит ${pattern}`),
};

export default assert;
