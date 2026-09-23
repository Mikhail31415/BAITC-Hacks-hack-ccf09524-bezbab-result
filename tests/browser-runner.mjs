// Минимальная замена node:test для запуска тех же тестов в браузере (tests.html).
const registered = [];

export default function test(name, fn) {
  registered.push({ name, fn });
}

export async function run(report) {
  const results = [];
  for (const { name, fn } of registered) {
    const started = performance.now();
    try {
      await fn();
      results.push({ name, ok: true, ms: performance.now() - started });
    } catch (error) {
      results.push({ name, ok: false, ms: performance.now() - started, error: String(error?.message ?? error) });
    }
    report?.(results[results.length - 1]);
  }
  return results;
}
