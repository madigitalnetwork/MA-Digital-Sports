/* =========================================================
   CROWD AMBIENCE  (Web Audio — no audio file needed)
   ---------------------------------------------------------
   A continuous stadium "wash" built from filtered noise with a
   slow swell, plus a brighter cheer that rises on a boundary or
   a wicket. Everything is synthesised, so it works offline and
   adds nothing to page weight.

   window.Crowd.start()  – begin the ambience (must be called from
                           a user gesture, e.g. the GO LIVE click,
                           or the browser will block the audio)
   window.Crowd.stop()   – fade out and stop
   window.Crowd.cheer(x) – swell + cheer, intensity x in 0..1
   window.Crowd.on       – whether it is currently playing
   ========================================================= */
window.Crowd = (function () {
  let ctx = null, master = null, murmurGain = null, noiseBuf = null;
  const live = [];           // long-lived nodes to stop on disable
  let running = false;

  function makeNoise(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;   // brown-ish noise = low rumble
      d[i] = last * 4.5;
    }
    return buf;
  }

  function start() {
    try {
      if (running) return;
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();

      master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);

      noiseBuf = makeNoise(5);

      // ---- base murmur: looping brown noise through a warm band ----
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;

      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 480; bp.Q.value = 0.5;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 2000;

      murmurGain = ctx.createGain();
      murmurGain.gain.value = 0.8;

      src.connect(bp); bp.connect(lp); lp.connect(murmurGain); murmurGain.connect(master);
      src.start();

      // ---- slow natural swell of the crowd ----
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.16;
      lfo.connect(lfoGain); lfoGain.connect(murmurGain.gain); lfo.start();

      live.push(src, lfo);

      // fade in
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(0.75, ctx.currentTime + 1.2);

      running = true;
      if (ctx.state === "suspended") ctx.resume();   // ensure it actually plays
    } catch (_) { /* audio not available — stay silent */ }
  }

  function stop() {
    if (!running || !ctx) return;
    const t = ctx.currentTime;
    try {
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    } catch (_) {}
    setTimeout(() => { live.forEach(n => { try { n.stop(); } catch (_) {} }); live.length = 0; }, 700);
    running = false;
  }

  function cheer(intensity) {
    if (!running || !ctx) return;
    const x = Math.max(0, Math.min(1, intensity || 0));
    if (x <= 0) return;
    const t = ctx.currentTime;

    // swell the whole crowd up, then settle back
    try {
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(Math.min(1.0, 0.5 + 0.5 * x), t + 0.18);
      master.gain.linearRampToValueAtTime(0.5, t + 2.6);
    } catch (_) {}

    // a brighter cheer layer on top
    try {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 700;
      const pk = ctx.createBiquadFilter();
      pk.type = "peaking"; pk.frequency.value = 1400; pk.gain.value = 6;
      const g = ctx.createGain(); g.gain.value = 0.0001;

      src.connect(hp); hp.connect(pk); pk.connect(g); g.connect(master);
      src.start(t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.55 * x, t + 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      src.stop(t + 2.5);
    } catch (_) {}
  }

  return {
    start, stop, cheer,
    get on() { return running; }
  };
})();
