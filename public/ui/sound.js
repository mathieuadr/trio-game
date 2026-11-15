// Sons synthétisés avec WebAudio : aucun fichier audio, donc rien à télécharger.

let ctx = null;
let enabled = true;

function audio() {
  if (!enabled) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone({ freq, to, type = 'sine', dur = 0.15, gain = 0.12, delay = 0 }) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise({ dur = 0.2, gain = 0.2, filter = 'lowpass', freq = 1200, to, delay = 0 }) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const f = ac.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(ac.destination);
  src.start(t);
}

export const sound = {
  get enabled() { return enabled; },
  setEnabled(on) { enabled = !!on; },
  /** À appeler sur un geste de l'utilisateur : iOS n'autorise le son qu'ensuite. */
  unlock() { audio(); },
  tap() { tone({ freq: 520, to: 660, dur: 0.06, gain: 0.05, type: 'triangle' }); },
  /** Une carte se retourne. */
  flip() { noise({ dur: 0.09, gain: 0.09, filter: 'bandpass', freq: 2400, to: 900 }); },
  /** La carte révélée est identique à la précédente. */
  match(count = 2) {
    const base = count >= 3 ? 659 : 523;
    tone({ freq: base, dur: 0.14, gain: 0.09, type: 'triangle', delay: 0.12 });
    tone({ freq: base * 1.26, dur: 0.2, gain: 0.09, type: 'triangle', delay: 0.22 });
  },
  /** Deux cartes différentes : le tour s'arrête. */
  miss() {
    tone({ freq: 330, to: 247, dur: 0.2, gain: 0.1, type: 'triangle', delay: 0.14 });
    tone({ freq: 233, to: 165, dur: 0.3, gain: 0.1, type: 'triangle', delay: 0.34 });
  },
  /** Les cartes retournent à leur place. */
  back() { for (let i = 0; i < 2; i++) noise({ dur: 0.06, gain: 0.06, filter: 'bandpass', freq: 1500 + i * 400, delay: i * 0.08 }); },
  shuffle() { for (let i = 0; i < 5; i++) noise({ dur: 0.05, gain: 0.07, filter: 'bandpass', freq: 1800 + i * 300, delay: i * 0.07 }); },
  trio() { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.24, gain: 0.09, type: 'triangle', delay: 0.15 + i * 0.09 })); },
  /** Le trio de 7 : plus solennel. */
  seven() {
    [392, 494, 587, 784, 988, 1175].forEach((f, i) => tone({ freq: f, dur: 0.6, gain: 0.08, type: 'sine', delay: 0.15 + i * 0.11 }));
    tone({ freq: 196, dur: 1.4, gain: 0.1, type: 'triangle', delay: 0.15 });
  },
  win() { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, dur: 0.5, gain: 0.08, type: 'sine', delay: i * 0.12 })); },
  lose() { [392, 330, 262].forEach((f, i) => tone({ freq: f, dur: 0.4, gain: 0.08, type: 'triangle', delay: i * 0.2 })); },
  /** C'est à moi de jouer. */
  turn() { tone({ freq: 660, dur: 0.1, gain: 0.08, type: 'sine' }); tone({ freq: 880, dur: 0.16, gain: 0.08, type: 'sine', delay: 0.1 }); },
  error() { tone({ freq: 160, dur: 0.12, gain: 0.08, type: 'square' }); },
};
