const PENTATONIC = [220, 261.63, 329.63, 392, 440, 523.25];

export function createAudio() {
  let context = null;
  let master = null;
  let ambientSource = null;
  let timer = null;
  let musicIndex = 0;
  let muted = false;
  let volume = 0.28;
  let enabled = false;
  let lastStage = "sleeping";
  const active = new Set();

  function getContext() {
    if (!context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error("Web Audio is not supported by this browser.");
      context = new Context();
      master = context.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(context.destination);
    }
    if (context.state === "suspended") context.resume();
    return context;
  }

  function tone(frequency, duration, shape, loudness, delay = 0) {
    const audio = getContext();
    const start = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = shape;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, loudness), start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
    active.add(oscillator);
    oscillator.addEventListener("ended", () => active.delete(oscillator), { once: true });
  }

  function start() {
    if (enabled) return;
    enabled = true;
    const audio = getContext();
    const buffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = (Math.random() * 2 - 1) * 0.16;
    }
    ambientSource = audio.createBufferSource();
    ambientSource.buffer = buffer;
    ambientSource.loop = true;
    const filter = audio.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 320;
    const ambientGain = audio.createGain();
    ambientGain.gain.value = 0.012;
    ambientSource.connect(filter);
    filter.connect(ambientGain);
    ambientGain.connect(master);
    ambientSource.start();
    if (lastStage === "sleeping") tone(92, 1.3, "sine", 0.012);
    timer = window.setInterval(() => {
      tone(PENTATONIC[musicIndex % PENTATONIC.length], 2.8, "sine", 0.014);
      musicIndex += 1;
      if (lastStage !== "sleeping") tone(55, 3, "sine", 0.018);
      if (Math.random() > 0.57) tone(1400 + Math.random() * 500, 0.07, "sine", 0.006);
    }, 3400);
  }

  function setVolume(value) {
    volume = Math.max(0, Math.min(1, Number(value)));
    if (master && !muted) master.gain.setTargetAtTime(volume, context.currentTime, 0.06);
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (master) master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, 0.04);
  }

  function action(tile, pushed, captured, cost) {
    if (!enabled || muted) return;
    const loudness = 0.018 + Math.min(0.085, cost * 0.018);
    if (captured) {
      tone(660, 0.18, "sine", loudness * 1.4);
      tone(880, 0.25, "sine", loudness, 0.1);
    } else if (pushed) {
      tone(95, 0.14, "triangle", loudness * 1.4);
    } else if (tile === "D") {
      tone(130, 0.2, "square", loudness * 1.6);
      tone(75, 0.12, "triangle", loudness, 0.025);
    } else if (tile === "L") {
      tone(480, 0.1, "sine", 0.004);
    } else {
      tone(235, 0.09, "sine", loudness * 0.45);
    }
  }

  function stage(nextStage) {
    if (!enabled || nextStage === lastStage) return;
    lastStage = nextStage;
    if (nextStage === "stirring") {
      tone(180, 0.9, "sine", 0.06);
      tone(360, 0.6, "sine", 0.04, 0.25);
    } else if (nextStage === "awake") {
      tone(880, 0.8, "sawtooth", 0.12);
      tone(660, 0.8, "sawtooth", 0.1, 0.16);
    } else {
      tone(95, 1.3, "sine", 0.018);
    }
  }

  function win() {
    if (!enabled || muted) return;
    [261.63, 329.63, 392, 523.25].forEach((note, index) =>
      tone(note, 1.1, "sine", 0.038, index * 0.48),
    );
  }

  function stop() {
    if (timer) window.clearInterval(timer);
    if (ambientSource) {
      try {
        ambientSource.stop();
      } catch {
        // The source may already have been stopped.
      }
    }
    active.forEach((oscillator) => {
      try {
        oscillator.stop();
      } catch {
        // The oscillator may already have been stopped.
      }
    });
    active.clear();
    if (context) context.close();
    context = null;
    master = null;
    ambientSource = null;
    timer = null;
    enabled = false;
  }

  return { action, setMuted, setVolume, stage, start, stop, win };
}
