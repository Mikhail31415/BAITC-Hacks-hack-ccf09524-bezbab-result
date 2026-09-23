"""Независимая транскрипция спецификации и точный (рациональный) расчёт Score.

Этот файл намеренно НЕ читает data.mjs: данные переписаны из условия задачи заново,
чтобы сверка ловила ошибки переноса в JS. Вся арифметика — fractions.Fraction, без округлений.
"""

import re
from fractions import Fraction as F
from pathlib import Path

BUDGET = 100
HORIZON = 8
REQUIRED = 5
MAX_PER_DIRECTION = 2
AVG_WEIGHT, MIN_WEIGHT, CRIT_THRESHOLD, CRIT_PENALTY = F(7, 10), F(3, 10), 40, 1

INDICATORS = ["T1", "T2", "E1", "E2", "S1", "S2", "B1", "B2", "C1", "C2"]
WEIGHTS = dict(zip(INDICATORS, [F(x, 100) for x in (10, 10, 9, 11, 11, 11, 9, 9, 10, 10)]))
DIRECTION_OF_INDICATOR = {"T": "transport", "E": "ecology", "S": "social", "B": "safety", "C": "service"}

# район: (доля населения, T1 T2 E1 E2 S1 S2 B1 B2 C1 C2)
DISTRICTS = {
    "esil": (F(27, 100), (45, 62, 68, 72, 48, 55, 78, 60, 75, 70)),
    "almaty": (F(24, 100), (40, 75, 50, 55, 60, 65, 62, 52, 50, 60)),
    "saryarka": (F(20, 100), (50, 70, 42, 40, 62, 68, 58, 55, 45, 55)),
    "baikonur": (F(13, 100), (52, 68, 55, 50, 58, 60, 52, 58, 55, 58)),
    "nura": (F(16, 100), (55, 40, 45, 65, 38, 35, 55, 50, 60, 50)),
}
SPEC_DISTRICT_D = {"esil": "62.99", "almaty": "57.06", "saryarka": "54.65", "baikonur": "56.63", "nura": "49.18"}

# id: (направление, тип, стоимость, лаг, эффекты)
MEASURES = {
    "M1": ("transport", "district", 18, 2, {"T1": 6, "T2": 9}),
    "M2": ("transport", "city", 22, 2, {"T1": 4, "B2": 3}),
    "M3": ("transport", "district", 30, 4, {"T1": 16, "T2": 20, "E2": 4}),
    "M4": ("ecology", "district", 15, 2, {"E1": 12, "E2": 3, "B1": 2}),
    "M5": ("ecology", "district", 25, 3, {"E2": 14, "C1": 4}),
    "M6": ("ecology", "city", 20, 4, {"E1": 5, "E2": 3}),
    "M7": ("social", "district", 24, 3, {"S1": 16}),
    "M8": ("social", "district", 20, 3, {"S2": 14}),
    "M9": ("social", "district", 10, 1, {"S1": 3, "S2": 3, "B1": 3}),
    "M10": ("safety", "district", 12, 1, {"B1": 12, "B2": 2}),
    "M11": ("safety", "district", 10, 1, {"B2": 12, "T1": -2}),
    "M12": ("service", "city", 14, 1, {"C2": 5}),
    "M13": ("service", "district", 28, 4, {"C1": 18, "E2": 2}),
    "M14": ("service", "city", 16, 1, {"C1": 5, "C2": 2}),
}
SYNERGIES = [(("M1", "M2"), "T1", 2), (("M10", "M12"), "B1", 2), (("M5", "M6"), "E2", 2)]
CONFLICTS_ANYWHERE = [("M1", "M3")]
CONFLICTS_SAME_DISTRICT = [("M4", "M7"), ("M5", "M13")]


def decode(code):
    """'M2_M3.nura_...' -> [(мера, район | None)]"""
    return [(part.split(".")[0], part.split(".")[1] if "." in part else None) for part in code.split("_")]


def validate(decisions):
    errors = []
    ids = [m for m, _ in decisions]
    if len(decisions) != REQUIRED:
        errors.append("count")
    if len(set(ids)) != len(ids):
        errors.append("repeat")
    for m, d in decisions:
        if m not in MEASURES:
            errors.append("unknown")
            continue
        scope = MEASURES[m][1]
        if scope == "district" and d not in DISTRICTS:
            errors.append("district required")
        if scope == "city" and d is not None:
            errors.append("city has district")
    for direction in DIRECTION_OF_INDICATOR.values():
        if sum(MEASURES[m][0] == direction for m in ids if m in MEASURES) > MAX_PER_DIRECTION:
            errors.append("direction limit")
    for a, b in CONFLICTS_ANYWHERE:
        if a in ids and b in ids:
            errors.append("conflict")
    where = dict(decisions)
    for a, b in CONFLICTS_SAME_DISTRICT:
        if a in where and b in where and where[a] == where[b]:
            errors.append("conflict same district")
    if sum(MEASURES[m][2] for m in ids if m in MEASURES) > BUDGET:
        errors.append("budget")
    return errors


def cells_after(decisions):
    cells = {(d, k): F(v) for d, (_, values) in DISTRICTS.items() for k, v in zip(INDICATORS, values)}
    where = dict(decisions)
    for m, d in decisions:
        _, scope, _, lag, effects = MEASURES[m]
        share = F(HORIZON - lag, HORIZON)
        for target in (DISTRICTS if scope == "city" else [d]):
            for k, v in effects.items():
                cells[(target, k)] += v * share
    for (a, b), k, bonus in SYNERGIES:
        if a in where and b in where:
            anchor = where[a] if where[a] is not None else where[b]
            for target in (DISTRICTS if anchor is None else [anchor]):
                cells[(target, k)] += bonus
    return {key: min(F(100), max(F(0), value)) for key, value in cells.items()}


def score(decisions):
    cells = cells_after(decisions)
    d_score = {d: sum(WEIGHTS[k] * cells[(d, k)] for k in INDICATORS) for d in DISTRICTS}
    average = sum(DISTRICTS[d][0] * d_score[d] for d in DISTRICTS)
    critical = sum(1 for value in cells.values() if value < CRIT_THRESHOLD)
    return AVG_WEIGHT * average + MIN_WEIGHT * min(d_score.values()) - CRIT_PENALTY * critical


def cost(decisions):
    return sum(MEASURES[m][2] for m, _ in decisions)


def parse_data_mjs(path):
    """Лёгкий разбор data.mjs (формат строк фиксирован) — для сверки JS-данных со спецификацией."""
    text = Path(path).read_text(encoding="utf-8")
    measures = {}
    for match in re.finditer(r'id: "(M\d+)", direction: "(\w+)", name: "[^"]*", scope: "(\w+)", cost: (\d+), lag: (\d+), effects: \{([^}]*)\}', text):
        effects = {k: int(v) for k, v in re.findall(r"(\w\d): (-?\d+)", match.group(6))}
        measures[match.group(1)] = (match.group(2), match.group(3), int(match.group(4)), int(match.group(5)), effects)
    districts = {}
    for match in re.finditer(r'id: "(\w+)", name: "[^"]*", share: ([\d.]+), profile: "[^"]*", metrics: \{([^}]*)\}', text):
        metrics = dict(re.findall(r"(\w\d): (\d+)", match.group(3)))
        districts[match.group(1)] = (F(match.group(2)), tuple(int(metrics[k]) for k in INDICATORS))
    weights = {k: F(v) for k, v in re.findall(r'id: "(\w\d)", direction: "\w+", name: "[^"]*", weight: ([\d.]+)', text)}
    return measures, districts, weights
