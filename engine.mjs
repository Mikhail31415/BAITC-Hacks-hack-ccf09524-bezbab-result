import { BUDGET, CONFLICTS, DECISIONS_REQUIRED, DIRECTIONS, DISTRICTS, EVENTS, HORIZON, INDICATORS, MAX_PER_DIRECTION, MEASURES, SCORE_RULES, SYNERGIES, onModelChange } from "./data.mjs";

// Внутреннее представление: плоский массив 5 районов × 10 показателей, ячейка = район * 10 + показатель.
export const K = INDICATORS.length;
export const N_DISTRICTS = DISTRICTS.length;
export const WEIGHTS = new Float64Array(K); // обновляется при смене модели
export const SHARES = Float64Array.from(DISTRICTS, (district) => district.share);
export const BASE_CELLS = Float64Array.from(DISTRICTS.flatMap((district) => INDICATORS.map((indicator) => district.metrics[indicator.id])));
const indicatorIndex = Object.fromEntries(INDICATORS.map((indicator, index) => [indicator.id, index]));
const districtIndex = Object.fromEntries(DISTRICTS.map((district, index) => [district.id, index]));
export const measureIndex = {}; // обновляется при смене модели

export const realizedShare = (measure) => (HORIZON - measure.lag) / HORIZON;
export const getMeasure = (id) => MEASURES.find((measure) => measure.id === id);
export const getDistrict = (id) => DISTRICTS.find((district) => district.id === id);
export const getIndicator = (id) => INDICATORS.find((indicator) => indicator.id === id);
export const getDirection = (id) => DIRECTIONS.find((direction) => direction.id === id);
const round2 = (value) => Math.round(value * 100) / 100;

// Эффект меры с учётом лага: список [ячейка, прирост] для района (или всех районов, если мера городская).
export function effectCells(measure, dIndex, share = realizedShare(measure), multiplier = 1) {
  const targets = measure.scope === "city" ? DISTRICTS.map((_, index) => index) : [dIndex];
  return targets.flatMap((target) => Object.entries(measure.effects).map(([indicatorId, value]) => [target * K + indicatorIndex[indicatorId], value * share * multiplier]));
}

// Синергии: бонус в районе первой районной меры пары; если обе городские — во всех районах.
export function activeSynergies(decisions) {
  const byMeasure = new Map(decisions.map((decision) => [decision.measureId, decision]));
  return SYNERGIES.filter((synergy) => synergy.measures.every((id) => byMeasure.has(id))).map((synergy) => {
    const anchor = synergy.measures.map((id) => byMeasure.get(id)).find((decision) => decision.districtId);
    return { ...synergy, districtId: anchor?.districtId ?? null };
  });
}

export function scoreCells(cells) {
  let average = 0;
  let weakest = Infinity;
  let weakestIndex = 0;
  let critical = 0;
  const districtScores = new Float64Array(N_DISTRICTS);
  for (let d = 0; d < N_DISTRICTS; d += 1) {
    let score = 0;
    for (let k = 0; k < K; k += 1) {
      const value = Math.max(0, Math.min(100, cells[d * K + k]));
      score += WEIGHTS[k] * value;
      if (value < SCORE_RULES.criticalThreshold) critical += 1;
    }
    districtScores[d] = score;
    average += SHARES[d] * score;
    if (score < weakest) { weakest = score; weakestIndex = d; }
  }
  // Отставание районов от порога (расширение формулы; в ТЗ lagPenalty = 0).
  let shortfall = 0;
  if (SCORE_RULES.lagPenalty) for (let d = 0; d < N_DISTRICTS; d += 1) shortfall += Math.max(0, SCORE_RULES.districtTarget - districtScores[d]);
  const score = SCORE_RULES.averageWeight * average + SCORE_RULES.weakestWeight * weakest - SCORE_RULES.criticalPenalty * critical - SCORE_RULES.lagPenalty * shortfall;
  return { score, average, weakest, weakestIndex, critical, shortfall, districtScores };
}

// Применяет любой (в том числе неполный) набор решений. Валидность проверяет validate().
export function applyDecisions(decisions, { multipliers = [], lagDelays = [] } = {}) {
  const cells = Float64Array.from(BASE_CELLS);
  decisions.forEach((decision, index) => {
    const measure = getMeasure(decision.measureId);
    const lag = Math.min(HORIZON, measure.lag + (lagDelays[index] ?? 0));
    for (const [cell, value] of effectCells(measure, districtIndex[decision.districtId], (HORIZON - lag) / HORIZON, multipliers[index] ?? 1)) cells[cell] += value;
  });
  for (const synergy of activeSynergies(decisions)) {
    const targets = synergy.districtId ? [districtIndex[synergy.districtId]] : DISTRICTS.map((_, index) => index);
    for (const target of targets) cells[target * K + indicatorIndex[synergy.indicator]] += synergy.bonus;
  }
  return cells;
}

export const costOf = (decisions) => decisions.reduce((sum, decision) => sum + (getMeasure(decision?.measureId)?.cost ?? 0), 0);

export function validate(decisions) {
  const errors = [];
  const list = Array.isArray(decisions) ? decisions.filter(Boolean) : [];
  if (list.length !== DECISIONS_REQUIRED) errors.push(`Нужно ровно ${DECISIONS_REQUIRED} решений, сейчас ${list.length}.`);
  const seen = new Set();
  for (const decision of list) {
    const measure = getMeasure(decision.measureId);
    if (!measure) { errors.push(`Неизвестное мероприятие: ${decision.measureId}.`); continue; }
    if (seen.has(measure.id)) errors.push(`«${measure.name}» выбрано повторно — каждое мероприятие можно взять только один раз.`);
    seen.add(measure.id);
    if (measure.scope === "district" && !getDistrict(decision.districtId)) errors.push(`Для «${measure.name}» нужно выбрать район.`);
    if (measure.scope === "city" && decision.districtId) errors.push(`«${measure.name}» — городская мера, район для неё не указывается.`);
  }
  for (const direction of DIRECTIONS) {
    const count = list.filter((decision) => getMeasure(decision.measureId)?.direction === direction.id).length;
    if (count > MAX_PER_DIRECTION) errors.push(`Направление «${direction.label}»: выбрано ${count} меры, допускается не более ${MAX_PER_DIRECTION}.`);
  }
  for (const conflict of CONFLICTS) {
    const [a, b] = conflict.measures.map((id) => list.find((decision) => decision.measureId === id));
    if (!a || !b) continue;
    const names = `«${getMeasure(a.measureId).name}» и «${getMeasure(b.measureId).name}»`;
    if (!conflict.sameDistrict) errors.push(`${names} несовместимы: ${conflict.reason}.`);
    else if (a.districtId && a.districtId === b.districtId && getDistrict(a.districtId)) errors.push(`${names} нельзя в одном районе (${getDistrict(a.districtId).name}): ${conflict.reason}.`);
  }
  const cost = costOf(list);
  if (cost > BUDGET) errors.push(`Бюджет превышен на ${cost - BUDGET} ед. (${cost} из ${BUDGET}).`);
  return errors;
}

export const scoreOf = (decisions) => scoreCells(applyDecisions(decisions)).score;
export let BASELINE = null;

// Производные таблицы модели: пересчитываются при загрузке и после каждого изменения настроек.
function refreshModel() {
  INDICATORS.forEach((indicator, k) => { WEIGHTS[k] = indicator.weight; });
  for (const key of Object.keys(measureIndex)) delete measureIndex[key];
  MEASURES.forEach((measure, index) => { measureIndex[measure.id] = index; });
  BASELINE = scoreCells(BASE_CELLS);
}
refreshModel();
onModelChange(refreshModel);

// Вклад по Шепли: средний прирост Score от меры по всем порядкам добавления.
// Сумма вкладов в точности равна изменению Score, включая синергии и штрафы.
export function shapley(decisions) {
  const n = decisions.length;
  const value = new Float64Array(1 << n);
  for (let mask = 0; mask < 1 << n; mask += 1) value[mask] = scoreOf(decisions.filter((_, index) => mask & (1 << index)));
  const factorial = [1, 1, 2, 6, 24, 120, 720];
  const bits = (mask) => mask.toString(2).replace(/0/g, "").length;
  return decisions.map((_, index) => {
    let total = 0;
    for (let mask = 0; mask < 1 << n; mask += 1) {
      if (mask & (1 << index)) continue;
      const size = bits(mask);
      total += (factorial[size] * factorial[n - size - 1] / factorial[n]) * (value[mask | (1 << index)] - value[mask]);
    }
    return total;
  });
}

function criticalList(cells) {
  const list = [];
  DISTRICTS.forEach((district, d) => INDICATORS.forEach((indicator, k) => {
    const value = Math.max(0, Math.min(100, cells[d * K + k]));
    if (value < SCORE_RULES.criticalThreshold) list.push({ districtId: district.id, indicator: indicator.id, value: round2(value) });
  }));
  return list;
}

function districtView(cells, scores) {
  return DISTRICTS.map((district, d) => ({
    id: district.id,
    name: district.name,
    share: district.share,
    score: round2(scores[d]),
    metrics: Object.fromEntries(INDICATORS.map((indicator, k) => [indicator.id, round2(Math.max(0, Math.min(100, cells[d * K + k])))])),
  }));
}

export function evaluate(decisions) {
  const list = (decisions ?? []).filter(Boolean);
  const errors = validate(list);
  if (errors.length) return { valid: false, errors, cost: costOf(list) };
  const cells = applyDecisions(list);
  const result = scoreCells(cells);
  const contributions = shapley(list);
  const cost = costOf(list);
  return {
    valid: true,
    budget: BUDGET,
    cost,
    remaining: BUDGET - cost,
    score: round2(result.score),
    exactScore: result.score,
    baseline: round2(BASELINE.score),
    delta: round2(result.score - BASELINE.score),
    components: {
      average: round2(result.average),
      weakest: round2(result.weakest),
      weakestDistrictId: DISTRICTS[result.weakestIndex].id,
      critical: result.critical,
      baselineAverage: round2(BASELINE.average),
      baselineWeakest: round2(BASELINE.weakest),
      baselineWeakestDistrictId: DISTRICTS[BASELINE.weakestIndex].id,
      baselineCritical: BASELINE.critical,
      shortfall: round2(result.shortfall),
      baselineShortfall: round2(BASELINE.shortfall),
    },
    critical: criticalList(cells),
    baselineCritical: criticalList(BASE_CELLS),
    before: districtView(BASE_CELLS, BASELINE.districtScores),
    after: districtView(cells, result.districtScores),
    synergies: activeSynergies(list),
    decisions: list.map((decision, index) => {
      const measure = getMeasure(decision.measureId);
      return {
        measureId: measure.id,
        districtId: decision.districtId ?? null,
        cost: measure.cost,
        realized: realizedShare(measure),
        contribution: round2(contributions[index]),
        exactContribution: contributions[index],
      };
    }),
  };
}

// Устойчивость: эффекты мер неточны (±20%), а каждая мера с вероятностью 25% запаздывает на квартал.
// Генератор с фиксированным зерном — у всех команд одинаковые «случайности».
export function robustness(decisions, runs = 400, seed = 2050) {
  // Порядок выбора и порядок мер в ссылке должны давать один и тот же прогноз.
  const ordered = [...decisions].sort((a, b) => measureIndex[a.measureId] - measureIndex[b.measureId]);
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const scores = [];
  for (let run = 0; run < runs; run += 1) {
    const multipliers = ordered.map(() => 0.8 + random() * 0.4);
    const lagDelays = ordered.map(() => (random() < 0.25 ? 1 : 0));
    scores.push(scoreCells(applyDecisions(ordered, { multipliers, lagDelays })).score);
  }
  scores.sort((a, b) => a - b);
  const at = (q) => round2(scores[Math.min(scores.length - 1, Math.floor(q * scores.length))]);
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9), worst: round2(scores[0]), runs };
}

// ---------- Городские события и страховка ----------
// Профильная мера — из списка события, стоящая в его районе или действующая на весь город.
export const eventMitigation = (event, decisions) => decisions.find((decision) => event.mitigatedBy.includes(decision.measureId) && (!decision.districtId || decision.districtId === event.districtId)) ?? null;

// Стоимость ликвидации события для конкретного набора: профильная мера удешевляет её на costReduction.
// Округляем вверх до целой единицы бюджета.
export function liquidationCost(event, decisions) {
  const mitigation = eventMitigation(event, decisions);
  const cost = mitigation ? Math.ceil(event.responseCost * (1 - event.costReduction) - 1e-9) : event.responseCost;
  return { cost, base: event.responseCost, mitigatedBy: mitigation?.measureId ?? null };
}

// Резерв, который нужно заложить под страховку. mode "one" — за 2 года случается одно событие (резерв —
// самая дорогая ликвидация), "all" — готовы ко всем отмеченным сразу (резерв — сумма).
export function requiredReserve(decisions, eventIds, mode = "one") {
  const costs = EVENTS.filter((event) => eventIds.includes(event.id)).map((event) => liquidationCost(event, decisions).cost);
  if (!costs.length) return 0;
  return mode === "all" ? costs.reduce((sum, cost) => sum + cost, 0) : Math.max(...costs);
}

export function insuranceStatus(decisions, insurance) {
  const required = requiredReserve(decisions, insurance?.events ?? [], insurance?.mode);
  const reserve = BUDGET - costOf(decisions);
  return { required, reserve, ok: reserve >= required, shortfall: Math.max(0, required - reserve) };
}

// Стресс-тест: каждое событие проверяется отдельно. Если резерва хватает на ликвидацию (с учётом
// удешевления профильной мерой) — ущерба нет. Иначе удар по району, ослабленный профильной мерой.
export function stressTest(decisions) {
  const cells = applyDecisions(decisions);
  const score = scoreCells(cells).score;
  const reserve = BUDGET - costOf(decisions);
  return EVENTS.map((event) => {
    const liquidation = liquidationCost(event, decisions);
    const factor = liquidation.mitigatedBy ? 1 - event.damageReduction : 1;
    const shocked = Float64Array.from(cells);
    const d = districtIndex[event.districtId];
    for (const [indicatorId, value] of Object.entries(event.shocks)) shocked[d * K + indicatorIndex[indicatorId]] += value * factor;
    const hitScore = scoreCells(shocked).score;
    const covered = reserve >= liquidation.cost;
    return {
      eventId: event.id,
      covered,
      mitigatedBy: liquidation.mitigatedBy,
      responseCost: liquidation.cost,
      baseCost: liquidation.base,
      shortfall: Math.max(0, liquidation.cost - reserve),
      scoreAfter: round2(covered ? score : hitScore),
      loss: round2(covered ? 0 : score - hitScore),
      lossIfIgnored: round2(score - hitScore),
    };
  });
}

// Компактная запись набора для ссылки: "M5.saryarka_M7.nura_M8.nura_M10.nura_M12" (порядок не важен).
export function encodeDecisions(decisions) {
  return [...decisions].filter(Boolean).sort((a, b) => measureIndex[a.measureId] - measureIndex[b.measureId])
    .map((decision) => (decision.districtId ? `${decision.measureId}.${decision.districtId}` : decision.measureId)).join("_");
}

export function decodeDecisions(text) {
  const parts = String(text ?? "").split("_").filter(Boolean);
  const decisions = parts.map((part) => {
    const [measureId, districtId] = part.split(".");
    return { measureId, districtId: districtId ?? null };
  });
  return decisions.length && !validate(decisions).length ? decisions : null;
}

export const sameDecision = (a, b) => a.measureId === b.measureId && (a.districtId ?? null) === (b.districtId ?? null);
export const changesBetween = (from, to) => to.filter((decision) => !from.some((other) => sameDecision(other, decision))).length;
