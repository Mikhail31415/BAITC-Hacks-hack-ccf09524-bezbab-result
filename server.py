"""Локальный сервер симулятора: статика + необязательное LLM-объяснение.

Без зависимостей работает всё, кроме LLM. Для LLM-объяснения:
    pip install anthropic
    set ANTHROPIC_API_KEY=...        (Windows)   /   export ANTHROPIC_API_KEY=...   (macOS/Linux)
LLM получает готовые числа модели. Если ответ содержит число, которого нет в фактах,
интерфейс показывает объяснение, построенное правилами.
"""

import argparse
import json
import mimetypes
import os
import re
import sys
import threading
from decimal import Decimal
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MODEL = os.environ.get("AKIM_MODEL", "claude-opus-5")
MAX_BODY = 64 * 1024

SYSTEM_PROMPT = """Ты — аналитик городского симулятора «Аким на 5 часов» (синтетические данные, условные районы Астаны).
Тебе дают JSON с уже рассчитанными фактами о сценарии: Score, вклад каждой меры, изменения по районам,
критические значения, место среди всех допустимых сценариев, устойчивость и стресс-тест.

Правила:
- Используй только числа из JSON и копируй их точно так, как они записаны. Не считай новые числа,
  не округляй по-своему, не складывай и не вычитай. Если нужного числа нет — опиши качественно, без цифр.
- Пиши по-русски, простым языком для городского управленца. Без markdown, списков и заголовков.
- Называй мероприятия и показатели словами, как в JSON; не используй технические коды вроде M7 или T1.
- 3 коротких абзаца: (1) что дал сценарий и за счёт каких мер; (2) главный компромисс или риск;
  (3) одна конкретная рекомендация, опирающаяся на данные (например, на оптимум или стресс-тест).
- Не выдавай модель за прогноз реального города."""

_llm = {"client": None, "error": None}
_cache = {}
_lock = threading.Lock()


def llm_client():
    """Клиент создаётся лениво; без пакета или ключа LLM просто выключен."""
    if _llm["client"] is not None or _llm["error"] is not None:
        return _llm["client"]
    try:
        import anthropic  # noqa: PLC0415 — необязательная зависимость
    except ImportError:
        _llm["error"] = "пакет anthropic не установлен"
        return None
    except Exception:  # необязательная зависимость не должна мешать запуску симулятора
        _llm["error"] = "не удалось загрузить пакет anthropic"
        return None
    try:
        has_credentials = any(os.environ.get(name) for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE")) \
            or (Path.home() / ".config" / "anthropic").exists()
        if not has_credentials:
            _llm["error"] = "нет ключа ANTHROPIC_API_KEY"
            return None
        _llm["client"] = anthropic.Anthropic()
    except Exception:
        # Ошибки SDK могут содержать параметры подключения: не отдаём их браузеру.
        _llm["error"] = "не удалось инициализировать LLM-клиент"
        return None
    return _llm["client"]


NUMBER = re.compile(r"(?<![\w.,])[+−-]?\d+(?:[.,]\d+)?(?:[eE][+−-]?\d+)?")


def normalize_number(token):
    value = Decimal(token.replace(",", ".").replace("−", "-"))
    return str(value.normalize()) if value else "0"


def allowed_numbers(facts):
    """Числа из значений фактов, с сохранением знака и округлением до 1–2 знаков."""
    allowed = set()

    def collect(value):
        if isinstance(value, dict):
            for item in value.values():
                collect(item)
        elif isinstance(value, (list, tuple)):
            for item in value:
                collect(item)
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            add(str(value))
        elif isinstance(value, str):
            for match in NUMBER.finditer(value):
                add(match.group(0))

    def add(token):
        value = Decimal(token.replace(",", ".").replace("−", "-"))
        if value.is_finite():
            allowed.update(normalize_number(form) for form in (str(value), f"{value:.1f}", f"{value:.2f}"))

    collect(facts)
    return allowed


def verify(text, facts):
    # Только принадлежность числа фактам: это не проверка смысла или связи с показателем.
    allowed = allowed_numbers(facts)
    found = [m.group(0).replace(",", ".").replace("−", "-") for m in NUMBER.finditer(text)]
    unverified = sorted({number for number in found if normalize_number(number) not in allowed})
    return unverified


def explain(facts):
    key = json.dumps(facts, ensure_ascii=False, sort_keys=True)
    with _lock:
        if key in _cache:
            return _cache[key]
    client = llm_client()
    if client is None:
        raise RuntimeError(_llm["error"])
    # Claude Opus 5 с серверными резервными моделями: при отказе классификатора запрос выполнит другая модель.
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        thinking={"type": "adaptive"},
        output_config={"effort": "medium"},
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": "Факты сценария (JSON):\n" + key}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("модель отказалась отвечать")
    text = "\n\n".join(block.text for block in response.content if block.type == "text").strip()
    unverified = verify(text, facts)
    result = {"text": text, "verified": not unverified, "unverified": unverified, "model": response.model}
    with _lock:
        _cache[key] = result
    return result


class Handler(SimpleHTTPRequestHandler):
    """Статика без кэша (правки видны после перезагрузки) и два API-метода."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):  # noqa: A002 — сигнатура базового класса
        pass

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/status":
            client = llm_client()
            self.send_json(200, {"llm": client is not None, "model": MODEL if client else None, "reason": _llm["error"]})
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/api/explain":
            self.send_json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self.send_json(413, {"error": "слишком большой запрос"})
            return
        try:
            facts = json.loads(self.rfile.read(length))["facts"]
            if not isinstance(facts, dict):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            self.send_json(400, {"error": "ожидается {\"facts\": {...}}"})
            return
        try:
            self.send_json(200, explain(facts))
        except Exception as error:  # noqa: BLE001 — любая ошибка LLM не должна ронять сервер
            self.send_json(503, {"error": str(error)})


def main():
    parser = argparse.ArgumentParser(description="Аким на 5 часов — локальный сервер")
    parser.add_argument("--port", type=int, default=8000, help="порт (по умолчанию 8000)")
    args = parser.parse_args()

    mimetypes.add_type("text/javascript", ".mjs")
    mimetypes.add_type("text/plain; charset=utf-8", ".md")
    root = Path(__file__).resolve().parent
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(root)))
    except OSError:
        print(f"Порт {args.port} занят. Запустите, например: python server.py --port {args.port + 1}", file=sys.stderr)
        sys.exit(1)
    status = "включено" if llm_client() else f"выключено ({_llm['error']}) — работает объяснение по правилам"
    print(f"Откройте http://127.0.0.1:{args.port}  (остановить: Ctrl+C)\nLLM-объяснение: {status}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер остановлен.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
