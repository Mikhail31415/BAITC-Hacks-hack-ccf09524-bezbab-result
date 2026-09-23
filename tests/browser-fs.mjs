// Замена node:fs.readFileSync для браузера: синхронный запрос к локальному серверу (только для тестов).
export function readFileSync(url) {
  const request = new XMLHttpRequest();
  request.open("GET", String(url), false);
  request.send();
  if (request.status !== 200) throw new Error(`Не удалось прочитать ${url}: ${request.status}`);
  return request.responseText;
}
