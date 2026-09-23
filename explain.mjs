import { BUDGET, DIRECTIONS, DISTRICTS, EVENTS, HORIZON, INDICATORS, SCORE_RULES, isOfficialModel } from "./data.mjs";
import { getDistrict, getIndicator, getMeasure, realizedShare } from "./engine.mjs";

// Объяснимый аналитик: превращает расчёт в выводы. Числа берутся только из результата модели.
const lowerFirst = (text) => (/^[А-ЯA-Z]{2}/.test(text) ? text : text[0].toLowerCase() + text.slice(1));
const fmt = (value, digits = 2) => Number(value).toFixed(digits).replace(/\.?0+$/, "");
const signed = (value, digits = 2) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${fmt(Math.abs(value), digits)}`;
const place = (decision) => (decision.districtId ? `в районе ${getDistrict(decision.districtId).name}` : "по всему городу");
const measureName = (id) => `«${getMeasure(id).name}»`;
const indicatorName = (id) => lowerFirst(getIndicator(id).short ?? getIndicator(id).name);
const label = (decision) => `${measureName(decision.measureId)} ${place(decision)}`;
const cellName = (item) => `${indicatorName(item.indicator)} в районе ${getDistrict(item.districtId).name}`;

export function analyze(result, { stress = [], robust = null, space = null, rank = null } = {}) {
  const strengths = [];
  const risks = [];
  const consequences = [];
  const tradeoffs = [];
  const byContribution = [...result.decisions].sort((a, b) => b.exactContribution - a.exactContribution);
  const top = byContribution[0];
  const weakestMeasure = byContribution[byContribution.length - 1];
  const totalGain = result.decisions.reduce((sum, decision) => sum + decision.exactContribution, 0);
  const before = Object.fromEntries(result.before.map((district) => [district.id, district]));

  // Сильные стороны
  if (top.exactContribution > 0) strengths.push(`Главный вклад — ${label(top)}: ${signed(top.contribution)} п. Score (${Math.round(top.exactContribution / totalGain * 100)}% всего прироста).`);
  const fixed = result.baselineCritical.filter((item) => !result.critical.some((after) => after.districtId === item.districtId && after.indicator === item.indicator));
  if (fixed.length) strengths.push(`Сняты критические значения: ${fixed.map((item) => `${cellName(item)} ${fmt(item.value)} → ${fmt(result.after.find((d) => d.id === item.districtId).metrics[item.indicator])}`).join("; ")}. Это ${fixed.length} п. штрафа, которые больше не вычитаются.`);
  const c = result.components;
  if (c.weakest > c.baselineWeakest) strengths.push(`Самый слабый район поднялся с ${fmt(c.baselineWeakest)} до ${fmt(c.weakest)} — эта часть весит ${Math.round(SCORE_RULES.weakestWeight * 100)}% формулы (${signed(SCORE_RULES.weakestWeight * (c.weakest - c.baselineWeakest))} п. Score).`);
  for (const synergy of result.synergies) strengths.push(`Сработала синергия ${synergy.measures.map(measureName).join(" + ")}: +${synergy.bonus} к показателю «${indicatorName(synergy.indicator)}» ${synergy.districtId ? `в районе ${getDistrict(synergy.districtId).name}` : "по городу"} (${synergy.note}).`);
  strengths.push(`Эффективность бюджета: ${fmt(totalGain / result.cost * 10)} п. Score на каждые 10 ед. (потрачено ${result.cost} из ${BUDGET}).`);
  if (rank) strengths.push(`Сценарий входит в лучшие ${fmt(Math.max(0.01, (1 - rank.share) * 100), 2)}% из ${rank.total.toLocaleString("ru-RU")} допустимых наборов (место ${rank.rank.toLocaleString("ru-RU")}).`);

  // Риски
  if (result.critical.length) risks.push(`Остались критические значения (<${SCORE_RULES.criticalThreshold}): ${result.critical.map((item) => `${cellName(item)} = ${fmt(item.value)}`).join("; ")}. Каждое отнимает ${SCORE_RULES.criticalPenalty} п.`);
  const nearCritical = result.after.flatMap((district) => Object.entries(district.metrics).filter(([, value]) => value >= 40 && value < 43).map(([indicator, value]) => ({ districtId: district.id, indicator, value })));
  if (nearCritical.length) risks.push(`На грани критического порога: ${nearCritical.map((item) => `${cellName(item)} = ${fmt(item.value)}`).join("; ")}. Небольшое ухудшение даст штраф −1.`);
  if (c.weakestDistrictId !== c.baselineWeakestDistrictId) risks.push(`Слабейшим районом теперь стал ${getDistrict(c.weakestDistrictId).name} (${fmt(c.weakest)}): дальнейшие вложения в ${getDistrict(c.baselineWeakestDistrictId).name} уже не поднимут ${Math.round(SCORE_RULES.weakestWeight * 100)}%-ную часть Score.`);
  if (weakestMeasure.exactContribution < 0.25 && byContribution.length > 1) risks.push(`${label(weakestMeasure)} почти не влияет на Score (${signed(weakestMeasure.contribution)} п. за ${getMeasure(weakestMeasure.measureId).cost} ед.) — кандидат на замену.`);
  const slow = result.decisions.filter((decision) => getMeasure(decision.measureId).lag >= 3);
  if (slow.length) risks.push(`Долгий запуск: ${slow.map((decision) => `${measureName(decision.measureId)} (запуск через ${getMeasure(decision.measureId).lag} кв., за ${HORIZON / 4} года — ${Math.round(realizedShare(getMeasure(decision.measureId)) * 100)}% эффекта)`).join(", ")}. Часть результата придёт уже после горизонта симуляции.`);
  const negative = result.decisions.filter((decision) => Object.values(getMeasure(decision.measureId).effects).some((value) => value < 0));
  for (const decision of negative) {
    const [indicator, value] = Object.entries(getMeasure(decision.measureId).effects).find(([, v]) => v < 0);
    risks.push(`Побочный эффект: ${label(decision)} снижает показатель «${indicatorName(indicator)}» на ${fmt(Math.abs(value * realizedShare(getMeasure(decision.measureId))))}.`);
  }
  const uncovered = stress.filter((event) => !event.covered && event.lossIfIgnored > 0.05);
  if (stress.length) {
    const worst = [...stress].sort((a, b) => b.loss - a.loss)[0];
    if (uncovered.length) risks.push(`Резерв ${result.remaining} ед. не покрывает ${uncovered.length} из ${stress.length} событий стресс-теста; худшее — «${EVENTS.find((e) => e.id === worst.eventId).name}» (−${fmt(worst.loss)} п.).`);
  }
  if (SCORE_RULES.lagPenalty && c.shortfall > 0) {
    const lagging = result.after.filter((district) => district.score < SCORE_RULES.districtTarget);
    risks.push(`Отстающие районы ниже порога ${fmt(SCORE_RULES.districtTarget)}: ${lagging.map((district) => `${district.name} (${fmt(district.score)})`).join(", ")}. Штраф за отставание — −${fmt(SCORE_RULES.lagPenalty * c.shortfall)} п. Score.`);
  }
  if (robust && robust.p90 - robust.p10 > 0.4) risks.push(`Результат чувствителен к срокам и точности реализации: в 80% симуляций Score между ${fmt(robust.p10)} и ${fmt(robust.p90)}.`);

  // Последствия для жителей
  const changes = result.after.map((district) => ({ district, delta: district.score - before[district.id].score })).sort((a, b) => b.delta - a.delta);
  for (const { district, delta } of changes) {
    if (Math.abs(delta) < 0.005) { consequences.push(`${district.name} (${Math.round(district.share * 100)}% жителей): без изменений — ${fmt(district.score)}.`); continue; }
    const moved = INDICATORS.map((indicator) => ({ indicator, delta: district.metrics[indicator.id] - before[district.id].metrics[indicator.id] }))
      .filter((item) => Math.abs(item.delta) >= 0.5).sort((a, b) => b.delta - a.delta).slice(0, 3)
      .map((item) => `${indicatorName(item.indicator.id)} ${signed(item.delta)}`);
    consequences.push(`${district.name} (${Math.round(district.share * 100)}% жителей): оценка ${fmt(before[district.id].score)} → ${fmt(district.score)} (${signed(delta)}). ${moved.length ? `Заметнее всего: ${moved.join(", ")}.` : "Изменения точечные."}`);
  }
  const reached = changes.filter((item) => item.delta >= 0.5).reduce((sum, item) => sum + item.district.share, 0);
  consequences.push(`Ощутимые улучшения (≥0,5 п. оценки района) получат ${Math.round(reached * 100)}% жителей города.`);

  // Компромиссы
  tradeoffs.push(`Средняя по жителям оценка ${fmt(c.baselineAverage)} → ${fmt(c.average)}, слабейший район ${fmt(c.baselineWeakest)} → ${fmt(c.weakest)}: формула на ${Math.round(SCORE_RULES.averageWeight * 100)}% награждает «средний» результат и на ${Math.round(SCORE_RULES.weakestWeight * 100)}% — помощь отстающим.`);
  if (space) {
    const gap = space.best.score - result.score;
    if (gap > 0.005) tradeoffs.push(`Математический максимум модели — ${fmt(space.best.score)} за ${space.best.cost} ед.; ваш сценарий уступает ${fmt(gap)} п. Экономный вариант даёт ${fmt(space.alternatives.economical.score)} за ${space.alternatives.economical.cost} ед. и оставляет резерв ${BUDGET - space.alternatives.economical.cost} ед. на события.`);
    else tradeoffs.push(`Сценарий совпадает с глобальным максимумом модели (он найден полным перебором${isOfficialModel() ? " и доказан Z3" : ""}).`);
  }
  if (result.remaining > 0) tradeoffs.push(`Остаток ${result.remaining} ед. не даёт бонуса к Score, но работает как резерв: им можно закрыть городское событие без пересмотра решений.`);

  return { strengths, risks, consequences, tradeoffs };
}

// Компактный набор фактов для LLM: все числа уже посчитаны моделью.
export function explanationFacts(result, { stress = [], robust = null, space = null, rank = null } = {}) {
  return {
    rules: scoreFormulaText(),
    score: result.score,
    baseline: result.baseline,
    delta: result.delta,
    cost: result.cost,
    remaining: result.remaining,
    components: result.components,
    decisions: result.decisions.map((decision) => ({
      name: getMeasure(decision.measureId).name,
      direction: DIRECTIONS.find((direction) => direction.id === getMeasure(decision.measureId).direction).label,
      district: decision.districtId ? getDistrict(decision.districtId).name : "весь город",
      cost: decision.cost,
      lag: getMeasure(decision.measureId).lag,
      realizedPercent: Math.round(decision.realized * 100),
      contributionToScore: decision.contribution,
    })),
    synergies: result.synergies.map((synergy) => ({ pair: synergy.measures.map((id) => getMeasure(id).name).join(" + "), indicator: getIndicator(synergy.indicator).name, bonus: synergy.bonus, district: synergy.districtId ? getDistrict(synergy.districtId).name : "город" })),
    districts: result.after.map((district) => ({
      name: district.name,
      populationPercent: Math.round(district.share * 100),
      before: result.before.find((item) => item.id === district.id).score,
      after: district.score,
    })),
    criticalBefore: result.baselineCritical.map((item) => ({ district: getDistrict(item.districtId).name, indicator: getIndicator(item.indicator).name, value: item.value })),
    criticalAfter: result.critical.map((item) => ({ district: getDistrict(item.districtId).name, indicator: getIndicator(item.indicator).name, value: item.value })),
    rank: rank && { place: rank.rank, total: rank.total, topPercent: Number(((1 - rank.share) * 100).toFixed(2)) },
    optimum: space && { score: space.best.score, cost: space.best.cost, economicalScore: space.alternatives.economical.score, economicalCost: space.alternatives.economical.cost },
    robustness: robust && { p10: robust.p10, p50: robust.p50, p90: robust.p90 },
    stressTest: stress.map((event) => ({ event: EVENTS.find((item) => item.id === event.eventId).name, covered: event.covered, loss: event.loss, responseCost: event.responseCost })),
  };
}

export { fmt, signed, label, indicatorName, measureName };
export const directionOf = (measureId) => DIRECTIONS.find((direction) => direction.id === getMeasure(measureId).direction);
export const districtName = (id) => DISTRICTS.find((district) => district.id === id)?.name ?? "город";

// Формула Score словами — по текущим настройкам модели.
export function scoreFormulaText(rules = SCORE_RULES) {
  const lag = rules.lagPenalty ? ` − ${rules.lagPenalty} × сумма отставаний районов от порога ${rules.districtTarget}` : "";
  return `Score = ${rules.averageWeight} × средняя по населению оценка районов + ${rules.weakestWeight} × оценка самого слабого района − ${rules.criticalPenalty} × число показателей ниже ${rules.criticalThreshold}${lag}.`;
}
