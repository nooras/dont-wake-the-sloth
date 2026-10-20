# Don't Wake the Sloth

A small React puzzle game and **local AI agent**. Play in the browser, or run the terminal game and ask the local Gemma agent to choose validated moves. The game rules, level solver, and move validation are deterministic Python/JavaScript; Gemma can suggest a move or write commentary, but it cannot alter the board rules or apply an illegal move.

No sign-up, API keys, external images, or audio files are needed. The terminal game runs using Python's standard library. The React browser app uses Vite and needs one local dependency install; after that, the app and gameplay run locally. Gemma features need a local Ollama installation and a downloaded model.

## Start the local Gemma agent

Install [Ollama](https://ollama.com), then download Gemma and start Ollama:

```sh
ollama pull gemma3
ollama serve
```

In another terminal, start the agent:

```sh
python3 slowpoke.py
```

Use **W/A/S/D** to move, **G** to ask Gemma to choose and execute one legal move, **U** to undo (the undo rustle adds one noise), **R** to restart, and **Q** to quit. The agent falls back to a local minimum-noise solver if Ollama is sleeping or unavailable. To start at a later level or use a different locally installed model:

```sh
python3 slowpoke.py --level 3 --model gemma3
```

The model can also be configured using `SLOWPOKE_MODEL`, and the local Ollama address using `OLLAMA_HOST` (default `http://localhost:11434`).

## Start the browser game

Install the React dependencies once, then start the Vite development server:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite (usually <http://localhost:5173>). Use the arrow keys or WASD, tap a highlighted neighboring tile, or use the on-screen directional pad on phones and touch devices. Levels unlock in order after winning. The browser stores the unlocked level in local storage.

To create a static production build, run `npm run build`. To serve that build locally, run `npm run preview`.

The first interaction starts the Web Audio ambient jungle and slow lullaby; use the mute button and volume slider to adjust them. Audio is synthesized with the Web Audio API.

## Deploy to Render

The root `render.yaml` defines this as a Render **Web Service**. The Node server serves the production build and binds to `0.0.0.0` on Render's `PORT`. Create a Blueprint from the Git repository containing this file, or create a Node Web Service manually with:

- Build command: `npm ci && npm run build`
- Start command: `npm start`

`package.json` specifies a compatible Node.js version for Vite. Browser AI features call Ollama at the configured address; on a hosted site, `localhost` means the visitor's own computer, so Ollama must be running there and permit the deployed site origin.

### Connect browser Gemma

The browser game calls Ollama on `http://localhost:11434/api/chat`, using the model name from **Local Gemma settings** (default `gemma3:latest`). Install the model first with `ollama pull gemma3`. If the browser cannot access Ollama due to origin policy, launch Ollama with browser access enabled:

```sh
OLLAMA_ORIGINS="*" ollama serve
```

Gemma provides consultant hints, a short sloth dream once noise passes halfway, and a post-level review. If Gemma cannot be reached, the browser displays a canned napping message and the deterministic puzzle remains playable. The browser and the terminal agent both validate every move locally.

## Levels and solver

`levels.json` contains ten boards, tips, noise limits, and par values. Run the Dijkstra solver to calculate the minimum noise and print each level's par:

```sh
node solver.js
```

The browser's level JSON is also used directly by the terminal agent. If you edit a board, re-run the solver and update its `par` field to the calculated value.

Run the local game-engine tests with:

```sh
python3 -m unittest -v
```

## Rules

- The player moves one tile orthogonally. Walls and the sleeping sloth block movement.
- Walking into a monkey pushes it one tile if its landing tile is not blocked by a wall, sloth, or another monkey. A push onto a banana captures the monkey.
- Destination noise is floor 1, leaf 0, dry twig 3, or banana 1. A destination next to the sloth doubles that tile cost; pushing adds 1.
- All monkeys must be captured before noise reaches the level limit.
- Undo restores the previous board and move count but adds 1 noise.
- Three stars are awarded at or under par, two within three noise of par, and one otherwise.

## Files

- `index.html`, `src/` — React browser puzzle, UI state, deterministic game rules, local Gemma connection, and audio.
- `package.json` — local React/Vite development and build commands.
- `slowpoke.py` — interactive local terminal game and validated Gemma agent.
- `src/ai.js` — browser Ollama integration and offline canned commentary.
- `src/audio.js` — synthesized ambience, lullaby, and action sounds.
- `src/game.js` — deterministic React game rules.
- `levels.json` — the ten puzzle levels.
- `solver.js` — Dijkstra solver and par calculator.
- `test_agent.py` — local terminal game and solver tests.
