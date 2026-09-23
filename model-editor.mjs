import { DIRECTIONS, DISTRICTS, HORIZON, INDICATORS, OFFICIAL_MODEL, currentModel, eventsChanged, isOfficialModel, validateModel } from "./data.mjs";

// Редактор модели: мероприятия, веса показателей, синергии, взаимоисключения и (свёрнуто, для опытных) формула Score.
// Правки идут в черновик и применяются только кнопкой «Применить» после проверки.

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const number = (value) => (String(value).trim() === "" ? NaN : Number(String(value).replace(",", ".")));
const RULES = [
  ["averageWeight", "Вес средней оценки по жителям", 0.05],
  ["weakestWeight", "Вес самого слабого района", 0.05],
  ["criticalThreshold", "Порог критического значения", 1],
  ["criticalPenalty", "Штраф за каждое критическое значение", 0.5],
  ["districtTarget", "Порог отставания района, T", 1],
  ["lagPenalty", "Штраф за отставание, λ", 0.05],
];

let draft = null;
let tab = "measures";
let onApply = null;

export function openModelEditor(apply) {
  onApply = apply;
  draft = currentModel();
  render();
  $("#model-editor").showModal();
}

function measureOptions(selected) {
  return draft.measures.map((measure) => `<option value="${esc(measure.id)}"${measure.id === selected ? " selected" : ""}>${esc(measure.name)}</option>`).join("");
}
const indicatorOptions = (selected) => INDICATORS.map((indicator) => `<option value="${indicator.id}"${indicator.id === selected ? " selected" : ""}>${esc(indicator.short)}</option>`).join("");

function renderMeasures() {
  return `<p class="editor-hint">Эффекты — полные, без учёта срока запуска: если мера запускается через L кварталов, за 2 года реализуется доля (${HORIZON} − L) / ${HORIZON}. Пустая клетка — нет эффекта.</p>
  <div class="editor-table-wrap"><table class="editor-table measures"><thead><tr><th>Название</th><th>Направление</th><th>Тип</th><th>Цена</th><th>Запуск, кв.</th>${INDICATORS.map((indicator) => `<th class="effect-head" title="${esc(indicator.name)}">${esc(indicator.short)}</th>`).join("")}<th></th></tr></thead><tbody>
  ${draft.measures.map((measure, row) => `<tr data-list="measures" data-row="${row}">
    <td><input data-field="name" value="${esc(measure.name)}" aria-label="Название" /></td>
    <td><select data-field="direction" aria-label="Направление «${esc(measure.name)}»">${DIRECTIONS.map((direction) => `<option value="${direction.id}"${direction.id === measure.direction ? " selected" : ""}>${direction.label}</option>`).join("")}</select></td>
    <td><select data-field="scope" aria-label="Тип «${esc(measure.name)}»"><option value="district"${measure.scope === "district" ? " selected" : ""}>Район</option><option value="city"${measure.scope === "city" ? " selected" : ""}>Город</option></select></td>
    <td><input class="num" type="number" data-field="cost" min="1" max="100" step="1" value="${esc(measure.cost)}" aria-label="Цена «${esc(measure.name)}»" /></td>
    <td><input class="num" type="number" data-field="lag" min="0" max="${HORIZON}" step="1" value="${esc(measure.lag)}" aria-label="Запуск «${esc(measure.name)}»" /></td>
    ${INDICATORS.map((indicator) => `<td><input class="num effect" type="number" step="0.5" data-effect="${indicator.id}" value="${esc(measure.effects[indicator.id] ?? "")}" placeholder="·" aria-label="«${esc(measure.name)}»: ${esc(indicator.short)}" /></td>`).join("")}
    <td><button type="button" class="row-delete" data-delete="measures" aria-label="Удалить «${esc(measure.name)}»">×</button></td>
  </tr>`).join("")}</tbody></table></div>
  <button type="button" class="text-link" data-add="measures">+ Добавить мероприятие</button>`;
}

function renderWeights() {
  const sum = INDICATORS.reduce((total, indicator) => total + (Number(draft.weights[indicator.id]) || 0), 0);
  return `<p class="editor-hint">Оценка района D = Σ вес × показатель. Чтобы оценки оставались в шкале 0–100, сумма весов должна быть 1.</p>
  <div class="weights-grid">${DIRECTIONS.map((direction) => `<fieldset><legend style="color:${direction.color}">${direction.icon} ${direction.label}</legend>${INDICATORS.filter((indicator) => indicator.direction === direction.id).map((indicator) => `<label title="${esc(indicator.name)}"><span>${esc(indicator.short)}</span><input class="num" type="number" min="0" step="0.01" data-weight="${indicator.id}" value="${esc(draft.weights[indicator.id])}" /></label>`).join("")}</fieldset>`).join("")}</div>
  <p class="weights-sum">Сумма весов: <b id="weights-sum">${Math.round(sum * 1000) / 1000}</b> <button type="button" class="text-link" data-action="normalize">Нормировать к 1</button></p>`;
}

function renderPairs(kind) {
  const list = draft[kind];
  const synergy = kind === "synergies";
  const head = synergy ? "<th>Мера 1</th><th>Мера 2</th><th>Показатель</th><th>Бонус</th><th>Пояснение</th><th></th>" : "<th>Мера 1</th><th>Мера 2</th><th>Где действует</th><th>Причина</th><th></th>";
  const hint = synergy
    ? "Если выбраны обе меры, к показателю добавляется фиксированный бонус (без учёта лага) — в районе первой районной меры пары, а если обе городские — во всех районах."
    : "Запрещённые сочетания: «везде» — меры нельзя выбрать вместе; «в одном районе» — нельзя поставить в один район.";
  return `<p class="editor-hint">${hint}</p><div class="editor-table-wrap"><table class="editor-table"><thead><tr>${head}</tr></thead><tbody>
  ${list.map((item, row) => `<tr data-list="${kind}" data-row="${row}">
    <td><select data-pair="0">${measureOptions(item.measures[0])}</select></td>
    <td><select data-pair="1">${measureOptions(item.measures[1])}</select></td>
    ${synergy
      ? `<td><select data-field="indicator">${indicatorOptions(item.indicator)}</select></td><td><input class="num" type="number" step="0.5" data-field="bonus" value="${esc(item.bonus)}" /></td><td><input data-field="note" value="${esc(item.note)}" /></td>`
      : `<td><select data-field="sameDistrict"><option value="false"${item.sameDistrict ? "" : " selected"}>Везде</option><option value="true"${item.sameDistrict ? " selected" : ""}>В одном районе</option></select></td><td><input data-field="reason" value="${esc(item.reason)}" /></td>`}
    <td><button type="button" class="row-delete" data-delete="${kind}" aria-label="Удалить">×</button></td>
  </tr>`).join("") || `<tr><td colspan="6" class="editor-empty">Пока нет ни одной записи.</td></tr>`}</tbody></table></div>
  <button type="button" class="text-link" data-add="${kind}">+ Добавить ${synergy ? "синергию" : "взаимоисключение"}</button>`;
}

// События: район, удар по показателям, стоимость ликвидации, профильные меры и их действие.
function renderEvents() {
  const mitigSelect = (event, slot) => `<select data-mitig="${slot}"><option value="">—</option>${draft.measures.map((measure) => `<option value="${esc(measure.id)}"${event.mitigatedBy[slot] === measure.id ? " selected" : ""}>${esc(measure.name)}</option>`).join("")}</select>`;
  return `<p class="editor-hint">Событие бьёт по показателям района. Ликвидация оплачивается из резерва бюджета. Если в наборе есть профильная мера (в районе события или городская), ликвидация дешевле, а удар слабее на указанный процент. На официальный Score события не влияют — они нужны для страховки и стресс-теста.</p>
  <div class="editor-table-wrap"><table class="editor-table events"><thead><tr><th>Событие</th><th>Район</th><th>Ликвидация, ед.</th><th>Профильная мера 1</th><th>Профильная мера 2</th><th>Дешевле на, %</th><th>Удар слабее на, %</th>${INDICATORS.map((indicator) => `<th class="effect-head" title="${esc(indicator.name)}">${esc(indicator.short)}</th>`).join("")}<th>Описание</th><th></th></tr></thead><tbody>
  ${draft.events.map((event, row) => `<tr data-list="events" data-row="${row}">
    <td><input data-field="name" value="${esc(event.name)}" aria-label="Название события" /></td>
    <td><select data-field="districtId" aria-label="Район «${esc(event.name)}»">${DISTRICTS.map((district) => `<option value="${district.id}"${district.id === event.districtId ? " selected" : ""}>${district.name}</option>`).join("")}</select></td>
    <td><input class="num" type="number" min="0" max="100" step="1" data-field="responseCost" value="${esc(event.responseCost)}" aria-label="Ликвидация «${esc(event.name)}»" /></td>
    <td>${mitigSelect(event, 0)}</td>
    <td>${mitigSelect(event, 1)}</td>
    <td><input class="num" type="number" min="0" max="100" step="5" data-percent="costReduction" value="${esc(Math.round(event.costReduction * 100))}" aria-label="Удешевление ликвидации «${esc(event.name)}»" /></td>
    <td><input class="num" type="number" min="0" max="100" step="5" data-percent="damageReduction" value="${esc(Math.round(event.damageReduction * 100))}" aria-label="Смягчение удара «${esc(event.name)}»" /></td>
    ${INDICATORS.map((indicator) => `<td><input class="num effect" type="number" step="1" data-shock="${indicator.id}" value="${esc(event.shocks[indicator.id] ?? "")}" placeholder="·" aria-label="«${esc(event.name)}»: ${esc(indicator.short)}" /></td>`).join("")}
    <td><input data-field="text" value="${esc(event.text ?? "")}" aria-label="Описание «${esc(event.name)}»" /></td>
    <td><button type="button" class="row-delete" data-delete="events" aria-label="Удалить «${esc(event.name)}»">×</button></td>
  </tr>`).join("") || `<tr><td colspan="18" class="editor-empty">Событий нет — страховка и стресс-тест будут пустыми.</td></tr>`}</tbody></table></div>
  <button type="button" class="text-link" data-add="events">+ Добавить событие</button>`;
}

function formulaPreview() {
  const r = draft.scoreRules;
  const lag = Number(r.lagPenalty) ? ` − ${r.lagPenalty} × сумма отставаний районов от ${r.districtTarget}` : "";
  return `Score = ${r.averageWeight} × средняя оценка по жителям + ${r.weakestWeight} × оценка слабейшего района − ${r.criticalPenalty} × число показателей ниже ${r.criticalThreshold}${lag}`;
}

function render() {
  const counts = { measures: draft.measures.length, synergies: draft.synergies.length, conflicts: draft.conflicts.length, events: draft.events.length };
  const tabs = [["measures", `Мероприятия (${counts.measures})`], ["weights", "Веса показателей"], ["synergies", `Синергии (${counts.synergies})`], ["conflicts", `Взаимоисключения (${counts.conflicts})`], ["events", `События (${counts.events})`]];
  $("#editor-tabs").innerHTML = tabs.map(([id, title]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${tab === id}">${title}</button>`).join("");
  $("#editor-panel").innerHTML = tab === "measures" ? renderMeasures() : tab === "weights" ? renderWeights() : tab === "events" ? renderEvents() : renderPairs(tab);
  $("#editor-rules").innerHTML = RULES.map(([key, title, step]) => `<label><span>${title}</span><input class="num" type="number" min="0" step="${step}" data-rule="${key}" value="${esc(draft.scoreRules[key])}" /></label>`).join("");
  renderStatus();
}

function renderStatus() {
  const { errors, warnings } = validateModel(draft);
  $("#formula-preview").innerHTML = formulaPreview();
  const sum = $("#weights-sum");
  if (sum) sum.textContent = Math.round(INDICATORS.reduce((total, indicator) => total + (Number(draft.weights[indicator.id]) || 0), 0) * 1000) / 1000;
  const official = isOfficialModel(draft);
  $("#editor-status").innerHTML = `<p class="editor-state ${official ? "ok" : "changed"}">${official ? "✓ Математика совпадает с моделью ТЗ" : "● Модель отличается от ТЗ — результаты не сравнимы с командами на модели ТЗ"}${eventsChanged(draft) ? " · события изменены (на Score не влияют)" : ""}</p>`
    + (errors.length ? `<ul class="editor-errors">${errors.slice(0, 6).map((error) => `<li>${esc(error)}</li>`).join("")}${errors.length > 6 ? `<li>…и ещё ${errors.length - 6}</li>` : ""}</ul>` : "")
    + (warnings.length ? `<ul class="editor-warnings">${warnings.slice(0, 4).map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul>` : "");
  $("#editor-apply").disabled = errors.length > 0;
}

function nextMeasureId() {
  const max = Math.max(0, ...draft.measures.map((measure) => Number(String(measure.id).replace(/\D/g, "")) || 0));
  return `M${max + 1}`;
}

function onInput(event) {
  const target = event.target;
  if (target.dataset.rule) { draft.scoreRules[target.dataset.rule] = number(target.value); renderStatus(); return; }
  if (target.dataset.weight) { draft.weights[target.dataset.weight] = number(target.value); renderStatus(); return; }
  const row = target.closest("[data-list]");
  if (!row) return;
  const item = draft[row.dataset.list][Number(row.dataset.row)];
  if (target.dataset.shock) {
    const value = number(target.value);
    if (Number.isNaN(value) && target.value.trim() === "") delete item.shocks[target.dataset.shock];
    else item.shocks[target.dataset.shock] = value;
  } else if (target.dataset.mitig) {
    const slots = [item.mitigatedBy[0] ?? "", item.mitigatedBy[1] ?? ""];
    slots[Number(target.dataset.mitig)] = target.value;
    item.mitigatedBy = [...new Set(slots.filter(Boolean))];
  } else if (target.dataset.percent) {
    item[target.dataset.percent] = number(target.value) / 100;
  } else if (target.dataset.effect) {
    const value = number(target.value);
    if (Number.isNaN(value) && target.value.trim() === "") delete item.effects[target.dataset.effect];
    else item.effects[target.dataset.effect] = value;
  } else if (target.dataset.pair) {
    item.measures[Number(target.dataset.pair)] = target.value;
  } else if (target.dataset.field) {
    const field = target.dataset.field;
    item[field] = ["cost", "lag", "bonus", "responseCost"].includes(field) ? number(target.value) : field === "sameDistrict" ? target.value === "true" : target.value;
  }
  renderStatus();
}

function onClick(event) {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.tab) { tab = button.dataset.tab; render(); return; }
  if (button.dataset.add === "measures") {
    draft.measures.push({ id: nextMeasureId(), direction: "transport", name: "Новое мероприятие", scope: "district", cost: 10, lag: 1, effects: {} });
    render();
    $("#editor-panel .editor-table-wrap").scrollTop = 1e6;
  } else if (button.dataset.add === "synergies") {
    draft.synergies.push({ measures: [draft.measures[0]?.id, draft.measures[1]?.id], indicator: INDICATORS[0].id, bonus: 1, note: "" });
    render();
  } else if (button.dataset.add === "events") {
    const max = Math.max(0, ...draft.events.map((event) => Number(String(event.id).replace(/\D/g, "")) || 0));
    draft.events.push({ id: `E${max + 1}`, name: "Новое событие", districtId: DISTRICTS[0].id, shocks: {}, responseCost: 8, mitigatedBy: [], costReduction: 0.5, damageReduction: 0.5, text: "" });
    render();
  } else if (button.dataset.add === "conflicts") {
    draft.conflicts.push({ measures: [draft.measures[0]?.id, draft.measures[1]?.id], sameDistrict: false, reason: "" });
    render();
  } else if (button.dataset.delete) {
    const kind = button.dataset.delete;
    const [removed] = draft[kind].splice(Number(button.closest("[data-row]").dataset.row), 1);
    // Удалённая мера не должна оставаться в синергиях и взаимоисключениях.
    if (kind === "measures") {
      for (const list of ["synergies", "conflicts"]) draft[list] = draft[list].filter((item) => !item.measures.includes(removed.id));
      for (const event of draft.events) event.mitigatedBy = event.mitigatedBy.filter((id) => id !== removed.id);
    }
    render();
  } else if (button.dataset.action === "normalize") {
    const sum = INDICATORS.reduce((total, indicator) => total + (Number(draft.weights[indicator.id]) || 0), 0);
    if (sum > 0) {
      for (const indicator of INDICATORS) draft.weights[indicator.id] = Math.round((Number(draft.weights[indicator.id]) || 0) / sum * 10000) / 10000;
      // Остаток округления — к наибольшему весу, чтобы сумма была ровно 1.
      const largest = INDICATORS.reduce((best, indicator) => (draft.weights[indicator.id] > draft.weights[best.id] ? indicator : best));
      const rest = 1 - INDICATORS.reduce((total, indicator) => total + draft.weights[indicator.id], 0);
      draft.weights[largest.id] = Math.round((draft.weights[largest.id] + rest) * 10000) / 10000;
    }
    render();
  } else if (button.id === "editor-reset") {
    draft = structuredClone(OFFICIAL_MODEL);
    render();
  } else if (button.id === "editor-cancel") {
    $("#model-editor").close();
  } else if (button.id === "editor-apply" && !validateModel(draft).errors.length) {
    $("#model-editor").close();
    onApply?.(structuredClone(draft));
  }
}

export function setupModelEditor() {
  const dialog = $("#model-editor");
  dialog.addEventListener("input", onInput);
  dialog.addEventListener("change", onInput);
  dialog.addEventListener("click", onClick);
}
