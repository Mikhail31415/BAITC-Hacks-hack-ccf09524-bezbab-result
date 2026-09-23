// Синтетический датасет хакатона. Все показатели 0–100, больше — лучше.
// Проблемы (пробки, смог) уже «перевёрнуты»: 100 = проблемы нет.

export const BUDGET = 100;
export const DECISIONS_REQUIRED = 5;
export const MAX_PER_DIRECTION = 2;
export const HORIZON = 8; // кварталов, то есть 2 условных года

export const SCORE_RULES = {
  averageWeight: 0.7, // доля средневзвешенной по населению оценки города
  weakestWeight: 0.3, // доля оценки самого слабого района
  criticalThreshold: 40, // значение строго ниже — критическое
  criticalPenalty: 1, // штраф за каждую пару «район × показатель»
  // Расширение для опытных пользователей, в ТЗ выключено (lagPenalty = 0):
  // каждый район с оценкой ниже districtTarget снижает Score на lagPenalty × (districtTarget − D_d).
  districtTarget: 55,
  lagPenalty: 0,
};

export const DIRECTIONS = [
  { id: "transport", label: "Транспорт", icon: "↗", color: "#d8613b" },
  { id: "ecology", label: "Экология", icon: "✳", color: "#528d68" },
  { id: "social", label: "Соцсфера", icon: "⌂", color: "#6675b5" },
  { id: "safety", label: "Безопасность", icon: "◇", color: "#b07a2a" },
  { id: "service", label: "Сервисы", icon: "◉", color: "#4f8193" },
];

export const INDICATORS = [
  { id: "T1", direction: "transport", name: "Разгрузка дорог", weight: 0.1, meaning: "100 — нет пробок в час пик, 0 — стоит всё", short: "Разгрузка дорог" },
  { id: "T2", direction: "transport", name: "Доступность общественного транспорта", weight: 0.1, meaning: "100 — все жители в 500 м от остановки с интервалом ≤10 мин", short: "Общественный транспорт" },
  { id: "E1", direction: "ecology", name: "Озеленение", weight: 0.09, meaning: "100 — ≥20 м² зелени на жителя", short: "Озеленение" },
  { id: "E2", direction: "ecology", name: "Качество воздуха", weight: 0.11, meaning: "100 — зимой AQI ≤50, 0 — хронический смог", short: "Чистый воздух" },
  { id: "S1", direction: "social", name: "Школы и детсады", weight: 0.11, meaning: "100 — 100% нормативной потребности, без второй смены", short: "Школы и детсады" },
  { id: "S2", direction: "social", name: "Поликлиники и первичная медпомощь", weight: 0.11, meaning: "100 — норматив на жителя выполнен полностью", short: "Поликлиники" },
  { id: "B1", direction: "safety", name: "Безопасность улиц", weight: 0.09, meaning: "100 — освещение и камеры везде, минимум происшествий", short: "Безопасность улиц" },
  { id: "B2", direction: "safety", name: "Безопасность дорожного движения", weight: 0.09, meaning: "100 — минимум ДТП с пострадавшими", short: "Безопасность на дорогах" },
  { id: "C1", direction: "service", name: "Надёжность ЖКХ", weight: 0.1, meaning: "100 — нет аварий отопления и воды за год", short: "Надёжность ЖКХ" },
  { id: "C2", direction: "service", name: "Скорость решения обращений", weight: 0.1, meaning: "100 — все обращения закрыты в срок", short: "Обращения жителей" },
];

export const DISTRICTS = [
  { id: "esil", name: "Есиль", share: 0.27, profile: "Богатый, но с пробками на мостах и переполненными школами.", metrics: { T1: 45, T2: 62, E1: 68, E2: 72, S1: 48, S2: 55, B1: 78, B2: 60, C1: 75, C2: 70 } },
  { id: "almaty", name: "Алматы", share: 0.24, profile: "Старое ЖКХ и пробки.", metrics: { T1: 40, T2: 75, E1: 50, E2: 55, S1: 60, S2: 65, B1: 62, B2: 52, C1: 50, C2: 60 } },
  { id: "saryarka", name: "Сарыарка", share: 0.2, profile: "Смог от частного сектора, слабое озеленение.", metrics: { T1: 50, T2: 70, E1: 42, E2: 40, S1: 62, S2: 68, B1: 58, B2: 55, C1: 45, C2: 55 } },
  { id: "baikonur", name: "Байконур", share: 0.13, profile: "Середняк без ярких перекосов.", metrics: { T1: 52, T2: 68, E1: 55, E2: 50, S1: 58, S2: 60, B1: 52, B2: 58, C1: 55, C2: 58 } },
  { id: "nura", name: "Нура", share: 0.16, profile: "Главный аутсайдер по соцсфере и транспорту.", metrics: { T1: 55, T2: 40, E1: 45, E2: 65, S1: 38, S2: 35, B1: 55, B2: 50, C1: 60, C2: 50 } },
];

// scope: "district" — эффект в одном выбранном районе, "city" — во всех пяти.
// lag — через сколько кварталов мера начинает работать; реализуется доля (HORIZON − lag) / HORIZON.
export const MEASURES = [
  { id: "M1", direction: "transport", name: "Выделенные полосы для автобусов", scope: "district", cost: 18, lag: 2, effects: { T1: 6, T2: 9 } },
  { id: "M2", direction: "transport", name: "Умные светофоры (адаптивное управление)", scope: "city", cost: 22, lag: 2, effects: { T1: 4, B2: 3 } },
  { id: "M3", direction: "transport", name: "Линия ЛРТ / расширение", scope: "district", cost: 30, lag: 4, effects: { T1: 16, T2: 20, E2: 4 } },
  { id: "M4", direction: "ecology", name: "Парк / сквер", scope: "district", cost: 15, lag: 2, effects: { E1: 12, E2: 3, B1: 2 } },
  { id: "M5", direction: "ecology", name: "Перевод частного сектора на чистое топливо", scope: "district", cost: 25, lag: 3, effects: { E2: 14, C1: 4 } },
  { id: "M6", direction: "ecology", name: "Городская программа озеленения и ветрозащитных полос", scope: "city", cost: 20, lag: 4, effects: { E1: 5, E2: 3 } },
  { id: "M7", direction: "social", name: "Школа + детсад (модульное строительство)", scope: "district", cost: 24, lag: 3, effects: { S1: 16 } },
  { id: "M8", direction: "social", name: "Центр семейного здоровья / поликлиника", scope: "district", cost: 20, lag: 3, effects: { S2: 14 } },
  { id: "M9", direction: "social", name: "Дворовые спорт-хабы", scope: "district", cost: 10, lag: 1, effects: { S1: 3, S2: 3, B1: 3 } },
  { id: "M10", direction: "safety", name: "Освещение и камеры (расширение Safe City)", scope: "district", cost: 12, lag: 1, effects: { B1: 12, B2: 2 } },
  { id: "M11", direction: "safety", name: "Безопасные переходы и школьные зоны", scope: "district", cost: 10, lag: 1, effects: { B2: 12, T1: -2 } },
  { id: "M12", direction: "service", name: "Единая цифровая платформа обращений", scope: "city", cost: 14, lag: 1, effects: { C2: 5 } },
  { id: "M13", direction: "service", name: "Модернизация тепло- и водосетей", scope: "district", cost: 28, lag: 4, effects: { C1: 18, E2: 2 } },
  { id: "M14", direction: "service", name: "Аварийные бригады ЖКХ + раннее оповещение", scope: "city", cost: 16, lag: 1, effects: { C1: 5, C2: 2 } },
];

// Фиксированный бонус, лагом не масштабируется. Даётся в районе первой меры пары.
export const SYNERGIES = [
  { measures: ["M1", "M2"], indicator: "T1", bonus: 2, note: "автобусные полосы работают лучше с адаптивными светофорами" },
  { measures: ["M10", "M12"], indicator: "B1", bonus: 2, note: "жалобы с платформы помогают расставлять камеры и свет" },
  { measures: ["M5", "M6"], indicator: "E2", bonus: 2, note: "чистое топливо и ветрозащитные полосы вместе снижают смог" },
];

// sameDistrict: false — пара запрещена в любых районах.
export const CONFLICTS = [
  { measures: ["M1", "M3"], sameDistrict: false, reason: "либо BRT, либо ЛРТ" },
  { measures: ["M4", "M7"], sameDistrict: true, reason: "конфликт за земельный участок" },
  { measures: ["M5", "M13"], sameDistrict: true, reason: "дублирование программы" },
];

// Городские события — расширение для опционального пункта задачи. На официальный Score не влияют.
// Событие бьёт по показателям района; ликвидация (responseCost) оплачивается из резерва бюджета.
// Если в наборе есть профильная мера (в районе события или городская), ликвидация дешевле на costReduction,
// а удар слабее на damageReduction. Страховка: резерв под отмеченные события закладывается заранее.
export const EVENTS = [
  { id: "heat", name: "Авария на теплотрассе зимой", districtId: "almaty", shocks: { C1: -12, C2: -4 }, responseCost: 12, mitigatedBy: ["M13", "M14"], costReduction: 0.5, damageReduction: 0.5, text: "Старые сети Алматы не выдержали морозов: без отопления остались кварталы." },
  { id: "smog", name: "Смоговый эпизод", districtId: "saryarka", shocks: { E2: -10 }, responseCost: 10, mitigatedBy: ["M5", "M6"], costReduction: 0.5, damageReduction: 0.5, text: "Безветренная неделя и печи частного сектора — AQI выше 200." },
  { id: "school", name: "Всплеск набора в первые классы", districtId: "esil", shocks: { S1: -10 }, responseCost: 14, mitigatedBy: ["M7", "M9"], costReduction: 0.5, damageReduction: 0.5, text: "Новые ЖК сдали раньше срока — школы уходят в третью смену." },
  { id: "crash", name: "Серия ДТП у школ", districtId: "nura", shocks: { B2: -12, B1: -3 }, responseCost: 8, mitigatedBy: ["M11", "M10"], costReduction: 0.5, damageReduction: 0.5, text: "Три ДТП с детьми за месяц — прокуратура требует срочных мер." },
];

// ---------- Настраиваемая модель ----------
// Мероприятия, веса, синергии, взаимоисключения и формулу можно менять в «Настройках модели».
// Массивы выше меняются на месте, а движок и оптимизатор перестраивают свои таблицы через onModelChange.

const effectOrder = (effects) => Object.fromEntries(INDICATORS.filter((indicator) => Number(effects?.[indicator.id])).map((indicator) => [indicator.id, Number(effects[indicator.id])]));

function snapshotModel() {
  return structuredClone({
    measures: MEASURES,
    weights: Object.fromEntries(INDICATORS.map((indicator) => [indicator.id, indicator.weight])),
    synergies: SYNERGIES,
    conflicts: CONFLICTS,
    scoreRules: SCORE_RULES,
    events: EVENTS,
  });
}

export const OFFICIAL_MODEL = snapshotModel();
export const currentModel = () => snapshotModel();

const listeners = [];
export const onModelChange = (listener) => { listeners.push(listener); };

export function applyModel(model) {
  MEASURES.splice(0, MEASURES.length, ...structuredClone(model.measures).map((measure) => ({ ...measure, effects: effectOrder(measure.effects) })));
  for (const indicator of INDICATORS) indicator.weight = Number(model.weights[indicator.id]);
  SYNERGIES.splice(0, SYNERGIES.length, ...structuredClone(model.synergies));
  CONFLICTS.splice(0, CONFLICTS.length, ...structuredClone(model.conflicts));
  Object.assign(SCORE_RULES, structuredClone(model.scoreRules));
  EVENTS.splice(0, EVENTS.length, ...structuredClone(model.events ?? OFFICIAL_MODEL.events));
  for (const listener of listeners) listener();
}

// Отпечаток математики модели (без названий и пояснений): по нему видно, совпадает ли модель с ТЗ.
export function modelFingerprint(model = currentModel()) {
  return JSON.stringify({
    measures: model.measures.map((m) => [m.id, m.direction, m.scope, m.cost, m.lag, effectOrder(m.effects)]),
    weights: INDICATORS.map((indicator) => Number(model.weights[indicator.id])),
    synergies: model.synergies.map((s) => [...s.measures, s.indicator, Number(s.bonus)]),
    conflicts: model.conflicts.map((c) => [...c.measures, Boolean(c.sameDistrict)]),
    scoreRules: ["averageWeight", "weakestWeight", "criticalThreshold", "criticalPenalty", "districtTarget", "lagPenalty"].map((key) => Number(model.scoreRules[key])),
  });
}
export const isOfficialModel = (model = currentModel()) => modelFingerprint(model) === modelFingerprint(OFFICIAL_MODEL);

// События на Score не влияют, поэтому в отпечаток ТЗ не входят. Полный отпечаток нужен воркеру,
// чтобы он получил и изменения событий.
const eventsFingerprint = (events) => JSON.stringify((events ?? OFFICIAL_MODEL.events).map((e) => [e.id, e.districtId, effectOrder(e.shocks), Number(e.responseCost), e.mitigatedBy, Number(e.costReduction), Number(e.damageReduction)]));
export const fullModelFingerprint = (model = currentModel()) => modelFingerprint(model) + eventsFingerprint(model.events);
export const eventsChanged = (model = currentModel()) => eventsFingerprint(model.events) !== eventsFingerprint(OFFICIAL_MODEL.events);

// Проверка изменённой модели: ошибки блокируют применение, предупреждения — нет.
export function validateModel(model) {
  const errors = [];
  const warnings = [];
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const ids = new Set();
  if (!Array.isArray(model.measures) || model.measures.length < DECISIONS_REQUIRED) errors.push(`Нужно не меньше ${DECISIONS_REQUIRED} мероприятий.`);
  for (const measure of model.measures ?? []) {
    const label = String(measure.name ?? "").trim() ? `«${String(measure.name).trim()}»` : `Мероприятие ${measure.id || "без ID"}`;
    if (!measure.id || ids.has(measure.id)) errors.push(`${label}: внутренний ID пустой или повторяется.`);
    ids.add(measure.id);
    if (!String(measure.name ?? "").trim()) errors.push(`${label}: нужно название.`);
    if (!DIRECTIONS.some((direction) => direction.id === measure.direction)) errors.push(`${label}: неизвестное направление.`);
    if (!["district", "city"].includes(measure.scope)) errors.push(`${label}: тип должен быть «район» или «город».`);
    if (!Number.isInteger(measure.cost) || measure.cost < 1 || measure.cost > BUDGET) errors.push(`${label}: стоимость — целое число от 1 до ${BUDGET}.`);
    if (!Number.isInteger(measure.lag) || measure.lag < 0 || measure.lag > HORIZON) errors.push(`${label}: срок запуска — целое число кварталов от 0 до ${HORIZON}.`);
    const effects = Object.entries(measure.effects ?? {});
    if (effects.some(([id, value]) => !INDICATORS.some((indicator) => indicator.id === id) || !finite(value) || Math.abs(value) > 100)) errors.push(`${label}: эффекты — числа от −100 до 100.`);
    if (!effects.some(([, value]) => value)) warnings.push(`${label}: нет ни одного эффекта — мера ни на что не влияет.`);
    if (measure.lag === HORIZON) warnings.push(`${label}: запуск через ${HORIZON} кв. — за 2 года мера не успеет сработать.`);
  }
  const weights = INDICATORS.map((indicator) => model.weights?.[indicator.id]);
  if (weights.some((weight) => !finite(weight) || weight < 0)) errors.push("Веса показателей — неотрицательные числа.");
  else {
    const sum = weights.reduce((total, weight) => total + weight, 0);
    if (sum <= 0) errors.push("Хотя бы один вес должен быть больше нуля.");
    else if (Math.abs(sum - 1) > 1e-9) warnings.push(`Сумма весов ${Math.round(sum * 1000) / 1000}, а не 1: оценки районов выйдут из шкалы 0–100. Нажмите «Нормировать».`);
  }
  for (const [kind, list] of [["Синергия", model.synergies ?? []], ["Взаимоисключение", model.conflicts ?? []]]) {
    list.forEach((item, index) => {
      const [a, b] = item.measures ?? [];
      if (!ids.has(a) || !ids.has(b) || a === b) errors.push(`${kind} ${index + 1}: выберите две разные существующие меры.`);
      if (kind === "Синергия" && (!INDICATORS.some((indicator) => indicator.id === item.indicator) || !finite(item.bonus))) errors.push(`${kind} ${index + 1}: нужен показатель и числовой бонус.`);
    });
  }
  const eventIds = new Set();
  (model.events ?? []).forEach((event, index) => {
    const label = String(event.name ?? "").trim() ? `Событие «${String(event.name).trim()}»` : `Событие ${index + 1}`;
    if (!String(event.name ?? "").trim()) errors.push(`${label}: нужно название.`);
    if (!event.id || eventIds.has(event.id)) errors.push(`${label}: внутренний ID пустой или повторяется.`);
    eventIds.add(event.id);
    if (!DISTRICTS.some((district) => district.id === event.districtId)) errors.push(`${label}: выберите район.`);
    if (!finite(event.responseCost) || event.responseCost < 0 || event.responseCost > BUDGET) errors.push(`${label}: стоимость ликвидации — число от 0 до ${BUDGET}.`);
    const shocks = Object.entries(event.shocks ?? {});
    if (shocks.some(([id, value]) => !INDICATORS.some((indicator) => indicator.id === id) || !finite(value) || Math.abs(value) > 100)) errors.push(`${label}: удар по показателям — числа от −100 до 100.`);
    if (!shocks.some(([, value]) => value)) warnings.push(`${label}: событие ни на что не влияет.`);
    if ((event.mitigatedBy ?? []).some((id) => !ids.has(id))) errors.push(`${label}: профильная мера не найдена среди мероприятий.`);
    for (const key of ["costReduction", "damageReduction"]) if (!finite(event[key]) || event[key] < 0 || event[key] > 1) errors.push(`${label}: удешевление и смягчение — от 0 до 100%.`);
  });

  const rules = model.scoreRules ?? {};
  const keys = ["averageWeight", "weakestWeight", "criticalThreshold", "criticalPenalty", "districtTarget", "lagPenalty"];
  if (keys.some((key) => !finite(rules[key]) || rules[key] < 0)) errors.push("Коэффициенты формулы — неотрицательные числа.");
  else {
    if (rules.criticalThreshold > 100 || rules.districtTarget > 100) errors.push("Пороги формулы — от 0 до 100.");
    if (Math.abs(rules.averageWeight + rules.weakestWeight - 1) > 1e-9) warnings.push(`Веса «среднее + слабейший» дают ${Math.round((rules.averageWeight + rules.weakestWeight) * 1000) / 1000}, а не 1: Score выйдет из шкалы 0–100.`);
  }
  return { errors, warnings };
}
