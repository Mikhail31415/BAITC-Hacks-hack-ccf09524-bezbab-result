import { BUDGET, CONFLICTS, DECISIONS_REQUIRED, DIRECTIONS, DISTRICTS, EVENTS, INDICATORS, MAX_PER_DIRECTION, MEASURES, SCORE_RULES, SYNERGIES, onModelChange } from "./data.mjs";
import { BASELINE, BASE_CELLS, K, N_DISTRICTS, SHARES, WEIGHTS, changesBetween, effectCells, measureIndex, scoreOf, stressTest, validate } from "./engine.mjs";

// Точный оптимизатор. Пространство для модели ТЗ: C(14,5) наборов мер × до 5^5 вариантов районов ≈ 1,4 млн комбинаций.
// Перебор с отсечениями (бюджет, лимит направления, несовместимости) и инкрементальным пересчётом:
// эффект меры прибавляется при входе в ветку и вычитается при выходе. Все эффекты кратны 1/8,
// поэтому сложение и вычитание в double точны и не накапливают погрешность.

const pack = (list) => ({ idx: Int32Array.from(list, ([cell]) => cell), val: Float64Array.from(list, ([, value]) => value) });
const indicatorIndex = Object.fromEntries(INDICATORS.map((indicator, index) => [indicator.id, index]));

// Таблицы перебора строятся из текущей модели и пересобираются после изменения настроек.
let M, COST, LAG, DIRECTION, IS_CITY, EFFECTS, SYN, GLOBAL_CONFLICTS, DISTRICT_CONFLICTS, RULES, BASE_D, EVT;
function rebuild() {
  M = MEASURES.length;
  COST = Int32Array.from(MEASURES, (measure) => measure.cost);
  LAG = Int32Array.from(MEASURES, (measure) => measure.lag);
  DIRECTION = Int32Array.from(MEASURES, (measure) => DIRECTIONS.findIndex((direction) => direction.id === measure.direction));
  IS_CITY = MEASURES.map((measure) => measure.scope === "city");
  EFFECTS = MEASURES.map((measure) => (measure.scope === "city" ? [pack(effectCells(measure, 0))] : DISTRICTS.map((_, d) => pack(effectCells(measure, d)))));
  SYN = SYNERGIES.map((synergy) => {
    const [a, b] = synergy.measures.map((id) => measureIndex[id]);
    const anchor = !IS_CITY[a] ? a : !IS_CITY[b] ? b : -1;
    return { a, b, anchor, k: indicatorIndex[synergy.indicator], bonus: synergy.bonus };
  });
  GLOBAL_CONFLICTS = CONFLICTS.filter((conflict) => !conflict.sameDistrict).map((conflict) => conflict.measures.map((id) => measureIndex[id]));
  DISTRICT_CONFLICTS = CONFLICTS.filter((conflict) => conflict.sameDistrict).map((conflict) => conflict.measures.map((id) => measureIndex[id]));
  RULES = { ...SCORE_RULES };
  BASE_D = Float64Array.from(BASELINE.districtScores);
  // События: базовая и удешевлённая ликвидация, район и профильные меры (флаги по индексу меры).
  EVT = EVENTS.map((event) => {
    const mitig = new Uint8Array(M);
    for (const id of event.mitigatedBy) if (measureIndex[id] !== undefined) mitig[measureIndex[id]] = 1;
    return { id: event.id, base: event.responseCost, reduced: Math.ceil(event.responseCost * (1 - event.costReduction) - 1e-9), d: DISTRICTS.findIndex((district) => district.id === event.districtId), mitig };
  });
}

// Стоимость ликвидации события для набора sel/dist: дешевле, если есть профильная мера в районе события или городская.
function eventCost(event, sel, dist) {
  for (let i = 0; i < DECISIONS_REQUIRED; i += 1) if (event.mitig[sel[i]] && (dist[i] === -1 || dist[i] === event.d)) return event.reduced;
  return event.base;
}
function reserveFor(events, mode, sel, dist) {
  let total = 0;
  for (const event of events) {
    const cost = eventCost(event, sel, dist);
    total = mode === "all" ? total + cost : Math.max(total, cost);
  }
  return total;
}
rebuild();
onModelChange(rebuild);

function add(cells, effect, sign) {
  const { idx, val } = effect;
  for (let i = 0; i < idx.length; i += 1) cells[idx[i]] += sign * val[i];
}

// visit(score, cost, sel, dist, weakest, minGain) вызывается для каждого допустимого набора;
// minGain — наименьший прирост оценки среди районов.
// sel — индексы мер, dist — индексы районов (−1 для городских мер). Массивы переиспользуются — копируйте при сохранении.
export function enumerate(visit, { budget = BUDGET } = {}) {
  const sel = new Int32Array(DECISIONS_REQUIRED);
  const dist = new Int32Array(DECISIONS_REQUIRED).fill(-1);
  const chosen = new Uint8Array(M);
  const perDirection = new Int32Array(DIRECTIONS.length);
  const cells = Float64Array.from(BASE_CELLS);
  const districtOf = new Int32Array(M).fill(-1);
  let visited = 0;

  function leaf(cost) {
    for (const synergy of SYN) {
      if (!chosen[synergy.a] || !chosen[synergy.b]) continue;
      if (synergy.anchor >= 0) cells[districtOf[synergy.anchor] * K + synergy.k] += synergy.bonus;
      else for (let d = 0; d < N_DISTRICTS; d += 1) cells[d * K + synergy.k] += synergy.bonus;
    }
    let average = 0;
    let weakest = Infinity;
    let critical = 0;
    let shortfall = 0;
    let minGain = Infinity;
    for (let d = 0; d < N_DISTRICTS; d += 1) {
      let score = 0;
      const offset = d * K;
      for (let k = 0; k < K; k += 1) {
        let value = cells[offset + k];
        if (value > 100) value = 100; else if (value < 0) value = 0;
        score += WEIGHTS[k] * value;
        if (value < RULES.criticalThreshold) critical += 1;
      }
      average += SHARES[d] * score;
      if (score < weakest) weakest = score;
      if (score < RULES.districtTarget) shortfall += RULES.districtTarget - score;
      if (score - BASE_D[d] < minGain) minGain = score - BASE_D[d];
    }
    for (const synergy of SYN) {
      if (!chosen[synergy.a] || !chosen[synergy.b]) continue;
      if (synergy.anchor >= 0) cells[districtOf[synergy.anchor] * K + synergy.k] -= synergy.bonus;
      else for (let d = 0; d < N_DISTRICTS; d += 1) cells[d * K + synergy.k] -= synergy.bonus;
    }
    visited += 1;
    visit(RULES.averageWeight * average + RULES.weakestWeight * weakest - RULES.criticalPenalty * critical - RULES.lagPenalty * shortfall, cost, sel, dist, weakest, minGain);
  }

  function placeDistricts(position, cost) {
    if (position === DECISIONS_REQUIRED) { leaf(cost); return; }
    const m = sel[position];
    if (IS_CITY[m]) { placeDistricts(position + 1, cost); return; }
    for (let d = 0; d < N_DISTRICTS; d += 1) {
      let blocked = false;
      for (const [a, b] of DISTRICT_CONFLICTS) {
        const partner = m === a ? b : m === b ? a : -1;
        if (partner >= 0 && chosen[partner] && districtOf[partner] === d) { blocked = true; break; }
      }
      if (blocked) continue;
      districtOf[m] = d;
      dist[position] = d;
      add(cells, EFFECTS[m][d], 1);
      placeDistricts(position + 1, cost);
      add(cells, EFFECTS[m][d], -1);
    }
    districtOf[m] = -1;
    dist[position] = -1;
  }

  function chooseMeasures(start, depth, cost) {
    if (depth === DECISIONS_REQUIRED) { placeDistricts(0, cost); return; }
    for (let m = start; m <= M - (DECISIONS_REQUIRED - depth); m += 1) {
      if (cost + COST[m] > budget || perDirection[DIRECTION[m]] >= MAX_PER_DIRECTION) continue;
      if (GLOBAL_CONFLICTS.some(([a, b]) => (m === a && chosen[b]) || (m === b && chosen[a]))) continue;
      sel[depth] = m;
      chosen[m] = 1;
      perDirection[DIRECTION[m]] += 1;
      if (IS_CITY[m]) add(cells, EFFECTS[m][0], 1);
      chooseMeasures(m + 1, depth + 1, cost + COST[m]);
      if (IS_CITY[m]) add(cells, EFFECTS[m][0], -1);
      perDirection[DIRECTION[m]] -= 1;
      chosen[m] = 0;
    }
  }

  chooseMeasures(0, 0, 0);
  return visited;
}

export const toDecisions = (sel, dist) => Array.from(sel, (m, index) => ({ measureId: MEASURES[m].id, districtId: dist[index] >= 0 ? DISTRICTS[dist[index]].id : null }));
const round2 = (value) => Math.round(value * 100) / 100;
const snapshot = (score, cost, sel, dist, weakest) => ({ score, cost, weakest, decisions: toDecisions(sel, dist) });
const better = (a, b) => !b || a.score > b.score + 1e-9 || (Math.abs(a.score - b.score) <= 1e-9 && a.cost < b.cost);

// Пять стратегий с разными приоритетами. Каждая — лучший допустимый набор по своему критерию;
// стратегии отличаются друг от друга минимум двумя решениями, чтобы выбор был настоящим.
export const STRATEGY_DEFS = [
  { id: "max", title: "Максимальный результат", idea: "Наибольший Score, который позволяет бюджет.", accept: () => true, key: (c) => c.score },
  { id: "reserve", title: "Надёжный с резервом", idea: "Почти максимум, но оставляет резерв на ликвидацию любого из городских событий; резерв считается с учётом мер, которые удешевляют ликвидацию.", accept: (c) => c.cost + c.reserveAll <= BUDGET, key: (c) => c.score },
  { id: "weakest", title: "Поддержка отстающих", idea: "Сильнее всего поднимает самый слабый район города.", accept: () => true, key: (c) => c.weakest + c.score * 1e-6 },
  { id: "everyone", title: "Улучшения для всех районов", idea: "Каждый из пяти районов заметно выигрывает: максимален наименьший прирост среди районов.", accept: () => true, key: (c) => c.minGain + c.score * 1e-6 },
  { id: "fast", title: "Быстрый эффект", idea: "Только меры, которые запускаются за 1–2 квартала: результат виден раньше, меньше риск задержек.", accept: (c) => c.maxLag <= 2, key: (c) => c.score },
];
const STRATEGY_POOL = 120;

// Оценка размера пространства (сверху): число наборов мер × размещений по районам с учётом бюджета и лимитов.
export function estimateSpace() {
  let total = 0;
  const perDirection = new Int32Array(DIRECTIONS.length);
  (function walk(start, depth, cost, districtMeasures) {
    if (depth === DECISIONS_REQUIRED) { total += N_DISTRICTS ** districtMeasures; return; }
    for (let m = start; m <= M - (DECISIONS_REQUIRED - depth); m += 1) {
      if (cost + COST[m] > BUDGET || perDirection[DIRECTION[m]] >= MAX_PER_DIRECTION) continue;
      perDirection[DIRECTION[m]] += 1;
      walk(m + 1, depth + 1, cost + COST[m], districtMeasures + (IS_CITY[m] ? 0 : 1));
      perDirection[DIRECTION[m]] -= 1;
    }
  })(0, 0, 0, 0);
  return total;
}

export const SPACE_LIMIT = 15_000_000;

// Полный анализ пространства решений: распределение Score, лучшие наборы, граница «бюджет → максимум».
// insurance — страховка от событий: { events: [id…], mode: "one" | "all" }. Стратегии подбираются только
// среди наборов, у которых стоимость мер + резерв под отмеченные события ≤ бюджета.
export function analyzeSpace({ topSize = 2000, insurance = null } = {}) {
  const insured = EVT.filter((event) => insurance?.events?.includes(event.id));
  const mode = insurance?.mode === "all" ? "all" : "one";
  let insuredCount = 0;
  const started = Date.now();
  const estimate = estimateSpace();
  if (estimate > SPACE_LIMIT) return { tooLarge: true, estimate, count: 0 };
  let scores = new Float32Array(1 << 20);
  let count = 0;
  let best = null;
  let bestWeakest = null;
  const bestByCost = new Array(BUDGET + 1).fill(null);
  let top = [];
  let threshold = -Infinity;
  const pools = STRATEGY_DEFS.map(() => ({ items: [], threshold: -Infinity }));
  const context = { score: 0, cost: 0, weakest: 0, minGain: 0, maxLag: 0, reserveAll: 0 };

  const visited = enumerate((score, cost, sel, dist, weakest, minGain) => {
    if (count === scores.length) { const grown = new Float32Array(scores.length * 2); grown.set(scores); scores = grown; }
    scores[count] = score;
    count += 1;
    if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && cost < best.cost)) best = snapshot(score, cost, sel, dist, weakest);
    if (!bestWeakest || weakest > bestWeakest.weakest + 1e-9 || (Math.abs(weakest - bestWeakest.weakest) <= 1e-9 && score > bestWeakest.score)) bestWeakest = snapshot(score, cost, sel, dist, weakest);
    if (!bestByCost[cost] || score > bestByCost[cost].score + 1e-9) bestByCost[cost] = snapshot(score, cost, sel, dist, weakest);
    context.score = score; context.cost = cost; context.weakest = weakest; context.minGain = minGain;
    context.maxLag = Math.max(LAG[sel[0]], LAG[sel[1]], LAG[sel[2]], LAG[sel[3]], LAG[sel[4]]);
    context.reserveAll = reserveFor(EVT, "one", sel, dist);
    const feasible = !insured.length || cost + reserveFor(insured, mode, sel, dist) <= BUDGET;
    if (feasible) insuredCount += 1;
    STRATEGY_DEFS.forEach((definition, index) => {
      const pool = pools[index];
      if (!feasible || !definition.accept(context)) return;
      const key = definition.key(context);
      if (key <= pool.threshold) return;
      pool.items.push({ key, ...snapshot(score, cost, sel, dist, weakest), minGain });
      if (pool.items.length >= STRATEGY_POOL * 2) {
        pool.items.sort((a, b) => b.key - a.key || a.cost - b.cost);
        pool.items.length = STRATEGY_POOL;
        pool.threshold = pool.items[STRATEGY_POOL - 1].key;
      }
    });
    if (score > threshold) {
      top.push(snapshot(score, cost, sel, dist, weakest));
      if (top.length >= topSize * 2) {
        top.sort((a, b) => b.score - a.score);
        top.length = topSize;
        threshold = top[topSize - 1].score;
      }
    }
  });

  if (!count) return { empty: true, count: 0, visited };
  top.sort((a, b) => b.score - a.score || a.cost - b.cost);
  top.length = Math.min(top.length, topSize);
  const sorted = scores.slice(0, count).sort();

  // Граница Парето: максимально достижимый Score при расходе не больше c.
  const pareto = [];
  let running = null;
  for (let cost = 0; cost <= BUDGET; cost += 1) {
    if (bestByCost[cost] && better(bestByCost[cost], running)) {
      running = bestByCost[cost];
      pareto.push(running);
    }
  }

  // Экономный: самый дешёвый набор, который отстаёт от максимума не больше чем на 0,3 п.
  const economical = pareto.find((point) => point.score >= best.score - 0.3) ?? best;

  // Устойчивый: среди лучших наборов — максимум среднего Score после стресс-событий.
  const resilient = top.slice(0, 400).map((item) => {
    const stress = stressTest(item.decisions);
    return { ...item, stressAverage: stress.reduce((sum, event) => sum + event.scoreAfter, 0) / stress.length };
  }).sort((a, b) => b.stressAverage - a.stressAverage || b.score - a.score)[0];

  // Ядро лучших решений: как часто мера (в районе) встречается в топе.
  const frequency = new Map();
  for (const item of top) for (const decision of item.decisions) {
    const key = decision.districtId ? `${decision.measureId}.${decision.districtId}` : decision.measureId;
    frequency.set(key, (frequency.get(key) ?? 0) + 1);
  }
  const core = [...frequency.entries()].map(([key, hits]) => {
    const [measureId, districtId] = key.split(".");
    return { measureId, districtId: districtId ?? null, share: hits / top.length };
  }).sort((a, b) => b.share - a.share).slice(0, 8);

  // Стратегии: по порядку берём лучший набор, отличающийся от уже выбранных минимум двумя решениями.
  const strategies = [];
  STRATEGY_DEFS.forEach((definition, index) => {
    const items = pools[index].items.sort((a, b) => b.key - a.key || a.cost - b.cost);
    const pick = items.find((item) => strategies.every((chosen) => changesBetween(chosen.decisions, item.decisions) >= 2)) ?? items[0];
    if (pick) strategies.push({ id: definition.id, title: definition.title, idea: typeof definition.idea === "function" ? definition.idea() : definition.idea, score: round2(pick.score), exactScore: pick.score, cost: pick.cost, weakest: pick.weakest, minGain: pick.minGain, decisions: pick.decisions });
  });

  const bins = 36;
  const min = sorted[0];
  const max = sorted[count - 1];
  const histogram = new Array(bins).fill(0);
  for (let i = 0; i < count; i += 1) histogram[Math.min(bins - 1, Math.floor((sorted[i] - min) / (max - min || 1) * bins))] += 1;

  return {
    visited,
    count,
    elapsedMs: Date.now() - started,
    sorted,
    histogram: { min, max, bins: histogram },
    best: { ...best, score: round2(best.score) },
    alternatives: {
      best: { ...best, score: round2(best.score) },
      economical: { ...economical, score: round2(economical.score) },
      weakest: { ...bestWeakest, score: round2(bestWeakest.score) },
      resilient: { ...resilient, score: round2(resilient.score), stressAverage: round2(resilient.stressAverage) },
    },
    pareto: pareto.map((point) => ({ ...point, score: round2(point.score) })),
    strategies,
    insurance: { events: insured.map((event) => event.id), mode, feasible: insuredCount },
    core,
    topSize: top.length,
  };
}

// Доля допустимых наборов со Score строго ниже данного (sorted — по возрастанию).
export function percentile(sorted, score) {
  let low = 0;
  let high = sorted.length;
  const target = Math.fround(score) - 1e-6;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] < target) low = mid + 1; else high = mid;
  }
  return { below: low, total: sorted.length, share: low / sorted.length, rank: sorted.length - low };
}

// Лучшая замена одного решения: другая мера или та же мера в другом районе.
export function bestSingleChange(decisions, { accept = null } = {}) {
  const current = scoreOf(decisions);
  let best = null;
  decisions.forEach((decision, position) => {
    for (const measure of MEASURES) {
      for (const districtId of measure.scope === "city" ? [null] : DISTRICTS.map((district) => district.id)) {
        if (measure.id === decision.measureId && districtId === (decision.districtId ?? null)) continue;
        const next = decisions.map((item, index) => (index === position ? { measureId: measure.id, districtId } : item));
        if (validate(next).length || (accept && !accept(next))) continue;
        const score = scoreOf(next);
        if (score <= current + 1e-9) continue;
        const cost = next.reduce((sum, item) => sum + MEASURES[measureIndex[item.measureId]].cost, 0);
        if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && cost < best.cost)) {
          best = { position, from: decision, to: { measureId: measure.id, districtId }, decisions: next, score, cost, gain: score - current };
        }
      }
    }
  });
  return best && { ...best, score: round2(best.score), gain: round2(best.gain) };
}

// Перераспределение после события: лучшие наборы, на которые хватает денег вместе с ликвидацией,
// отдельно для каждого числа изменённых решений (1…5). Так видна цена перестройки.
export function reallocate(decisions, eventId) {
  const event = EVT.find((item) => item.id === eventId);
  const byChanges = new Array(DECISIONS_REQUIRED + 1).fill(null);
  // Таблица «мера × район (+1 для городских)» → входит ли решение в текущий набор.
  const current = new Uint8Array(M * (N_DISTRICTS + 1));
  for (const decision of decisions) current[measureIndex[decision.measureId] * (N_DISTRICTS + 1) + (decision.districtId ? DISTRICTS.findIndex((district) => district.id === decision.districtId) : -1) + 1] = 1;
  enumerate((score, cost, sel, dist) => {
    const liquidation = eventCost(event, sel, dist);
    if (cost + liquidation > BUDGET) return;
    let same = 0;
    for (let i = 0; i < DECISIONS_REQUIRED; i += 1) same += current[sel[i] * (N_DISTRICTS + 1) + dist[i] + 1];
    const changes = DECISIONS_REQUIRED - same;
    const kept = byChanges[changes];
    if (!kept || score > kept.score + 1e-9 || (Math.abs(score - kept.score) <= 1e-9 && cost < kept.cost)) byChanges[changes] = { score, cost, liquidation, changes, decisions: toDecisions(sel, dist) };
  }, { budget: BUDGET - event.reduced });
  // Оставляем только недоминируемые варианты: больше изменений имеет смысл, только если Score выше.
  const options = [];
  for (const option of byChanges.filter(Boolean)) {
    if (!options.length || option.score > options[options.length - 1].exactScore + 1e-9) options.push({ ...option, exactScore: option.score, score: round2(option.score) });
  }
  return { eventId, options };
}
