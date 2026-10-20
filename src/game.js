export const DIRECTIONS = {
  ArrowUp: [-1, 0, "U"],
  w: [-1, 0, "U"],
  ArrowDown: [1, 0, "D"],
  s: [1, 0, "D"],
  ArrowLeft: [0, -1, "L"],
  a: [0, -1, "L"],
  ArrowRight: [0, 1, "R"],
  d: [0, 1, "R"],
};

const DIRECTION_LIST = [
  { delta: [-1, 0], key: "U" },
  { delta: [1, 0], key: "D" },
  { delta: [0, -1], key: "L" },
  { delta: [0, 1], key: "R" },
];
const TILE_NOISE = { "#": Infinity, ".": 1, L: 0, D: 3, B: 1, S: Infinity, P: 1, M: 1 };

export function parseLevel(level) {
  const grid = level.grid.map((line) => [...line]);
  let player = null;
  const monkeys = [];

  for (let row = 0; row < grid.length; row += 1) {
    for (let col = 0; col < grid[row].length; col += 1) {
      if (grid[row][col] === "P") {
        player = { row, col };
        grid[row][col] = ".";
      } else if (grid[row][col] === "M") {
        monkeys.push({ row, col });
        grid[row][col] = ".";
      }
    }
  }

  if (!player || monkeys.length === 0) {
    throw new Error(`Level ${level.id} must contain a player and at least one monkey.`);
  }
  return { grid: grid.map((line) => line.join("")), player, monkeys };
}

export function initialState(level) {
  return {
    player: { ...level.player },
    monkeys: level.monkeys.map((monkey) => ({ ...monkey })),
  };
}

export function transition(grid, source, direction) {
  const [dr, dc] = direction.delta;
  const row = source.player.row + dr;
  const col = source.player.col + dc;
  const tile = grid[row]?.[col] ?? "#";
  if (tile === "#" || tile === "S") return null;

  const monkeys = source.monkeys.map((monkey) => ({ ...monkey }));
  const monkeyIndex = monkeys.findIndex((monkey) => monkey.row === row && monkey.col === col);
  let pushed = false;
  let captured = false;

  if (monkeyIndex !== -1) {
    const beyondRow = row + dr;
    const beyondCol = col + dc;
    const beyondTile = grid[beyondRow]?.[beyondCol] ?? "#";
    if (
      beyondTile === "#" ||
      beyondTile === "S" ||
      monkeys.some((monkey, index) => index !== monkeyIndex && monkey.row === beyondRow && monkey.col === beyondCol)
    ) {
      return null;
    }
    pushed = true;
    captured = beyondTile === "B";
    if (captured) monkeys.splice(monkeyIndex, 1);
    else monkeys[monkeyIndex] = { row: beyondRow, col: beyondCol };
  }

  let sloth = null;
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < grid[r].length; c += 1) {
      if (grid[r][c] === "S") sloth = { row: r, col: c };
    }
  }
  const nextToSloth =
    sloth && Math.abs(row - sloth.row) + Math.abs(col - sloth.col) === 1;
  const noiseCost = (TILE_NOISE[tile] ?? 1) * (nextToSloth ? 2 : 1) + Number(pushed);
  return {
    direction: direction.key,
    to: { row, col },
    player: { row, col },
    monkeys,
    tile,
    pushed,
    captured,
    noiseCost,
  };
}

export function legalMoves(grid, state) {
  return DIRECTION_LIST.map((direction) => transition(grid, state, direction)).filter(Boolean);
}

export function makeSnapshot(state) {
  return {
    player: { ...state.player },
    monkeys: state.monkeys.map((monkey) => ({ ...monkey })),
    noise: state.noise,
    moves: state.moves,
  };
}

export function starCount(noise, par) {
  if (noise <= par) return 3;
  if (noise <= par + 3) return 2;
  return 1;
}
