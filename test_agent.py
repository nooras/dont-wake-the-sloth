import unittest
from pathlib import Path
import json
from unittest.mock import patch

from slowpoke import Game, agent_move, load_levels


class LocalGameTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.levels = load_levels()

    def test_reference_paths_win_with_expected_noise(self):
        paths = {
            1: ("RURD", 5),
            2: ("RRR", 5),
            3: ("RURRURDD", 12),
            4: ("LLLUURRR", 6),
            5: ("URRULRR", 10),
        }
        for level_id, (moves, expected_noise) in paths.items():
            level = self.levels[level_id - 1]
            with self.subTest(level=level["id"]):
                game = Game(level)
                for direction in moves:
                    outcome = game.apply(direction)
                    self.assertFalse(outcome["lost"])
                self.assertFalse(game.state.monkeys)
                self.assertEqual(game.noise, expected_noise)
                self.assertTrue(outcome["won"])

    def test_solver_pars_match_the_supplied_reference_values(self):
        for level in self.levels:
            with self.subTest(level=level["id"]):
                game = Game(level)
                path = game.minimum_noise_path()
                self.assertIsNotNone(path)
                for direction in path:
                    game.apply(direction)
                self.assertFalse(game.state.monkeys)
                self.assertEqual(game.noise, level["par"])

    def test_all_solver_paths_fit_the_noise_limit(self):
        for level in self.levels:
            with self.subTest(level=level["id"]):
                game = Game(level)
                path = game.minimum_noise_path()
                self.assertIsNotNone(path)
                for direction in path:
                    outcome = game.apply(direction)
                    self.assertFalse(outcome["lost"])
                self.assertFalse(game.state.monkeys)
                self.assertLess(game.noise, level["noiseLimit"])

    def test_sloth_zone_doubles_destination_noise_and_push_adds_one(self):
        level = {
            "id": 99, "name": "test", "noiseLimit": 20, "par": 0, "tip": "",
            "grid": ["#####", "#.S.#", "#PM.#", "#####"],
        }
        game = Game(level)
        move = game.legal_move("R")
        self.assertIsNotNone(move)
        self.assertEqual(move["noise_cost"], 3)
        self.assertTrue(move["pushed"])
        self.assertFalse(move["captured"])

    def test_undo_restores_board_but_adds_one_noise(self):
        game = Game(self.levels[1])
        first = game.legal_moves()[0]
        game.apply(first["direction"])
        self.assertEqual(game.moves, 1)
        self.assertTrue(game.undo())
        self.assertEqual(game.state, game.initial)
        self.assertEqual(game.moves, 0)
        self.assertEqual(game.noise, 1)

    def test_gemma_move_is_validated_and_invalid_choice_uses_solver(self):
        game = Game(self.levels[0])
        with patch("slowpoke.ollama_chat", return_value={"move": "U"}):
            direction, source = agent_move(game, "gemma3")
        self.assertEqual((direction, source), ("U", "Gemma"))
        self.assertIsNotNone(game.legal_move(direction))

        with patch("slowpoke.ollama_chat", return_value={"move": "X"}):
            direction, source = agent_move(game, "gemma3")
        self.assertEqual(source, "local solver")
        self.assertIsNotNone(game.legal_move(direction))

    def test_json_levels_file_has_ten_levels(self):
        data = json.loads((Path(__file__).parent / "levels.json").read_text(encoding="utf-8"))
        self.assertEqual(len(data), 10)
        self.assertEqual([level["id"] for level in data], list(range(1, 11)))


if __name__ == "__main__":
    unittest.main()
