"""Проверки LLM-ограждений без SDK, ключей и сетевых запросов: python -m unittest test_server.py."""

import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import server


class NumberVerificationTests(unittest.TestCase):
    def test_rejects_numbers_absent_from_facts(self):
        facts = {"score": 56.54, "delta": 3.99, "cost": 95}
        for number in ("0", "1", "10", "100", "2050"):
            with self.subTest(number=number):
                self.assertEqual(server.verify(f"Score = {number}.", facts), [number])

    def test_preserves_positive_and_negative_signs(self):
        self.assertEqual(server.verify("Изменение −3,99.", {"delta": 3.99}), ["-3.99"])
        self.assertEqual(server.verify("Изменение +3.99.", {"delta": -3.99}), ["+3.99"])
        self.assertEqual(server.verify("Изменение −3,99.", {"delta": -3.99}), [])
        self.assertEqual(server.verify("Изменение +3.99.", {"delta": 3.99}), [])

    def test_accepts_actual_facts_and_display_rounding(self):
        facts = {"districts": [{"after": 56.54307}], "delta": -0.12345, "rank": 566}
        self.assertEqual(server.verify("Score 56.54307; 56,54; 56.5; изменение −0,12; место 566.", facts), [])
        self.assertEqual(server.verify("Score 56.55.", facts), ["56.55"])

    def test_only_values_supply_numbers_and_ids_are_not_constants(self):
        facts = {"year2050": True, "id": "M12", "indicator": "T1", "rules": "0.7 × средняя; порог 40"}
        self.assertEqual(server.verify("Вес 0.7; порог 40; M12 и T1.", facts), [])
        self.assertEqual(server.verify("Год 2050; эффект 12; прирост 1; вес 70%.", facts), ["1", "12", "2050", "70"])


class OptionalClientTests(unittest.TestCase):
    def setUp(self):
        self.state = patch.object(server, "_llm", {"client": None, "error": None})
        self.state.start()
        self.addCleanup(self.state.stop)

    def test_missing_package_keeps_llm_disabled(self):
        with patch.dict(sys.modules, {"anthropic": None}):
            self.assertIsNone(server.llm_client())
        self.assertIn("не установлен", server._llm["error"])

    def test_invalid_sdk_config_is_safe_and_cached(self):
        constructor = Mock(side_effect=RuntimeError("private-configuration-value"))
        module = SimpleNamespace(Anthropic=constructor)
        with patch.dict(sys.modules, {"anthropic": module}), patch.dict(server.os.environ, {"ANTHROPIC_PROFILE": "invalid-test-profile"}):
            self.assertIsNone(server.llm_client())
            self.assertIsNone(server.llm_client())
            handler = object.__new__(server.Handler)
            handler.path = "/api/status"
            handler.send_json = Mock()
            handler.do_GET()
        constructor.assert_called_once_with()
        self.assertNotIn("private-configuration-value", server._llm["error"])
        handler.send_json.assert_called_once_with(200, {"llm": False, "model": None, "reason": server._llm["error"]})


if __name__ == "__main__":
    unittest.main()
