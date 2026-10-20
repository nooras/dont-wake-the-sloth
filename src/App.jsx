import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import levels from "../levels.json";
import {
  DIRECTIONS,
  initialState,
  legalMoves,
  makeSnapshot,
  parseLevel,
  starCount,
  transition,
} from "./game.js";
import {
  makeDreamPrompt,
  makeHintPrompt,
  makeRoastPrompt,
  runConsultant,
} from "./ai.js";
import { createAudio } from "./audio.js";

const LEVEL_UNLOCK_KEY = "sloth-unlocked-level-v2";
const LEVEL_COLORS = { "#": "wall", ".": "floor", L: "leaf", D: "twig", B: "banana", S: "sloth" };
const TILE_LABELS = { "#": "wall", ".": "floor", L: "leaf", D: "dry twig", B: "banana", S: "sloth" };
const TILE_EMOJI = { "#": "🧱", ".": "", L: "🍃", D: "🪵", B: "🍌", S: "🦥" };
const WELCOME =
  "I am conserving energy. Ask if you need a hint; please do not make it a long one.";

function storedUnlock() {
  try {
    const value = Number(localStorage.getItem(LEVEL_UNLOCK_KEY) || "1");
    return Number.isInteger(value) ? Math.max(1, Math.min(levels.length, value)) : 1;
  } catch {
    return 1;
  }
}

function initialLevelState(level) {
  const parsed = parseLevel(level);
  return {
    ...initialState(parsed),
    noise: 0,
    moves: 0,
    history: [],
    gameOver: false,
    won: false,
    stage: "sleeping",
    stateAtHalf: false,
  };
}

function App() {
  const [levelIndex, setLevelIndex] = useState(0);
  const [unlockLevel, setUnlockLevel] = useState(storedUnlock);
  const [game, setGame] = useState(() => initialLevelState(levels[0]));
  const [message, setMessage] = useState("Use arrow keys, WASD, or tap a highlighted tile.");
  const [assistantText, setAssistantText] = useState(WELCOME);
  const [captureEffect, setCaptureEffect] = useState(null);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.28);
  const [readAloud, setReadAloud] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [model, setModel] = useState("gemma3:latest");
  const audioRef = useRef(null);
  const requestRef = useRef(0);
  const captureTimerRef = useRef(null);

  if (!audioRef.current) audioRef.current = createAudio();
  const audio = audioRef.current;
  const level = levels[levelIndex];
  const parsedLevel = useMemo(() => parseLevel(level), [level]);
  const moves = game.gameOver ? [] : legalMoves(parsedLevel.grid, game);
  const progress = Math.min(100, (game.noise / level.noiseLimit) * 100);
  const stars = game.won ? starCount(game.noise, level.par) : 0;
  const ollamaConfig = { endpoint: ollamaUrl, model };

  useEffect(() => {
    return () => {
      requestRef.current += 1;
      audio.stop();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [audio]);

  useEffect(() => {
    if (!captureEffect) return undefined;
    captureTimerRef.current = window.setTimeout(() => setCaptureEffect(null), 1100);
    return () => window.clearTimeout(captureTimerRef.current);
  }, [captureEffect]);

  const loadLevel = useCallback(
    (index) => {
      if (index < 0 || index >= levels.length || index + 1 > unlockLevel) return;
      requestRef.current += 1;
      setBusy(false);
      setLevelIndex(index);
      setGame(initialLevelState(levels[index]));
      setCaptureEffect(null);
      setMessage("Use arrow keys, WASD, or tap a highlighted tile.");
      setAssistantText(WELCOME);
      audio.stage("sleeping");
    },
    [audio, unlockLevel],
  );

  const updateNoiseStage = useCallback(
    (nextGame) => {
      const ratio = nextGame.noise / level.noiseLimit;
      const nextStage = ratio >= 1 ? "awake" : ratio >= 0.5 ? "stirring" : "sleeping";
      if (nextStage !== nextGame.stage) audio.stage(nextStage);
      nextGame.stage = nextStage;
      const crossedHalf = ratio >= 0.5 && ratio < 1 && !nextGame.stateAtHalf;
      if (crossedHalf) nextGame.stateAtHalf = true;
      return { nextGame, crossedHalf };
    },
    [audio, level.noiseLimit],
  );

  const askDream = useCallback(
    async (nextGame) => {
      const requestId = requestRef.current;
      await runConsultant(
        makeDreamPrompt({
          noise: nextGame.noise,
          noiseLimit: level.noiseLimit,
        }),
        ollamaConfig,
        (text) => {
          if (requestId === requestRef.current) setAssistantText(text);
        },
        readAloud,
        12,
      );
    },
    [level.noiseLimit, ollamaConfig, readAloud],
  );

  const makeMove = useCallback(
    (key) => {
      if (game.gameOver || busy) return;
      audio.start();
      const direction = Object.values(DIRECTIONS).find((value) => value[2] === key);
      if (!direction) return;
      const outcome = transition(parsedLevel.grid, game, {
        delta: [direction[0], direction[1]],
        key,
      });
      if (!outcome) {
        setMessage("That move is blocked. Monkeys need a clear tile to land on.");
        return;
      }

      const nextGame = {
        ...game,
        player: outcome.player,
        monkeys: outcome.monkeys,
        noise: game.noise + outcome.noiseCost,
        moves: game.moves + 1,
        history: [...game.history, makeSnapshot(game)],
      };
      audio.action(outcome.tile, outcome.pushed, outcome.captured, outcome.noiseCost);
      const { nextGame: stagedGame, crossedHalf } = updateNoiseStage(nextGame);
      if (outcome.captured) setCaptureEffect(outcome.capturedAt);

      if (stagedGame.noise >= level.noiseLimit) {
        stagedGame.gameOver = true;
        stagedGame.won = false;
        setGame(stagedGame);
        setMessage("The sloth woke up! The level is lost. Restart and try a quieter route.");
        return;
      }

      if (stagedGame.monkeys.length === 0) {
        stagedGame.gameOver = true;
        stagedGame.won = true;
        const newUnlock = Math.max(unlockLevel, Math.min(levels.length, levelIndex + 2));
        setUnlockLevel(newUnlock);
        try {
          localStorage.setItem(LEVEL_UNLOCK_KEY, String(newUnlock));
        } catch {
          setMessage(`All monkeys are safe! ${starCount(stagedGame.noise, level.par)} stars earned.`);
        }
        setGame(stagedGame);
        setMessage(
          `All monkeys are safe! ${starCount(stagedGame.noise, level.par)} ${
            starCount(stagedGame.noise, level.par) === 1 ? "star" : "stars"
          } earned with ${stagedGame.noise} noise.`,
        );
        audio.win();
        const requestId = ++requestRef.current;
        runConsultant(
          makeRoastPrompt({
            levelId: level.id,
            levelName: level.name,
            moves: stagedGame.moves,
            noise: stagedGame.noise,
            par: level.par,
            stars: starCount(stagedGame.noise, level.par),
          }),
          ollamaConfig,
          (text) => {
            if (requestId === requestRef.current) setAssistantText(text);
          },
          readAloud,
        );
        return;
      }

      setGame(stagedGame);
      setMessage(
        outcome.captured
          ? `Monkey captured on the banana! +${outcome.noiseCost} noise.`
          : `${key}: ${outcome.pushed ? "monkey pushed" : "quiet step"} · +${outcome.noiseCost} noise.`,
      );
      if (crossedHalf) askDream(stagedGame);
    },
    [
      askDream,
      audio,
      busy,
      game,
      level,
      levelIndex,
      ollamaConfig,
      parsedLevel.grid,
      readAloud,
      unlockLevel,
      updateNoiseStage,
    ],
  );

  const undo = useCallback(() => {
    if (!game.history.length || game.gameOver || busy) return;
    const history = [...game.history];
    const previous = history.pop();
    const nextGame = {
      ...game,
      ...previous,
      history,
      noise: previous.noise + 1,
      gameOver: false,
      won: false,
    };
    audio.action(".", false, false, 1);
    const { nextGame: stagedGame, crossedHalf } = updateNoiseStage(nextGame);
    if (stagedGame.noise >= level.noiseLimit) {
      stagedGame.gameOver = true;
      setMessage("The undo rustle used the last noise point. The sloth woke up!");
    } else {
      setMessage("Undone. The board rewound; that rustle still cost 1 noise.");
    }
    setGame(stagedGame);
    if (crossedHalf && !stagedGame.gameOver) askDream(stagedGame);
  }, [askDream, audio, busy, game, level.noiseLimit, updateNoiseStage]);

  const askConsultant = useCallback(async () => {
    if (busy || game.gameOver) return;
    setBusy(true);
    const requestId = ++requestRef.current;
    const legalMoves = moves.map((move) => ({
      direction: move.direction,
      destination: move.to,
      noiseCost: move.noiseCost,
      pushesMonkey: move.pushed,
      capturesMonkey: move.captured,
    }));
    try {
      await runConsultant(
        makeHintPrompt({
          grid: level.grid,
          player: game.player,
          monkeys: game.monkeys,
          noise: game.noise,
          noiseLimit: level.noiseLimit,
          moves: game.moves,
        }, legalMoves),
        ollamaConfig,
        (text) => {
          if (requestId === requestRef.current) setAssistantText(text);
        },
        readAloud,
      );
    } finally {
      if (requestId === requestRef.current) setBusy(false);
    }
  }, [busy, game, level, moves, ollamaConfig, readAloud]);

  useEffect(() => {
    function onKeyDown(event) {
      const direction = DIRECTIONS[event.key] || DIRECTIONS[event.key.toLowerCase()];
      if (
        !direction ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLButtonElement
      ) {
        return;
      }
      event.preventDefault();
      makeMove(direction[2]);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [makeMove]);

  function resetLevel() {
    requestRef.current += 1;
    setBusy(false);
    setGame(initialLevelState(level));
    setCaptureEffect(null);
    setMessage("Use arrow keys, WASD, or tap a highlighted tile.");
    setAssistantText(WELCOME);
    audio.stage("sleeping");
  }

  function toggleMute() {
    audio.start();
    const nextMuted = !muted;
    setMuted(nextMuted);
    audio.setMuted(nextMuted);
  }

  function changeVolume(value) {
    const nextVolume = Number(value);
    setVolume(nextVolume);
    audio.start();
    audio.setVolume(nextVolume);
    if (nextVolume > 0 && muted) {
      setMuted(false);
      audio.setMuted(false);
    }
  }

  const status = game.stage;

  return (
    <main className="page">
      <header>
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">🌿</div>
          <div>
            <p className="eyebrow">Slow and steady</p>
            <h1>Don't Wake the Sloth</h1>
          </div>
        </div>
        <div className="head-actions" aria-label="Game controls">
          <button className="button" type="button" onClick={undo} disabled={!game.history.length || game.gameOver || busy}>
            ↶ Undo (+1 noise)
          </button>
          <button className="button" type="button" onClick={resetLevel} disabled={busy}>↻ Restart</button>
          <button className="button" type="button" onClick={toggleMute} aria-pressed={muted}>
            {muted ? "♫ Sound off" : "♫ Sound on"}
          </button>
          <label className="button volume-control">
            Volume
            <input
              aria-label="Volume"
              type="range"
              min="0"
              max="0.7"
              step="0.01"
              value={volume}
              onChange={(event) => changeVolume(event.target.value)}
            />
          </label>
        </div>
      </header>
      <div className="layout">
        <section className="card board-card" aria-labelledby="level-name">
          <div className="board-head">
            <div>
              <p className="level-name">Level {level.id} of {levels.length}</p>
              <h2 id="level-name">{level.name}</h2>
            </div>
            <span className={`stage ${status}`} aria-live="polite">
              {status === "awake" ? "🚨 Awake!" : status === "stirring" ? "🥱 Stirring" : "😴 Sleeping"}
            </span>
          </div>
          <div className="board-wrap">
            <div
              className="board"
              role="grid"
              aria-label="Puzzle board"
              style={{ gridTemplateColumns: `repeat(${level.grid[0].length}, clamp(34px, 7.2vw, 62px))` }}
            >
              {level.grid.map((rowText, row) =>
                [...rowText].map((tile, col) => {
                  const isPlayer = game.player.row === row && game.player.col === col;
                  const hasMonkey = game.monkeys.some((monkey) => monkey.row === row && monkey.col === col);
                  const isLegal = moves.some((move) => move.to.row === row && move.to.col === col);
                  const isCaptureEffect =
                    captureEffect?.row === row && captureEffect?.col === col && !hasMonkey;
                  const character = isPlayer ? "🧑" : hasMonkey ? "🐒" : TILE_EMOJI[tile];
                  const label = isPlayer
                    ? "player"
                    : hasMonkey
                      ? "monkey"
                      : isCaptureEffect
                        ? "banana, monkey captured"
                        : TILE_LABELS[tile] || "floor";
                  return (
                    <button
                      key={`${row}-${col}`}
                      className={[
                        "tile",
                        LEVEL_COLORS[tile] || "floor",
                        isPlayer && "player",
                        hasMonkey && "monkey",
                        isCaptureEffect && "captured",
                        isLegal && "highlight",
                        game.gameOver && !game.won && tile !== "#" && tile !== "S" && "noisy",
                      ].filter(Boolean).join(" ")}
                      type="button"
                      role="gridcell"
                      aria-label={`${label}, row ${row + 1}, column ${col + 1}${isLegal ? ", possible move" : ""}`}
                      disabled={!isLegal || game.gameOver || busy}
                      onClick={() => {
                        const move = moves.find((option) => option.to.row === row && option.to.col === col);
                        if (move) makeMove(move.direction);
                      }}
                    >
                      {isCaptureEffect ? (
                        <>
                          <span>🍌</span><span className="capture-burst" aria-hidden="true">✨</span>
                        </>
                      ) : character}
                    </button>
                  );
                }),
              )}
            </div>
          </div>
          <div className="legend">
            <span>🧱 wall</span><span>🍃 leaf · silent</span><span>🪵 twig · loud</span>
            <span>🐒 monkey</span><span>🍌 target</span><span>🦥 sleeping</span>
          </div>
          <div className="stats">
            <div className="stat">
              <span>Noise / limit</span>
              <strong>{game.noise} / {level.noiseLimit}</strong>
              <div className="meter" aria-label={`${Math.round(progress)}% of noise limit`}>
                <div className={`meter-fill ${status}`} style={{ width: `${progress}%` }} />
              </div>
            </div>
            <div className="stat"><span>Moves</span><strong>{game.moves}</strong></div>
            <div className="stat">
              <span>Par / stars</span>
              <strong>{level.par} / {"★".repeat(stars)}{"☆".repeat(3 - stars)}</strong>
            </div>
          </div>
          <p className="level-tip">Tip: {level.tip}</p>
          <p className={`message ${game.gameOver && !game.won ? "error" : ""}`} aria-live="polite">{message}</p>
        </section>
        <aside className="right">
          <section className="card agent-card" aria-labelledby="consultant-heading">
            <div className="agent-heading">
              <div className="avatar" aria-hidden="true">🦥</div>
              <div><h2 id="consultant-heading">Slowpoke</h2><p>Local Gemma noise consultant</p></div>
            </div>
            <p className="agent-text" aria-live="polite">{busy ? "Thinking. Please do not rush the consultant." : assistantText}</p>
            <button className="button primary" type="button" onClick={askConsultant} disabled={busy || game.gameOver}>
              {busy ? "Consulting…" : "Ask the Consultant"}
            </button>
            <div className="action-grid">
              <button
                className="button"
                type="button"
                onClick={() => loadLevel(levelIndex + 1)}
                disabled={!game.won || levelIndex + 1 >= levels.length}
              >
                Next level →
              </button>
              <label className="button check-row">
                <input type="checkbox" checked={readAloud} onChange={(event) => setReadAloud(event.target.checked)} />
                Read aloud
              </label>
            </div>
            <details>
              <summary>Local Gemma settings</summary>
              <div className="settings">
                <label>
                  Ollama address
                  <input type="url" value={ollamaUrl} onChange={(event) => setOllamaUrl(event.target.value)} autoComplete="url" />
                </label>
                <label>
                  Model name
                  <input type="text" value={model} onChange={(event) => setModel(event.target.value)} autoComplete="off" />
                </label>
                <p className="settings-note">
                  Ollama runs on your computer. Install Gemma with <code>ollama pull gemma3</code>.
                  If browser requests are blocked, set <code>OLLAMA_ORIGINS="*"</code> before starting Ollama.
                </p>
              </div>
            </details>
          </section>
          <section className="card level-card">
            <h2 className="level-title">Choose a level</h2>
            <nav className="level-list" aria-label="Level select">
              {levels.map((option, index) => {
                const unlocked = index + 1 <= unlockLevel;
                return (
                  <button
                    className={`level-choice ${index === levelIndex ? "current" : ""}`}
                    key={option.id}
                    type="button"
                    disabled={!unlocked || busy}
                    aria-current={index === levelIndex ? "step" : undefined}
                    onClick={() => loadLevel(index)}
                  >
                    <span>{unlocked ? "🌱" : "🔒"} {option.id}. {option.name}</span>
                    <span>{unlocked ? (index + 1 < unlockLevel ? "cleared" : "open") : "locked"}</span>
                  </button>
                );
              })}
            </nav>
          </section>
          <div className="local-badge">🔒 Running locally with Gemma, no internet needed</div>
        </aside>
      </div>
      <p className="footer-note">
        No external images or audio files. Game rules are deterministic; Gemma only provides suggestions and commentary.
      </p>
    </main>
  );
}

export default App;
