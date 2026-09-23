import { BUDGET, DIRECTIONS, EVENTS, isOfficialModel } from "./data.mjs";
import { getDistrict, getIndicator, getMeasure } from "./engine.mjs";
import { fmt, signed } from "./explain.mjs";

// Автогенерация краткой презентации решения команды: 5 слайдов, готовых к печати в PDF.
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const list = (items, limit = 4) => `<ul>${items.slice(0, limit).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;

export function buildSlides({ result, analysis, space, rank, stress, robust, teamName, aiText }) {
  const team = teamName || "Наша команда";
  const date = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const decisions = [...result.decisions].sort((a, b) => b.exactContribution - a.exactContribution);
  const slides = [];

  slides.push(`<section class="slide slide-title"><p class="eyebrow">АКИМ НА 5 ЧАСОВ · ${esc(date)}</p><h2>${esc(team)}</h2><div class="slide-score"><strong>${fmt(result.score)}</strong><span>Astana Quality of Life Score<br />${signed(result.delta)} к исходным ${fmt(result.baseline)}</span></div><p>Бюджет ${result.cost} из ${BUDGET} ед. · ${rank ? `топ ${fmt(Math.max(0.01, (1 - rank.share) * 100), 2)}% из ${rank.total.toLocaleString("ru-RU")} допустимых сценариев` : "5 решений в 5 направлениях"}</p></section>`);

  slides.push(`<section class="slide"><p class="eyebrow">01 · ПЯТЬ РЕШЕНИЙ</p><h3>Что мы сделали и что это дало</h3><table><thead><tr><th>Мера</th><th>Где</th><th>Стоимость</th><th>Вклад в Score</th></tr></thead><tbody>${decisions.map((decision) => {
    const measure = getMeasure(decision.measureId);
    return `<tr><td><b>${esc(measure.name)}</b><small>${DIRECTIONS.find((d) => d.id === measure.direction).label}</small></td><td>${decision.districtId ? getDistrict(decision.districtId).name : "весь город"}</td><td>${measure.cost} ед.</td><td><b>${signed(decision.contribution)}</b></td></tr>`;
  }).join("")}</tbody></table>${result.synergies.length ? `<p>Синергии: ${result.synergies.map((s) => `${s.measures.map((id) => `«${esc(getMeasure(id).name)}»`).join(" + ")} (+${s.bonus} к показателю «${esc(getIndicator(s.indicator).short)}»)`).join(", ")}.</p>` : ""}</section>`);

  slides.push(`<section class="slide"><p class="eyebrow">02 · РАЙОНЫ</p><h3>Кому стало лучше</h3><div class="slide-districts">${result.after.map((district) => {
    const before = result.before.find((item) => item.id === district.id).score;
    const width = Math.max(0, Math.min(100, (district.score - 40) / 30 * 100));
    return `<div><span>${district.name} · ${Math.round(district.share * 100)}%</span><div class="slide-bar"><i style="width:${width}%"></i></div><b>${fmt(before)} → ${fmt(district.score)}</b></div>`;
  }).join("")}</div><p>Средняя по жителям ${fmt(result.components.baselineAverage)} → ${fmt(result.components.average)}; слабейший район ${fmt(result.components.baselineWeakest)} → ${fmt(result.components.weakest)}; критических значений ${result.components.baselineCritical} → ${result.components.critical}.</p></section>`);

  slides.push(`<section class="slide"><p class="eyebrow">03 · AI-АНАЛИЗ</p><h3>Сильные стороны и риски</h3><div class="slide-columns"><div><h4>Сильные стороны</h4>${list(analysis.strengths)}</div><div><h4>Риски</h4>${list(analysis.risks)}</div></div>${aiText ? `<blockquote>${esc(aiText.split("\n")[0])}</blockquote>` : ""}</section>`);

  const worst = [...stress].sort((a, b) => b.loss - a.loss)[0];
  slides.push(`<section class="slide"><p class="eyebrow">04 · УСТОЙЧИВОСТЬ И ДАЛЬШЕ</p><h3>Что может пойти не так и как улучшить</h3><ul><li>Устойчивость: в 80% симуляций (неточные эффекты, задержки запуска) Score от ${fmt(robust.p10)} до ${fmt(robust.p90)}.</li><li>Стресс-тест: покрыто ${stress.filter((s) => s.covered).length} из ${stress.length} событий${worst.loss > 0 ? `; худшее — «${esc(EVENTS.find((e) => e.id === worst.eventId).name)}» (−${fmt(worst.loss)} п.)` : ""}.</li>${space ? `<li>Оптимум модели — ${fmt(space.best.score)} за ${space.best.cost} ед.; экономный вариант — ${fmt(space.alternatives.economical.score)} за ${space.alternatives.economical.cost} ед.</li>` : ""}${analysis.tradeoffs.slice(0, 1).map((item) => `<li>${esc(item)}</li>`).join("")}</ul><p class="slide-note">${isOfficialModel() ? "Модель и данные синтетические, по ТЗ. Расчёт проверен формально (Z3, Lean 4 + Mathlib)." : "Внимание: использована изменённая модель, результаты не сравнимы с моделью ТЗ."}</p></section>`);

  return slides.join("");
}
