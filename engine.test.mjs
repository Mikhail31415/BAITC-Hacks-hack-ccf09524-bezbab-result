import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUDGET, EVENTS, MEASURES, OFFICIAL_MODEL, applyModel, isOfficialModel, validateModel } from "./data.mjs";
import * as engine from "./engine.mjs";
import { BASELINE, changesBetween, costOf, insuranceStatus, liquidationCost, requiredReserve, decodeDecisions, encodeDecisions, evaluate, robustness, scoreOf, stressTest, validate } from "./engine.mjs";
import { STRATEGY_DEFS, analyzeSpace, bestSingleChange, enumerate, reallocate } from "./optimizer.mjs";

// Те же утверждения проверяют Z3 (verification/z3_verify.py) и Lean (verification/lean/AkimScore.lean).
const expected = JSON.parse(readFileSync(new URL("./verification/expected.json", import.meta.url), "utf-8"));
const close = (actual, claimed, message) => assert.ok(Math.abs(actual - Number(claimed)) < 1e-9, `${message}: ${actual} ≠ ${claimed}`);
const example = decodeDecisions(expected.example.code);

test("baseline Score matches the task statement (52.56)", () => {
  close(BASELINE.score, expected.baseline, "база");
  assert.equal(BASELINE.critical, 2);
});

test("example from the task: valid, costs 95, Score ≈ 56.5, synergy M10+M12", () => {
  assert.deepEqual(validate(example), []);
  const result = evaluate(example);
  assert.equal(result.cost, expected.example.cost);
  close(result.exactScore, expected.example.score, "пример");
  assert.deepEqual(result.synergies.map((s) => s.measures.join("+")), ["M10+M12"]);
});

test("the cheapest valid set costs 61", () => {
  const cheapest = decodeDecisions(expected.cheapest.code);
  assert.deepEqual(validate(cheapest), []);
  assert.equal(costOf(cheapest), 61);
  let minimum = Infinity;
  enumerate((score, cost) => { minimum = Math.min(minimum, cost); });
  assert.equal(minimum, 61);
});

test("validator rejects every rule violation with a reason", () => {
  const four = example.slice(0, 4);
  assert.match(validate(four).join(" "), /ровно 5/);
  assert.match(validate([...four, { measureId: "M7", districtId: "esil" }]).join(" "), /повторно/);
  assert.match(validate([...four, { measureId: "M9", districtId: null }]).join(" "), /нужно выбрать район/);
  assert.match(validate([...four, { measureId: "M14", districtId: "nura" }]).join(" "), /район для неё не указывается/);
  assert.match(validate([...four, { measureId: "M9", districtId: "nura" }]).join(" "), /не более 2/);
  const transport = [{ measureId: "M1", districtId: "nura" }, { measureId: "M3", districtId: "esil" }, { measureId: "M9", districtId: "nura" }, { measureId: "M11", districtId: "nura" }, { measureId: "M12", districtId: null }];
  assert.match(validate(transport).join(" "), /либо BRT, либо ЛРТ/);
  const land = [{ measureId: "M4", districtId: "nura" }, { measureId: "M7", districtId: "nura" }, { measureId: "M9", districtId: "esil" }, { measureId: "M11", districtId: "nura" }, { measureId: "M12", districtId: null }];
  assert.match(validate(land).join(" "), /нельзя в одном районе/);
  assert.equal(validate(land.map((d) => (d.measureId === "M4" ? { ...d, districtId: "esil" } : d))).length, 0);
  const expensive = [{ measureId: "M3", districtId: "nura" }, { measureId: "M13", districtId: "almaty" }, { measureId: "M7", districtId: "esil" }, { measureId: "M5", districtId: "saryarka" }, { measureId: "M2", districtId: null }];
  assert.match(validate(expensive).join(" "), /Бюджет превышен/);
  assert.equal(evaluate(expensive).valid, false);
});

test("order of decisions does not matter; changing a decision changes the Score", () => {
  assert.equal(scoreOf([...example].reverse()), scoreOf(example));
  const changed = example.map((d) => (d.measureId === "M5" ? { measureId: "M5", districtId: "almaty" } : d));
  assert.notEqual(scoreOf(changed), scoreOf(example));
});

test("Shapley contributions sum exactly to the Score change", () => {
  const result = evaluate(example);
  const total = result.decisions.reduce((sum, d) => sum + d.exactContribution, 0);
  assert.ok(Math.abs(total - (result.exactScore - BASELINE.score)) < 1e-9);
});

test("share code round-trips and rejects invalid sets", () => {
  assert.deepEqual(scoreOf(decodeDecisions(encodeDecisions(example))), scoreOf(example));
  assert.equal(decodeDecisions("M1.nura_M3.esil_M9.nura_M11.nura_M12"), null);
  assert.equal(decodeDecisions("garbage"), null);
});

test("unknown districts in conflicting measures reject share codes without throwing", () => {
  assert.equal(decodeDecisions("M4.unknown_M7.unknown_M9.nura_M11.nura_M12"), null);
  assert.equal(decodeDecisions("M5.unknown_M13.unknown_M9.nura_M11.nura_M12"), null);
  const invalid = example.map((decision) => ({ ...decision, districtId: decision.districtId ? "unknown" : null }));
  assert.equal(evaluate(invalid).valid, false);
});

test("optimizer: exhaustive count, global optimum and Pareto frontier match the verified claims", () => {
  const space = analyzeSpace();
  assert.equal(space.count, expected.validCount);
  close(scoreOf(space.best.decisions), expected.optimum.score, "оптимум");
  assert.equal(space.best.cost, expected.optimum.cost);
  assert.deepEqual(space.pareto.map((p) => p.cost), expected.pareto.map((p) => p.maxCost));
  space.pareto.forEach((point, index) => close(scoreOf(point.decisions), expected.pareto[index].score, `Парето ${point.cost}`));
  for (const option of Object.values(space.alternatives)) assert.deepEqual(validate(option.decisions), []);
});

test("single-change advice improves the Score by changing exactly one decision", () => {
  const advice = bestSingleChange(example);
  assert.ok(advice && advice.score > evaluate(example).score);
  assert.deepEqual(validate(advice.decisions), []);
  assert.equal(advice.decisions.filter((d, i) => d.measureId !== example[i].measureId || d.districtId !== example[i].districtId).length, 1);
});

test("stress test: a reserve covers events, the reallocation fits the budget", () => {
  const economical = decodeDecisions(expected.pareto.find((p) => p.maxCost === 86).code);
  assert.ok(stressTest(economical).every((event) => event.covered));
  // Пример из ТЗ: резерв 5 ед. Профильные меры удешевляют ликвидацию вдвое: ДТП в Нуре (освещение и камеры
  // в Нуре) 8 → 4 и смог в Сарыарке (чистое топливо там же) 10 → 5 — резерва хватает. Авария и школы — нет.
  const stress = Object.fromEntries(stressTest(example).map((event) => [event.eventId, event]));
  assert.equal(stress.crash.responseCost, 4);
  assert.equal(stress.smog.responseCost, 5);
  assert.ok(stress.crash.covered && stress.smog.covered);
  assert.ok(!stress.heat.covered && !stress.school.covered);
  const heat = EVENTS.find((event) => event.id === "heat");
  const plan = reallocate(example, heat.id);
  assert.ok(plan.options.length > 0);
  for (const option of plan.options) {
    assert.deepEqual(validate(option.decisions), []);
    assert.ok(option.cost + option.liquidation <= BUDGET);
  }
});

test("robustness simulation is deterministic and brackets the Score", () => {
  const a = robustness(example);
  assert.deepEqual(a, robustness(example));
  assert.ok(a.p10 <= a.p50 && a.p50 <= a.p90);
});

test("robustness is unchanged by selection order and sharing", () => {
  const reversed = [...example].reverse();
  const originalOrder = reversed.map((decision) => decision.measureId);
  const result = robustness(reversed);
  assert.deepEqual(result, robustness(example));
  assert.deepEqual(result, robustness(decodeDecisions(encodeDecisions(reversed))));
  assert.deepEqual(reversed.map((decision) => decision.measureId), originalOrder);
});

test("model settings: formula, weights, new measures, conflicts and synergies apply; reset restores the task model", () => {
  const model = structuredClone(OFFICIAL_MODEL);
  try {
    // Штраф за отставание: районы ниже порога 55 (Нура, Сарыарка) снижают Score сильнее.
    model.scoreRules.lagPenalty = 0.5;
    applyModel(model);
    assert.equal(isOfficialModel(), false);
    assert.ok(engine.BASELINE.score < Number(expected.baseline) - 1);
    model.scoreRules.lagPenalty = 0;

    // Веса: сумма ≠ 1 — предупреждение, отрицательный вес — ошибка.
    model.weights.S2 = 0.5;
    assert.ok(validateModel(model).warnings.some((w) => w.includes("Сумма весов")));
    model.weights.S2 = -1;
    assert.ok(validateModel(model).errors.length > 0);
    model.weights.S2 = 0.11;

    // Новая мера, взаимоисключение и синергия.
    model.measures.push({ id: "M15", direction: "service", name: "Тестовая мера", scope: "city", cost: 5, lag: 0, effects: { C1: 4 } });
    model.conflicts.push({ measures: ["M15", "M12"], sameDistrict: false, reason: "тест" });
    model.synergies.push({ measures: ["M15", "M14"], indicator: "C1", bonus: 3, note: "" });
    assert.deepEqual(validateModel(model).errors, []);
    applyModel(model);
    const withNew = [{ measureId: "M7", districtId: "nura" }, { measureId: "M8", districtId: "nura" }, { measureId: "M10", districtId: "nura" }, { measureId: "M14", districtId: null }, { measureId: "M15", districtId: null }];
    assert.deepEqual(validate(withNew), []);
    assert.match(validate([...example.filter((d) => d.measureId !== "M5"), { measureId: "M15", districtId: null }]).join(" "), /несовместимы/);
    assert.deepEqual(evaluate(withNew).synergies.map((s) => s.measures.join("+")), ["M15+M14"]);
    const space = analyzeSpace();
    assert.ok(space.count > expected.validCount);
    assert.deepEqual(validate(space.best.decisions), []);

    // Некорректная модель не проходит проверку.
    assert.ok(validateModel({ ...model, measures: [...model.measures, { ...model.measures[0] }] }).errors.some((e) => e.includes("повторяется")));
  } finally {
    applyModel(OFFICIAL_MODEL);
  }
  assert.equal(isOfficialModel(), true);
  close(engine.BASELINE.score, expected.baseline, "база после сброса");
  assert.equal(analyzeSpace().count, expected.validCount);
});

test("optimizer proposes 5 distinct valid strategies, each meeting its own priority", () => {
  const space = analyzeSpace();
  assert.equal(space.strategies.length, STRATEGY_DEFS.length);
  const byId = Object.fromEntries(space.strategies.map((strategy) => [strategy.id, strategy]));
  for (const strategy of space.strategies) assert.deepEqual(validate(strategy.decisions), []);
  space.strategies.forEach((a, i) => space.strategies.slice(i + 1).forEach((b) => assert.ok(changesBetween(a.decisions, b.decisions) >= 2, `${a.id} и ${b.id} почти совпадают`)));
  close(byId.max.exactScore, expected.optimum.score, "стратегия максимума");
  assert.ok(stressTest(byId.reserve.decisions).every((event) => event.covered), "резервная стратегия закрывает все события");
  assert.ok(byId.weakest.weakest >= byId.max.weakest, "поддержка отстающих поднимает слабейший район не хуже максимума");
  assert.ok(byId.everyone.minGain >= byId.max.minGain, "улучшения для всех — наименьший прирост не хуже максимума");
  assert.ok(byId.fast.decisions.every((decision) => MEASURES.find((m) => m.id === decision.measureId).lag <= 2), "быстрый эффект — только быстрые меры");
});

test("insurance: mitigating measures make liquidation cheaper and strategies are recomputed under the reserve", () => {
  const heat = EVENTS.find((event) => event.id === "heat");
  assert.equal(liquidationCost(heat, []).cost, 12);
  assert.equal(liquidationCost(heat, [{ measureId: "M14", districtId: null }]).cost, 6, "городские аварийные бригады удешевляют ликвидацию");
  assert.equal(liquidationCost(heat, [{ measureId: "M13", districtId: "esil" }]).cost, 12, "модернизация сетей в другом районе не помогает");
  assert.equal(requiredReserve([], ["heat", "crash"], "one"), 12);
  assert.equal(requiredReserve([], ["heat", "crash"], "all"), 20);

  const free = analyzeSpace();
  const insured = analyzeSpace({ insurance: { events: ["heat"], mode: "one" } });
  assert.ok(insured.insurance.feasible < free.count);
  assert.equal(insured.count, free.count, "распределение и ранги считаются по всему пространству");
  for (const strategy of insured.strategies) {
    assert.deepEqual(validate(strategy.decisions), []);
    assert.ok(insuranceStatus(strategy.decisions, { events: ["heat"], mode: "one" }).ok, `${strategy.id}: резерв под страховку`);
  }
  const max = insured.strategies.find((strategy) => strategy.id === "max");
  assert.ok(max.exactScore <= free.strategies.find((strategy) => strategy.id === "max").exactScore);
  assert.ok(requiredReserve(max.decisions, ["heat"]) < 12, "оптимум под страховкой использует меру, удешевляющую ликвидацию");

  const all = analyzeSpace({ insurance: { events: EVENTS.map((event) => event.id), mode: "all" } });
  assert.ok(all.insurance.feasible < insured.insurance.feasible);
  for (const strategy of all.strategies) assert.ok(insuranceStatus(strategy.decisions, { events: EVENTS.map((event) => event.id), mode: "all" }).ok);
});
