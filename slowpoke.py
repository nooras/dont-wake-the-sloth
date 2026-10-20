#!/usr/bin/env python3
"""Play Don't Wake the Sloth in a terminal with a local, validated Gemma agent."""

from __future__ import annotations

import argparse
import heapq
import json
import os
import random
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIRECTIONS = {
    "U": (-1, 0),
    "D": (1, 0),
    "L": (0, -1),
    "R": (0, 1),
}
NOISE_COST = {"#": None, ".": 1, "L": 0, "D": 3, "B": 1, "S": None, "P": 1, "M": 1}
SYSTEM_PROMPT = (
    "You are Slowpoke, a sarcastic, lazy noise consultant for a sleeping sloth. "
    "Reply in 1-2 short sentences, max 30 words. Be funny and dry. Give a real hint "
    "about the quietest next move using only the game state provided. Never reveal "
    "a full solution. Never invent objects that are not in the state. No emojis "
    "except 🦥 at most once. When asked to choose a move, choose one listed legal "
    "direction and return JSON only as {\"move\":\"U\"}."
)


@dataclass
class State:
    player: tuple[int, int]
    monkeys: tuple[tuple[int, int], ...]


class Game:
    def __init__(self, level: dict):
        self.level = level
        self.grid = [list(row) for row in level["grid"]]
        player = None
        monkeys = []
        for row, line in enumerate(self.grid):
            for col, tile in enumerate(line):
                if tile == "P":
                    player = (row, col)
                    line[col] = "."
                elif tile == "M":
                    monkeys.append((row, col))
                    line[col] = "."
        if player is None or not monkeys:
            raise ValueError(f"Level {level.get('id')} requires a player and at least one monkey.")
        self.initial = State(player, tuple(sorted(monkeys)))
        self.reset()

    def reset(self) -> None:
        self.state = State(self.initial.player, self.initial.monkeys)
        self.noise = 0
        self.moves = 0
        self.history: list[tuple[State, int, int]] = []

    def tile(self, row: int, col: int) -> str:
        if row < 0 or col < 0 or row >= len(self.grid) or col >= len(self.grid[row]):
            return "#"
        return self.grid[row][col]

    def legal_move(self, direction: str, state: State | None = None) -> dict | None:
        if direction not in DIRECTIONS:
            return None
        current = state or self.state
        dr, dc = DIRECTIONS[direction]
        row, col = current.player
        next_position = (row + dr, col + dc)
        tile = self.tile(*next_position)
        if tile in ("#", "S"):
            return None
        monkeys = list(current.monkeys)
        pushed = False
        captured = False
        if next_position in monkeys:
            beyond = (next_position[0] + dr, next_position[1] + dc)
            beyond_tile = self.tile(*beyond)
            if beyond_tile in ("#", "S") or beyond in monkeys:
                return None
            pushed = True
            captured = beyond_tile == "B"
            monkeys.remove(next_position)
            if not captured:
                monkeys.append(beyond)
        sloth = next(
            ((r, c) for r, line in enumerate(self.grid) for c, value in enumerate(line) if value == "S"),
            None,
        )
        is_quiet_zone = sloth is not None and abs(next_position[0] - sloth[0]) + abs(next_position[1] - sloth[1]) == 1
        cost = (NOISE_COST.get(tile, 1) or 0) * (2 if is_quiet_zone else 1) + int(pushed)
        return {
            "direction": direction,
            "state": State(next_position, tuple(sorted(monkeys))),
            "noise_cost": cost,
            "pushed": pushed,
            "captured": captured,
        }

    def legal_moves(self, state: State | None = None) -> list[dict]:
        return [move for direction in DIRECTIONS if (move := self.legal_move(direction, state))]

    def apply(self, direction: str) -> dict:
        move = self.legal_move(direction)
        if move is None:
            raise ValueError("That direction is not a legal move.")
        self.history.append((self.state, self.noise, self.moves))
        self.state = move["state"]
        self.noise += move["noise_cost"]
        self.moves += 1
        move["lost"] = self.noise >= self.level["noiseLimit"]
        move["won"] = not move["state"].monkeys and not move["lost"]
        return move

    def undo(self) -> bool:
        if not self.history:
            return False
        self.state, previous_noise, self.moves = self.history.pop()
        self.noise = previous_noise + 1
        return True

    def minimum_noise_path(self) -> list[str] | None:
        start = self.initial
        start_key = (start.player, start.monkeys)
        distances = {start_key: 0}
        parents: dict[tuple, tuple[tuple, str]] = {}
        queue = [(0, 0, start)]
        counter = 1
        while queue:
            cost, _, current = heapq.heappop(queue)
            key = (current.player, current.monkeys)
            if cost != distances.get(key):
                continue
            if not current.monkeys:
                path = []
                while key != start_key:
                    prior, direction = parents[key]
                    path.append(direction)
                    key = prior
                return list(reversed(path))
            for move in self.legal_moves(current):
                next_state = move["state"]
                next_key = (next_state.player, next_state.monkeys)
                next_cost = cost + move["noise_cost"]
                if next_cost < distances.get(next_key, float("inf")):
                    distances[next_key] = next_cost
                    parents[next_key] = (key, move["direction"])
                    heapq.heappush(queue, (next_cost, counter, next_state))
                    counter += 1
        return None

    def draw(self) -> None:
        height = len(self.grid)
        width = max(map(len, self.grid))
        print()
        for row in range(height):
            line = []
            for col in range(width):
                if self.state.player == (row, col):
                    line.append("P")
                elif (row, col) in self.state.monkeys:
                    line.append("M")
                else:
                    line.append(self.tile(row, col))
            print(" ".join(line))
        ratio = self.noise / self.level["noiseLimit"]
        stage = "AWAKE" if ratio >= 1 else "STIRRING" if ratio > 0.5 else "sleeping"
        print(f"{self.level['name']} | noise {self.noise}/{self.level['noiseLimit']} | moves {self.moves} | par {self.level['par']} | {stage}")


def load_levels() -> list[dict]:
    with (ROOT / "levels.json").open(encoding="utf-8") as source:
        levels = json.load(source)
    return levels


def ollama_chat(messages: list[dict], model: str, timeout: float = 45) -> dict:
    request = urllib.request.Request(
        os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/") + "/api/chat",
        data=json.dumps({
            "model": model,
            "messages": messages,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.35, "num_predict": 100},
        }).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode())
    content = payload.get("message", {}).get("content")
    if not isinstance(content, str):
        raise ValueError("Ollama returned no message content.")
    parsed = json.loads(content)
    if not isinstance(parsed, dict):
        raise ValueError("Gemma's reply was not a JSON object.")
    return parsed


def compact_state(game: Game) -> dict:
    return {
        "grid": ["".join(row) for row in game.level["grid"]],
        "player": game.state.player,
        "monkeys": game.state.monkeys,
        "noise": game.noise,
        "noiseLimit": game.level["noiseLimit"],
        "moves": game.moves,
    }


def agent_move(game: Game, model: str) -> tuple[str, str]:
    moves = game.legal_moves()
    if not moves:
        raise RuntimeError("No legal moves remain.")
    available = [
        {"direction": move["direction"], "noiseCost": move["noise_cost"],
         "pushesMonkey": move["pushed"], "capturesMonkey": move["captured"]}
        for move in moves
    ]
    try:
        result = ollama_chat([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": (
                "Choose one legal next move toward a quiet win. Do not provide a sequence. "
                "The game validates and applies your single move. Return JSON as "
                "{\"move\":\"U\"}. State: " + json.dumps({
                    "state": compact_state(game),
                    "legalMoves": available,
                })
            )},
        ], model)
        direction = result.get("move")
        if isinstance(direction, str) and any(move["direction"] == direction.upper() for move in moves):
            return direction.upper(), "Gemma"
        print("Gemma suggested an unavailable move; the game is choosing a validated route.")
    except (OSError, TimeoutError, ValueError, urllib.error.URLError, json.JSONDecodeError) as error:
        print(f"Gemma is napping 🦥 ({error}); using the local solver.")
    path = game.minimum_noise_path()
    if path:
        return path[0], "local solver"
    return moves[0]["direction"], "safe legal-move fallback"


def star_count(noise: int, par: int) -> int:
    return 3 if noise <= par else 2 if noise <= par + 3 else 1


def finish_message(game: Game, model: str) -> None:
    stars = star_count(game.noise, game.level["par"])
    print(f"\nLevel complete: {game.moves} moves, {game.noise} noise, {'★' * stars}{'☆' * (3 - stars)}.")
    try:
        roast = ollama_chat([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": (
                "Give a one-line dry review of this completed run: " +
                json.dumps({"level": game.level["name"], "moves": game.moves,
                            "noise": game.noise, "par": game.level["par"], "stars": stars})
            )},
        ], model)
        print(roast.get("text", roast.get("quip", "The sloth remains asleep. A suspiciously competent performance.")))
    except (OSError, TimeoutError, ValueError, urllib.error.URLError, json.JSONDecodeError):
        print(random.choice([
            "The sloth slept through it. Try not to make a habit of being this efficient.",
            "A fine quiet run. I would clap, but that sounds exhausting.",
        ]))


def play(levels: list[dict], starting_level: int, model: str) -> None:
    index = starting_level - 1
    while index < len(levels):
        game = Game(levels[index])
        print("\nDon't Wake the Sloth — local terminal agent")
        print("Commands: W/A/S/D move · G Gemma agent move · U undo (+1 noise) · R restart · Q quit")
        print("Model decisions are suggestions; the local game engine validates every move.")
        while True:
            game.draw()
            command = input("\nMove> ").strip().upper()
            if command in ("Q", "QUIT", "EXIT"):
                return
            if command in ("R", "RESTART"):
                game.reset()
                continue
            if command in ("U", "UNDO"):
                if not game.undo():
                    print("There is no move to undo.")
                elif game.noise >= game.level["noiseLimit"]:
                    print("The sloth woke up from the undo rustle. Restart the level.")
                    break
                continue
            if command in ("G", "AGENT"):
                try:
                    direction, source = agent_move(game, model)
                    print(f"{source} chooses {direction}.")
                    outcome = game.apply(direction)
                except (RuntimeError, ValueError) as error:
                    print(error)
                    continue
            elif command in DIRECTIONS:
                try:
                    outcome = game.apply(command)
                except ValueError as error:
                    print(error)
                    continue
            else:
                print("Use W, A, S, D, G, U, R, or Q.")
                continue
            if outcome["lost"]:
                game.draw()
                print("The sloth woke up. The level is lost; press R to restart or Q to leave.")
                break
            if outcome["won"]:
                game.draw()
                finish_message(game, model)
                if index + 1 >= len(levels):
                    print(f"All {len(levels)} levels complete. Slow and steady wins.")
                    return
                next_level = input("Press N for the next level, R to retry, or Q to quit: ").strip().upper()
                if next_level == "N":
                    index += 1
                    break
                if next_level == "R":
                    break
                return


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local Don't Wake the Sloth Gemma agent.")
    parser.add_argument("--level", type=int, default=1, choices=range(1, 11), help="level to start at (1-10)")
    parser.add_argument("--model", default=os.environ.get("SLOWPOKE_MODEL", "gemma3"), help="local Ollama model name")
    args = parser.parse_args()
    levels = load_levels()
    play(levels, args.level, args.model)


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\nSlowpoke has gone back to sleep.")
        sys.exit(0)
