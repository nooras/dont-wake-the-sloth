const SYSTEM_PROMPT =
  "You are Slowpoke, a sarcastic, lazy noise consultant for a sleeping sloth. " +
  "Reply in 1-2 short sentences, max 30 words. Be funny and dry. Give a real hint " +
  "about the quietest next move using only the game state provided. Never reveal " +
  "a full solution. Never invent objects that are not in the state. No emojis " +
  "except 🦥 at most once.";

const FALLBACKS = [
  "I would suggest the quiet route, but walking there sounds exhausting.",
  "Try pushing only when the landing square is clear. I learned that by not moving.",
  "The sloth is asleep. Let us keep the board's dramatic noises to a minimum.",
  "A leaf costs nothing. Frankly, it has the right idea.",
];

function extractPartialText(raw, maxWords) {
  const match = /"text"\s*:\s*"/.exec(raw);
  if (!match) return "";
  const start = match.index + match[0].length;
  let escaped = false;
  let end = start;
  for (; end < raw.length; end += 1) {
    if (escaped) escaped = false;
    else if (raw[end] === "\\") escaped = true;
    else if (raw[end] === '"') break;
  }
  try {
    return JSON.parse(`"${raw.slice(start, end)}${end === raw.length ? '"' : ""}`)
      .split(/\s+/)
      .slice(0, maxWords)
      .join(" ");
  } catch {
    return "";
  }
}

async function request(prompt, { model, endpoint, maxWords, onPartial }) {
  const response = await fetch(`${endpoint.replace(/\/+$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model.trim() || "gemma3:latest",
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `${prompt}\nKeep the response to ${maxWords} words or fewer. Reply with JSON only: {"text":"..."}`,
        },
      ],
      format: "json",
      options: { temperature: 0.3, num_predict: 160 },
    }),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
  if (!response.body) throw new Error("Ollama did not provide a streaming response.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finished = false;
  while (!finished) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line);
      if (typeof chunk.message?.content === "string") {
        content += chunk.message.content;
        onPartial(extractPartialText(content, maxWords));
      }
      if (chunk.done) finished = true;
    }
    if (done) finished = true;
  }
  if (buffer.trim()) {
    const last = JSON.parse(buffer);
    if (typeof last.message?.content === "string") content += last.message.content;
  }
  const parsed = JSON.parse(content);
  if (typeof parsed.text !== "string" || !parsed.text.trim()) {
    throw new Error("Gemma returned no text.");
  }
  return parsed.text.trim().split(/\s+/).slice(0, maxWords).join(" ");
}

export async function consultantLine(prompt, config, onPartial, maxWords = 30) {
  try {
    const text = await request(prompt, { ...config, maxWords, onPartial });
    onPartial(text);
    return { text, offline: false };
  } catch (error) {
    const text = `Gemma is napping 🦥 ${FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)]}`;
    onPartial(text);
    return { text, offline: true, error };
  }
}

export function makeHintPrompt(state, moves) {
  return `Give one actionable next-step hint without disclosing the solution. Compact game state JSON: ${JSON.stringify({
    grid: state.grid,
    player: state.player,
    monkeys: state.monkeys,
    noise: state.noise,
    noiseLimit: state.noiseLimit,
    moves: state.moves,
    legalMoves: moves,
  })}`;
}

export function makeRoastPrompt(state) {
  return `The player finished level ${state.levelId} (${state.levelName}) in ${state.moves} moves, using ${state.noise} noise against par ${state.par}, earning ${state.stars} stars. Give a dry one-line review.`;
}

export function makeDreamPrompt(state) {
  return `At ${state.noise} of ${state.noiseLimit} noise, write one brief line about what the sleeping sloth might dream.`;
}

export async function runConsultant(prompt, config, setText, readAloud = false, maxWords = 30) {
  const result = await consultantLine(prompt, config, setText, maxWords);
  if (readAloud && !result.offline && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(result.text);
    utterance.rate = 0.82;
    utterance.volume = 0.6;
    window.speechSynthesis.speak(utterance);
  }
  return result;
}
