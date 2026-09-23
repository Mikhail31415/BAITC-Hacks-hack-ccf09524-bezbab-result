// Небольшие SVG-графики без библиотек. Подписи — текстовыми цветами, идентичность — не только цветом.
const INK = "#202621";
const MUTED = "#7a8279";
const GRID = "#e4e6de";
const BAR = "#b9c8bb";
const YOU = "#d8613b";
const BEST = "#263e30";
const BASE = "#8b918a";
const fmt = (value) => Number(value).toFixed(2);
const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function marker(x, top, bottom, color, text, anchor, row) {
  const y = top + 12 + row * 14;
  return `<line x1="${x}" x2="${x}" y1="${y + 4}" y2="${bottom}" stroke="${color}" stroke-width="2" ${color === BASE ? 'stroke-dasharray="4 3"' : ""}/>`
    + `<text x="${x + (anchor === "end" ? -6 : 6)}" y="${y}" text-anchor="${anchor}" font-size="11" font-weight="700" fill="${INK}">${esc(text)}</text>`;
}

export function histogram({ bins, min, max }, { you, best, baseline }) {
  const width = 560;
  const height = 230;
  const pad = { left: 44, right: 16, top: 50, bottom: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const peak = Math.max(...bins);
  const lo = Math.min(min, baseline);
  const hi = Math.max(max, you, best);
  const x = (value) => pad.left + (value - lo) / (hi - lo) * plotW;
  const step = (max - min) / bins.length;
  const barW = Math.max(1, x(min + step) - x(min) - 2);
  const bars = bins.map((count, index) => {
    const from = min + index * step;
    const h = count / peak * plotH;
    return `<rect x="${x(from) + 1}" y="${pad.top + plotH - h}" width="${barW}" height="${Math.max(h, count ? 1 : 0)}" rx="2" fill="${BAR}"><title>${fmt(from)}–${fmt(from + step)}: ${count.toLocaleString("ru-RU")} наборов</title></rect>`;
  }).join("");
  const ticks = [];
  for (let t = Math.ceil(lo); t <= Math.floor(hi); t += 1) ticks.push(`<line x1="${x(t)}" x2="${x(t)}" y1="${pad.top + plotH}" y2="${pad.top + plotH + 4}" stroke="${MUTED}"/><text x="${x(t)}" y="${pad.top + plotH + 17}" text-anchor="middle" font-size="11" fill="${MUTED}">${t}</text>`);
  const marks = [
    { value: baseline, color: BASE, text: `База ${fmt(baseline)}` },
    { value: you, color: YOU, text: `Вы ${fmt(you)}` },
    { value: best, color: BEST, text: `Максимум ${fmt(best)}` },
  ].sort((a, b) => a.value - b.value).map((mark, index) => marker(x(mark.value), 0, pad.top + plotH, mark.color, mark.text, x(mark.value) > width - 140 ? "end" : "start", index)).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Распределение Score всех допустимых наборов: база ${fmt(baseline)}, ваш ${fmt(you)}, максимум ${fmt(best)}">`
    + `<line x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + plotH}" y2="${pad.top + plotH}" stroke="${GRID}"/>`
    + `<text x="${pad.left - 8}" y="${pad.top + 4}" text-anchor="end" font-size="10" fill="${MUTED}">${peak.toLocaleString("ru-RU")}</text>`
    + `<text x="${pad.left - 8}" y="${pad.top + plotH}" text-anchor="end" font-size="10" fill="${MUTED}">0</text>`
    + bars + ticks.join("") + marks
    + `<text x="${width - pad.right}" y="${height - 2}" text-anchor="end" font-size="10" fill="${MUTED}">Score →</text></svg>`;
}

export function pareto(points, { you, youCost, baseline }) {
  const width = 560;
  const height = 230;
  const pad = { left: 44, right: 20, top: 20, bottom: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const xLo = Math.floor(Math.min(60, youCost, points[0].cost) / 10) * 10;
  const xHi = 100;
  const yLo = Math.floor(Math.min(you, points[0].score) * 2) / 2;
  const yHi = Math.ceil(points[points.length - 1].score * 2) / 2;
  const x = (cost) => pad.left + (cost - xLo) / (xHi - xLo) * plotW;
  const y = (score) => pad.top + (1 - (score - yLo) / (yHi - yLo)) * plotH;
  let path = "";
  points.forEach((point, index) => {
    const next = points[index + 1];
    path += `${index ? "L" : "M"}${x(point.cost)},${y(point.score)} H${x(next ? next.cost : xHi)}`;
  });
  const gridY = [];
  for (let v = yLo; v <= yHi + 1e-9; v += 0.5) gridY.push(`<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(v)}" y2="${y(v)}" stroke="${GRID}"/><text x="${pad.left - 8}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="${MUTED}">${v.toFixed(1)}</text>`);
  const gridX = Array.from({ length: Math.floor((xHi - xLo) / 10) + 1 }, (_, i) => xLo + i * 10).map((v) => `<text x="${x(v)}" y="${pad.top + plotH + 17}" text-anchor="middle" font-size="11" fill="${MUTED}">${v}</text>`);
  const dots = points.map((point) => `<circle cx="${x(point.cost)}" cy="${y(point.score)}" r="4" fill="${BEST}" stroke="#fff" stroke-width="2"><title>≤ ${point.cost} ед.: максимум ${fmt(point.score)}</title></circle><circle cx="${x(point.cost)}" cy="${y(point.score)}" r="10" fill="transparent"><title>≤ ${point.cost} ед.: максимум ${fmt(point.score)}</title></circle>`).join("");
  const yourDot = `<circle cx="${x(youCost)}" cy="${y(you)}" r="6" fill="${YOU}" stroke="#fff" stroke-width="2"><title>Ваш сценарий: ${fmt(you)} за ${youCost} ед.</title></circle>`
    + `<text x="${x(youCost) + (x(youCost) > width - 120 ? -10 : 10)}" y="${y(you) + 16}" text-anchor="${x(youCost) > width - 120 ? "end" : "start"}" font-size="11" font-weight="700" fill="${INK}">Вы ${fmt(you)}</text>`;
  const last = points[points.length - 1];
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Максимальный Score в зависимости от бюджета; ваш сценарий ${fmt(you)} за ${youCost} единиц">`
    + gridY.join("") + gridX.join("")
    + `<path d="${path}" fill="none" stroke="${BEST}" stroke-width="2"/>` + dots + yourDot
    + `<text x="${x(last.cost) - 8}" y="${y(last.score) - 10}" text-anchor="end" font-size="11" font-weight="700" fill="${INK}">Максимум ${fmt(last.score)}</text>`
    + `<text x="${width - pad.right}" y="${height - 2}" text-anchor="end" font-size="10" fill="${MUTED}">Бюджет, ед. →</text></svg>`;
}
