"use strict";

const fs = require("node:fs");
const path = require("node:path");

const NOISE = { "#": Infinity, ".": 1, L: 0, D: 3, S: Infinity, P: 1, M: 1, B: 1 };
const DIRECTIONS = [
  ["U", -1, 0],
  ["D", 1, 0],
  ["L", 0, -1],
  ["R", 0, 1]
];

function parseLevel(level) {
  const grid = level.grid.map((row) => [...row]);
  let player = null;
  const monkeys = [];
  for (let row = 0; row < grid.length; row += 1) {
    for (let col = 0; col < grid[row].length; col += 1) {
      if (grid[row][col] === "P") {
        player = [row, col];
        grid[row][col] = ".";
      } else if (grid[row][col] === "M") {
        monkeys.push([row, col]);
        grid[row][col] = ".";
      }
    }
  }
  if (!player || monkeys.length === 0) throw new Error(`Level ${level.id} needs a player and at least one monkey.`);
  return { grid, player, monkeys };
}

function stateKey(player, monkeys) {
  return `${player[0]},${player[1]}|${monkeys.map(([row, col]) => `${row},${col}`).sort().join(";")}`;
}

function step(level, state, direction) {
  const [letter, dr, dc] = direction;
  const [row, col] = state.player;
  const nextRow = row + dr;
  const nextCol = col + dc;
  const tile = level.grid[nextRow]?.[nextCol] ?? "#";
  if (tile === "#" || tile === "S") return null;

  const monkeys = state.monkeys.map((position) => [...position]);
  let pushed = false;
  let captured = false;
  const monkeyIndex = monkeys.findIndex(([mr, mc]) => mr === nextRow && mc === nextCol);
  if (monkeyIndex !== -1) {
    const beyondRow = nextRow + dr;
    const beyondCol = nextCol + dc;
    const beyondTile = level.grid[beyondRow]?.[beyondCol] ?? "#";
    if (beyondTile === "#" || beyondTile === "S"
      || monkeys.some((position, index) => index !== monkeyIndex && position[0] === beyondRow && position[1] === beyondCol)) {
      return null;
    }
    pushed = true;
    captured = beyondTile === "B";
    if (captured) monkeys.splice(monkeyIndex, 1);
    else monkeys[monkeyIndex] = [beyondRow, beyondCol];
  }
  const sloth = level.grid.flatMap((line, r) => line.map((value, c) => value === "S" ? [r, c] : null).filter(Boolean))[0];
  const nextToSloth = sloth && Math.abs(nextRow - sloth[0]) + Math.abs(nextCol - sloth[1]) === 1;
  const cost = (NOISE[tile] ?? 1) * (nextToSloth ? 2 : 1) + (pushed ? 1 : 0);
  return {
    letter,
    cost,
    state: { player: [nextRow, nextCol], monkeys },
    won: monkeys.length === 0
  };
}

function minimumNoise(levelData) {
  const level = parseLevel(levelData);
  const initial = { player: level.player, monkeys: level.monkeys };
  const distances = new Map([[stateKey(initial.player, initial.monkeys), 0]]);
  const queue = [{ state: initial, cost: 0 }];

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    const currentKey = stateKey(current.state.player, current.state.monkeys);
    if (current.cost !== distances.get(currentKey)) continue;
    if (current.state.monkeys.length === 0) return current.cost;

    for (const direction of DIRECTIONS) {
      const outcome = step(level, current.state, direction);
      if (!outcome) continue;
      const nextCost = current.cost + outcome.cost;
      const nextKey = stateKey(outcome.state.player, outcome.state.monkeys);
      if (nextCost < (distances.get(nextKey) ?? Infinity)) {
        distances.set(nextKey, nextCost);
        queue.push({ state: outcome.state, cost: nextCost });
      }
    }
  }
  return null;
}

function solveAll(levels) {
  return levels.map((level) => ({ id: level.id, name: level.name, par: minimumNoise(level) }));
}

if (require.main === module) {
  const levelsPath = process.argv[2] || path.join(__dirname, "levels.json");
  const levels = JSON.parse(fs.readFileSync(levelsPath, "utf8"));
  for (const result of solveAll(levels)) {
    if (result.par === null) throw new Error(`Level ${result.id} is not solvable.`);
    console.log(`Level ${result.id} — ${result.name}: par ${result.par}`);
  }
}

module.exports = { minimumNoise, parseLevel, solveAll, step };
