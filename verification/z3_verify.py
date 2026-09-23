"""Формальная проверка модели «Аким на 5 часов» с помощью Z3 (SMT, точная рациональная арифметика).

Запуск:  python verification/z3_verify.py           (нужен пакет z3-solver; полный прогон ~25 мин)
         python verification/z3_verify.py --quick   (только глобальный оптимум, ~5 мин)
Код выхода 0 — все утверждения доказаны; 1 — найдено расхождение.

Что проверяется:
  1. data.mjs совпадает с независимой транскрипцией спецификации (spec.py).
  2. Веса и доли населения дают в сумме ровно 1; базовый Score = 52.55768.
  3. Пример из ТЗ и заявленные наборы допустимы, а их Score совпадает в трёх местах:
     точный расчёт в Python, SMT-кодировка Z3 и значение, которое выдаёт JS (expected.json).
  4. Минимальная стоимость допустимого набора — 61 (Z3 minimize).
  5. Оптимум JS действительно глобальный: Z3 доказывает, что набора со Score выше не существует (unsat).
  6. Каждая точка границы «бюджет → максимальный Score» оптимальна, и между точками улучшений нет.
  7. Число допустимых наборов (независимый перебор в Python) совпадает с JS.
"""

import itertools
import json
import sys
import time
from fractions import Fraction as F
from pathlib import Path

import z3

import spec

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = json.loads((Path(__file__).parent / "expected.json").read_text(encoding="utf-8"))
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""), flush=True)


def q(value):
    """Fraction -> точная рациональная константа Z3."""
    value = F(value)
    return z3.Q(value.numerator, value.denominator)


class Model:
    """SMT-кодировка: булевы переменные выбора, линейные выражения показателей, ite для clip и критических значений."""

    def __init__(self, budget=spec.BUDGET):
        self.pick = {}
        for m, (_, scope, *_rest) in spec.MEASURES.items():
            if scope == "city":
                self.pick[(m, None)] = z3.Bool(f"{m}")
            else:
                for d in spec.DISTRICTS:
                    self.pick[(m, d)] = z3.Bool(f"{m}@{d}")
        one = lambda b: z3.If(b, 1, 0)
        chosen = {m: z3.Sum([one(v) for (mm, _), v in self.pick.items() if mm == m]) for m in spec.MEASURES}
        self.constraints = [c <= 1 for c in chosen.values()]  # мера не повторяется
        self.constraints.append(z3.Sum(list(chosen.values())) == spec.REQUIRED)
        self.cost = z3.Sum([spec.MEASURES[m][2] * chosen[m] for m in spec.MEASURES])
        self.constraints.append(self.cost <= budget)
        for direction in set(spec.DIRECTION_OF_INDICATOR.values()):
            self.constraints.append(z3.Sum([chosen[m] for m in spec.MEASURES if spec.MEASURES[m][0] == direction]) <= spec.MAX_PER_DIRECTION)
        for a, b in spec.CONFLICTS_ANYWHERE:
            self.constraints.append(chosen[a] + chosen[b] <= 1)
        for a, b in spec.CONFLICTS_SAME_DISTRICT:
            for d in spec.DISTRICTS:
                self.constraints.append(z3.Not(z3.And(self.pick[(a, d)], self.pick[(b, d)])))

        def active(m, d):
            return self.pick[(m, None)] if spec.MEASURES[m][1] == "city" else self.pick[(m, d)]

        self.value = {}
        critical = []
        d_scores = {}
        for d, (_, base) in spec.DISTRICTS.items():
            terms = []
            for k, b in zip(spec.INDICATORS, base):
                raw = [q(b)]
                for m, (_, _, _, lag, effects) in spec.MEASURES.items():
                    if k in effects:
                        raw.append(z3.If(active(m, d), q(F(effects[k]) * F(spec.HORIZON - lag, spec.HORIZON)), q(0)))
                for (a, bm), kk, bonus in spec.SYNERGIES:
                    if kk != k:
                        continue
                    # бонус в районе первой районной меры пары (в данных это всегда первая мера)
                    anchor, other = (a, bm) if spec.MEASURES[a][1] == "district" else (bm, a)
                    other_active = z3.Or([v for (mm, _), v in self.pick.items() if mm == other])
                    raw.append(z3.If(z3.And(active(anchor, d), other_active), q(bonus), q(0)))
                total = z3.Sum(raw)
                clipped = z3.If(total > 100, q(100), z3.If(total < 0, q(0), total))
                self.value[(d, k)] = clipped
                critical.append(z3.If(clipped < spec.CRIT_THRESHOLD, 1, 0))
                terms.append(q(spec.WEIGHTS[k]) * clipped)
            d_scores[d] = z3.Sum(terms)
        self.weakest = z3.Real("weakest")
        # weakest ≤ D_d для всех районов. Score растёт по weakest, поэтому для оценок «существует набор со Score > X»
        # это точное (не ослабленное) условие: лучший выбор weakest равен min D_d.
        self.constraints += [self.weakest <= v for v in d_scores.values()]
        average = z3.Sum([q(spec.DISTRICTS[d][0]) * v for d, v in d_scores.items()])
        self.score = q(spec.AVG_WEIGHT) * average + q(spec.MIN_WEIGHT) * self.weakest - spec.CRIT_PENALTY * z3.Sum(critical)
        self.d_scores = d_scores

    def fix(self, decisions):
        chosen = set(decisions)
        return [v if key in chosen else z3.Not(v) for key, v in self.pick.items()]

    def solver(self):
        s = z3.Solver()
        s.set("timeout", 15 * 60 * 1000)
        s.add(self.constraints)
        return s


def exact(text):
    return F(text)


def main():
    # На Windows вывод в файл или пайп по умолчанию идёт в cp1251, где нет символов вроде «≤».
    # Для файлов и пайпов пишем UTF-8, в консоли непредставимые символы заменяются, а не роняют проверку.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace") if stream.isatty() else stream.reconfigure(encoding="utf-8")
    quick = "--quick" in sys.argv
    started = time.time()
    print(f"Z3 {z3.get_version_string()}\n")

    # 1. data.mjs ↔ спецификация
    measures, districts, weights = spec.parse_data_mjs(ROOT / "data.mjs")
    check("data.mjs: 14 мероприятий совпадают со спецификацией", measures == spec.MEASURES,
          "" if measures == spec.MEASURES else f"расхождения: {[m for m in spec.MEASURES if measures.get(m) != spec.MEASURES[m]]}")
    check("data.mjs: 5 районов (доли и 10 показателей) совпадают", districts == spec.DISTRICTS)
    check("data.mjs: веса показателей совпадают", weights == spec.WEIGHTS)

    # 2. Нормировка и база
    check("Сумма весов показателей = 1", sum(spec.WEIGHTS.values()) == 1)
    check("Сумма долей населения = 1", sum(share for share, _ in spec.DISTRICTS.values()) == 1)
    base_d = {d: sum(spec.WEIGHTS[k] * v for k, v in zip(spec.INDICATORS, values)) for d, (_, values) in spec.DISTRICTS.items()}
    check("Оценки районов D до решений совпадают с таблицей ТЗ", all(round(float(base_d[d]), 2) == float(spec.SPEC_DISTRICT_D[d]) for d in base_d),
          ", ".join(f"{d}={float(v):.2f}" for d, v in base_d.items()))
    baseline = spec.score([])
    check("Базовый Score = 52.55768 (точно)", baseline == exact(EXPECTED["baseline"]), str(float(baseline)))

    base_model = Model()

    def smt_score_of(decisions):
        s = base_model.solver()
        s.add(base_model.fix(decisions))
        # weakest фиксируем как минимум D_d, чтобы получить конкретное значение
        s.add(z3.Or([base_model.weakest == v for v in base_model.d_scores.values()]))
        if s.check() != z3.sat:
            return None
        value = s.model().eval(base_model.score)
        return F(value.numerator_as_long(), value.denominator_as_long())

    # 3. Заявленные наборы: допустимость и Score в трёх реализациях
    named = [("Пример из ТЗ", EXPECTED["example"]), ("Самый дешёвый", EXPECTED["cheapest"]), ("Оптимум JS", EXPECTED["optimum"])]
    for name, claim in named:
        decisions = spec.decode(claim["code"])
        errors = spec.validate(decisions)
        check(f"{name}: набор допустим по правилам ТЗ", not errors, ", ".join(errors))
        check(f"{name}: стоимость {claim['cost']}", spec.cost(decisions) == claim["cost"])
        if "score" in claim:
            py = spec.score(decisions)
            smt = smt_score_of(decisions)
            check(f"{name}: Score {claim['score']} = точный расчёт = SMT-модель", py == exact(claim["score"]) == smt,
                  f"python={float(py)}, z3={float(smt) if smt is not None else 'unsat'}")

    # 4. Минимальная стоимость
    opt = z3.Optimize()
    opt.add(base_model.constraints)
    handle = opt.minimize(base_model.cost)
    opt.check()
    check("Минимальная стоимость допустимого набора = 61 (Z3 minimize)", handle.value().as_long() == EXPECTED["cheapest"]["cost"], str(handle.value()))

    # 5–6. Глобальный оптимум и граница Парето
    pareto = EXPECTED["pareto"]
    for index, point in enumerate(pareto):
        if quick and index + 1 < len(pareto):
            continue
        decisions = spec.decode(point["code"])
        claimed = exact(point["score"])
        ok_set = not spec.validate(decisions) and spec.cost(decisions) <= point["maxCost"] and spec.score(decisions) == claimed
        model = Model(budget=point["maxCost"])
        s = model.solver()
        s.add(model.score > q(claimed))
        t = time.time()
        verdict = s.check()
        check(f"Бюджет ≤ {point['maxCost']}: максимум {point['score']} доказан", ok_set and verdict == z3.unsat,
              f"набор {'ок' if ok_set else 'НЕ СОВПАДАЕТ'}, Z3: {verdict}, {time.time() - t:.1f} с")
        if index + 1 < len(pareto):
            gap_budget = pareto[index + 1]["maxCost"] - 1
            if gap_budget > point["maxCost"]:
                model = Model(budget=gap_budget)
                s = model.solver()
                s.add(model.score > q(claimed))
                verdict = s.check()
                check(f"Бюджет ≤ {gap_budget}: улучшить {point['score']} нельзя", verdict == z3.unsat, f"Z3: {verdict}")
    check("Оптимум JS совпадает с последней точкой границы", EXPECTED["optimum"]["score"] == pareto[-1]["score"])

    # 7. Число допустимых наборов — независимый перебор
    t = time.time()
    ids = list(spec.MEASURES)
    count = 0
    for combo in itertools.combinations(ids, spec.REQUIRED):
        district_measures = [m for m in combo if spec.MEASURES[m][1] == "district"]
        city = [(m, None) for m in combo if spec.MEASURES[m][1] == "city"]
        for places in itertools.product(spec.DISTRICTS, repeat=len(district_measures)):
            if not spec.validate(city + list(zip(district_measures, places))):
                count += 1
    check(f"Число допустимых наборов = {EXPECTED['validCount']}", count == EXPECTED["validCount"], f"python={count}, {time.time() - t:.1f} с")

    passed = sum(results)
    print(f"\nИтог: {passed}/{len(results)} проверок пройдено за {time.time() - started:.1f} с")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
