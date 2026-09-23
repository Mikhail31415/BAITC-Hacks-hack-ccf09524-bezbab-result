import Mathlib

/-!
# «Аким на 5 часов»: формальная проверка математики модели (Lean 4 + Mathlib)

Всё в точной рациональной арифметике `ℚ`. Порядок показателей: T1 T2 E1 E2 S1 S2 B1 B2 C1 C2.
Порядок районов: Есиль, Алматы, Сарыарка, Байконур, Нура. Меры M1…M14 — индексы 0…13.

Доказано:
* нормировка весов и долей населения;
* базовый Score = 52.55768, Score примера из ТЗ = 56.54307, Score оптимума JS = 57.236735;
* пример и оптимум удовлетворяют всем правилам ТЗ;
* границы: оценка района ∈ [0, 100], Score ≤ 100;
* монотонность: улучшение любого показателя не может снизить Score (нет «вредных» улучшений);
* эффективность вкладов: сумма маргинальных вкладов мер вдоль любого порядка добавления
  и их среднее по всем порядкам (значение Шепли) равны полному изменению Score.
-/

namespace Akim

abbrev Ind := Fin 10
abbrev Dist := Fin 5
abbrev Cells := Dist → Ind → ℚ

def weight : Ind → ℚ := ![1/10, 1/10, 9/100, 11/100, 11/100, 11/100, 9/100, 9/100, 1/10, 1/10]
def share : Dist → ℚ := ![27/100, 24/100, 20/100, 13/100, 16/100]

def base : Cells := ![
  ![45, 62, 68, 72, 48, 55, 78, 60, 75, 70],
  ![40, 75, 50, 55, 60, 65, 62, 52, 50, 60],
  ![50, 70, 42, 40, 62, 68, 58, 55, 45, 55],
  ![52, 68, 55, 50, 58, 60, 52, 58, 55, 58],
  ![55, 40, 45, 65, 38, 35, 55, 50, 60, 50]]

/-! ## Формула Score -/

def clip (x : ℚ) : ℚ := max 0 (min 100 x)

def districtScore (c : Cells) (d : Dist) : ℚ := ∑ k, weight k * clip (c d k)

def average (c : Cells) : ℚ := ∑ d, share d * districtScore c d

def weakest (c : Cells) : ℚ :=
  min (min (min (min (districtScore c 0) (districtScore c 1)) (districtScore c 2)) (districtScore c 3)) (districtScore c 4)

/-- Число пар «район × показатель» строго ниже 40. -/
def critical (c : Cells) : ℚ := ∑ d, ∑ k, if clip (c d k) < 40 then 1 else 0

def score (c : Cells) : ℚ := 7/10 * average c + 3/10 * weakest c - critical c

theorem weight_sum : ∑ k, weight k = 1 := by
  simp [weight, Fin.sum_univ_succ]; norm_num

theorem share_sum : ∑ d, share d = 1 := by
  simp [share, Fin.sum_univ_succ]; norm_num

theorem weight_nonneg (k : Ind) : 0 ≤ weight k := by
  fin_cases k <;> simp [weight] <;> norm_num

theorem share_nonneg (d : Dist) : 0 ≤ share d := by
  fin_cases d <;> simp [share] <;> norm_num

/-! ## Мероприятия, синергии и правила -/

structure Measure where
  direction : Fin 5
  cost : ℕ
  lag : ℕ
  city : Bool
  eff : Ind → ℚ

def measures : Fin 14 → Measure := ![
  ⟨0, 18, 2, false, ![6, 9, 0, 0, 0, 0, 0, 0, 0, 0]⟩,     -- M1 автобусные полосы
  ⟨0, 22, 2, true,  ![4, 0, 0, 0, 0, 0, 0, 3, 0, 0]⟩,     -- M2 умные светофоры
  ⟨0, 30, 4, false, ![16, 20, 0, 4, 0, 0, 0, 0, 0, 0]⟩,   -- M3 ЛРТ
  ⟨1, 15, 2, false, ![0, 0, 12, 3, 0, 0, 2, 0, 0, 0]⟩,    -- M4 парк
  ⟨1, 25, 3, false, ![0, 0, 0, 14, 0, 0, 0, 0, 4, 0]⟩,    -- M5 чистое топливо
  ⟨1, 20, 4, true,  ![0, 0, 5, 3, 0, 0, 0, 0, 0, 0]⟩,     -- M6 озеленение города
  ⟨2, 24, 3, false, ![0, 0, 0, 0, 16, 0, 0, 0, 0, 0]⟩,    -- M7 школа + детсад
  ⟨2, 20, 3, false, ![0, 0, 0, 0, 0, 14, 0, 0, 0, 0]⟩,    -- M8 поликлиника
  ⟨2, 10, 1, false, ![0, 0, 0, 0, 3, 3, 3, 0, 0, 0]⟩,     -- M9 спорт-хабы
  ⟨3, 12, 1, false, ![0, 0, 0, 0, 0, 0, 12, 2, 0, 0]⟩,    -- M10 освещение и камеры
  ⟨3, 10, 1, false, ![-2, 0, 0, 0, 0, 0, 0, 12, 0, 0]⟩,   -- M11 безопасные переходы
  ⟨4, 14, 1, true,  ![0, 0, 0, 0, 0, 0, 0, 0, 0, 5]⟩,     -- M12 платформа обращений
  ⟨4, 28, 4, false, ![0, 0, 0, 2, 0, 0, 0, 0, 18, 0]⟩,    -- M13 тепло- и водосети
  ⟨4, 16, 1, true,  ![0, 0, 0, 0, 0, 0, 0, 0, 5, 2]⟩]     -- M14 аварийные бригады

/-- Решение: мера и район (`none` для городской меры). -/
abbrev Decision := Fin 14 × Option Dist

/-- Реализованная за горизонт H = 8 доля эффекта. -/
def realized (m : Measure) : ℚ := (8 - (m.lag : ℚ)) / 8

def applies (x : Decision) (d : Dist) : Bool :=
  match x.2 with
  | none => (measures x.1).city
  | some d' => d' == d

/-- Синергии: (первая мера, вторая мера, показатель, бонус). Бонус — в районе первой меры. -/
def synergies : List (Fin 14 × Fin 14 × Ind × ℚ) := [(0, 1, 0, 2), (9, 11, 6, 2), (4, 5, 3, 2)]

def synergyBonus (ds : List Decision) (d : Dist) (k : Ind) : ℚ :=
  (synergies.map fun s =>
    if s.2.2.1 = k ∧ ds.any (fun x => x.1 == s.1 && x.2 == some d) ∧ ds.any (fun x => x.1 == s.2.1)
    then s.2.2.2 else 0).sum

def cells (ds : List Decision) : Cells := fun d k =>
  base d k + (ds.map fun x => if applies x d then (measures x.1).eff k * realized (measures x.1) else 0).sum
    + synergyBonus ds d k

def cost (ds : List Decision) : ℕ := (ds.map fun x => (measures x.1).cost).sum

/-- Все правила ТЗ: 5 решений, без повторов, район только у районных мер, ≤ 2 на направление,
несовместимости M1–M3 (везде), M4–M7 и M5–M13 (в одном районе), бюджет ≤ 100. -/
def valid (ds : List Decision) : Bool :=
  ds.length == 5 &&
  (ds.map (·.1)).Nodup &&
  ds.all (fun x => (measures x.1).city == x.2.isNone) &&
  (List.finRange 5).all (fun g => (ds.filter fun x => (measures x.1).direction == g).length ≤ 2) &&
  !(ds.any (·.1 == 0) && ds.any (·.1 == 2)) &&
  !(ds.any fun x => ds.any fun y => x.1 == 3 && y.1 == 6 && x.2 == y.2) &&
  !(ds.any fun x => ds.any fun y => x.1 == 4 && y.1 == 12 && x.2 == y.2) &&
  cost ds ≤ 100

/-! ## Контрольные значения -/

/-- Пример из ТЗ: M7, M8, M10 в Нуре, M12 по городу, M5 в Сарыарке. -/
def example5 : List Decision := [(6, some 4), (7, some 4), (9, some 4), (11, none), (4, some 2)]

/-- Оптимум, найденный JS-перебором: M2, M3 Нура, M8 Нура, M9 Нура, M14. -/
def optimum : List Decision := [(1, none), (2, some 4), (7, some 4), (8, some 4), (13, none)]

theorem baseline_district_scores :
    districtScore base = ![6299/100, 5706/100, 5465/100, 5663/100, 4918/100] := by
  funext d; fin_cases d <;> simp [districtScore, base, weight, clip, Fin.sum_univ_succ] <;> norm_num

-- Численные равенства проверяет ядро Lean: вычисление в ℚ без округлений (не native_decide).
theorem baseline_score : score base = 5255768 / 100000 := by decide +kernel

theorem example_valid : valid example5 = true := by decide
theorem example_cost : cost example5 = 95 := by decide
theorem example_score : score (cells example5) = 5654307 / 100000 := by decide +kernel

theorem optimum_valid : valid optimum = true := by decide
theorem optimum_cost : cost optimum = 98 := by decide
theorem optimum_score : score (cells optimum) = 57236735 / 1000000 := by decide +kernel

/-! ## Общие свойства формулы (для любых значений показателей) -/

theorem clip_mono {a b : ℚ} (h : a ≤ b) : clip a ≤ clip b := by
  unfold clip; gcongr

theorem clip_nonneg (a : ℚ) : 0 ≤ clip a := le_max_left _ _

theorem clip_le (a : ℚ) : clip a ≤ 100 := max_le (by norm_num) (min_le_left _ _)

variable {c c' : Cells}

theorem districtScore_mono (h : ∀ d k, c d k ≤ c' d k) (d : Dist) :
    districtScore c d ≤ districtScore c' d :=
  Finset.sum_le_sum fun k _ => mul_le_mul_of_nonneg_left (clip_mono (h d k)) (weight_nonneg k)

theorem districtScore_nonneg (d : Dist) : 0 ≤ districtScore c d :=
  Finset.sum_nonneg fun k _ => mul_nonneg (weight_nonneg k) (clip_nonneg _)

theorem districtScore_le (d : Dist) : districtScore c d ≤ 100 := by
  calc districtScore c d ≤ ∑ k, weight k * 100 :=
        Finset.sum_le_sum fun k _ => mul_le_mul_of_nonneg_left (clip_le _) (weight_nonneg k)
    _ = 100 := by rw [← Finset.sum_mul, weight_sum, one_mul]

theorem average_mono (h : ∀ d k, c d k ≤ c' d k) : average c ≤ average c' :=
  Finset.sum_le_sum fun d _ => mul_le_mul_of_nonneg_left (districtScore_mono h d) (share_nonneg d)

theorem weakest_mono (h : ∀ d k, c d k ≤ c' d k) : weakest c ≤ weakest c' := by
  unfold weakest
  have := districtScore_mono h
  gcongr <;> exact this _

/-- Если показатели только выросли, критических значений не больше, чем было. -/
theorem critical_antitone (h : ∀ d k, c d k ≤ c' d k) : critical c' ≤ critical c := by
  unfold critical
  refine Finset.sum_le_sum fun d _ => Finset.sum_le_sum fun k _ => ?_
  by_cases h' : clip (c' d k) < 40
  · have : clip (c d k) < 40 := lt_of_le_of_lt (clip_mono (h d k)) h'
    simp [h', this]
  · simp only [h', if_false]; split_ifs <;> norm_num

/-- Главное свойство: улучшение любых показателей никогда не снижает Score. -/
theorem score_mono (h : ∀ d k, c d k ≤ c' d k) : score c ≤ score c' := by
  unfold score
  have := average_mono h; have := weakest_mono h; have := critical_antitone h
  linarith

theorem critical_nonneg : 0 ≤ critical c :=
  Finset.sum_nonneg fun d _ => Finset.sum_nonneg fun k _ => by split_ifs <;> norm_num

theorem score_le_100 : score c ≤ 100 := by
  have avg : average c ≤ 100 := by
    calc average c ≤ ∑ d, share d * 100 :=
          Finset.sum_le_sum fun d _ => mul_le_mul_of_nonneg_left (districtScore_le d) (share_nonneg d)
      _ = 100 := by rw [← Finset.sum_mul, share_sum, one_mul]
  have weak : weakest c ≤ 100 := (min_le_right _ _).trans (districtScore_le 4)
  have := critical_nonneg (c := c)
  unfold score; linarith

theorem realized_mem (m : Measure) (h : m.lag ≤ 8) : 0 ≤ realized m ∧ realized m ≤ 1 := by
  have : (m.lag : ℚ) ≤ 8 := by exact_mod_cast h
  unfold realized
  constructor
  · apply div_nonneg <;> linarith
  · rw [div_le_one (by norm_num)]; linarith [Nat.cast_nonneg (α := ℚ) m.lag]

/-! ## Вклады мер: эффективность (свойство значения Шепли) -/

/-- Сумма маргинальных вкладов при добавлении элементов списка по порядку к множеству `S`. -/
def marginals {α : Type*} [DecidableEq α] (v : Finset α → ℚ) : Finset α → List α → ℚ
  | _, [] => 0
  | S, a :: l => (v (insert a S) - v S) + marginals v (insert a S) l

/-- Телескопирование: вклады вдоль любого порядка в сумме дают полный прирост. -/
theorem marginals_eq {α : Type*} [DecidableEq α] (v : Finset α → ℚ) (S : Finset α) (l : List α) :
    marginals v S l = v (S ∪ l.toFinset) - v S := by
  induction l generalizing S with
  | nil => simp [marginals]
  | cons a l ih =>
    have hs : insert a S ∪ l.toFinset = S ∪ (a :: l).toFinset := by
      ext x; simp only [Finset.mem_union, Finset.mem_insert, List.mem_toFinset, List.mem_cons]; tauto
    simp only [marginals, ih, hs]; ring

/-- Значение Шепли — среднее вкладов по всем порядкам добавления мер. Сумма вкладов всех мер,
усреднённая по всем `n!` порядкам, равна изменению Score: v(все меры) − v(∅). -/
theorem shapley_efficiency {α : Type*} [DecidableEq α] (v : Finset α → ℚ) (N : List α) :
    (N.permutations.map (marginals v ∅)).sum / N.permutations.length = v N.toFinset - v ∅ := by
  have h : ∀ l ∈ N.permutations, marginals v ∅ l = v N.toFinset - v ∅ := by
    intro l hl
    rw [marginals_eq, Finset.empty_union, List.toFinset_eq_of_perm _ _ (List.mem_permutations.mp hl)]
  rw [List.map_congr_left h, List.map_const', List.sum_replicate, nsmul_eq_mul]
  have hpos : (N.permutations.length : ℚ) ≠ 0 := by
    rw [List.length_permutations]; exact_mod_cast (Nat.factorial_pos _).ne'
  field_simp

end Akim
