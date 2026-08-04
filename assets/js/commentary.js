/* =========================================================
   VOICE COMMENTARY
   Spoken lines for each delivery, using the browser's own text-to-speech
   (SpeechSynthesis) — no audio files, nothing to host.

   Urdu is preferred, but very few browsers/devices actually ship an Urdu
   voice. When none is available this falls back to English lines instead
   of silently saying nothing, or mispronouncing Urdu script through the
   wrong voice.
   ========================================================= */
(function(){
  const LINES_UR = {
    "4":  (b)     => `چوکا! ${b} نے زبردست شاٹ کھیلا`,
    "6":  (b)     => `چھکا! ${b} نے گیند اسٹینڈز میں پہنچا دی`,
    "W":  (b, bw) => `آؤٹ! ${bw} کی گیند پر ${b} پویلین لوٹ گئے`,
    "0":  ()      => `کوئی رن نہیں`,
    "1":  ()      => `ایک رن`,
    "2":  ()      => `دو رنز`,
    "3":  ()      => `تین رنز`,
    "WD": ()      => `وائیڈ بال`,
    "NB": ()      => `نو بال`
  };
  const LINES_EN = {
    "4":  (b)     => `FOUR! ${b} finds the boundary`,
    "6":  (b)     => `SIX! ${b} sends it into the stands`,
    "W":  (b, bw) => `OUT! ${bw} strikes — ${b} has to go`,
    "0":  ()      => `Dot ball`,
    "1":  ()      => `Single`,
    "2":  ()      => `Two runs`,
    "3":  ()      => `Three runs`,
    "WD": ()      => `Wide ball`,
    "NB": ()      => `No ball`
  };

  let on = false;
  let urduVoice = null;
  let anyVoice  = null;

  function pickVoices(){
    if (!window.speechSynthesis) return;
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    urduVoice = voices.find(v => /^ur/i.test(v.lang)) || null;
    anyVoice  = voices.find(v => /^en/i.test(v.lang)) || voices[0] || null;
  }

  if (window.speechSynthesis){
    pickVoices();
    speechSynthesis.onvoiceschanged = pickVoices;
  }

  /* code: "4"/"6"/"W"/"0"/"1"/"2"/"3"/"WD"/"NB" — same codes the stadium
     animation already uses. batter/bowler are plain names, already known
     to the caller. */
  function say(code, batter, bowler){
    if (!on || !window.speechSynthesis) return;
    const useUrdu = !!urduVoice;
    const lines = useUrdu ? LINES_UR : LINES_EN;
    const build = lines[code] || lines["0"];
    const text  = build(batter || "", bowler || "");

    speechSynthesis.cancel();   // don't queue behind a still-speaking previous ball
    const u = new SpeechSynthesisUtterance(text);
    if (useUrdu){ u.voice = urduVoice; u.lang = urduVoice.lang; }
    else if (anyVoice){ u.voice = anyVoice; u.lang = anyVoice.lang; }
    u.rate  = 1.05;
    u.pitch = 1;
    speechSynthesis.speak(u);
  }

  function start(){ on = true; }
  function stop(){ on = false; if (window.speechSynthesis) speechSynthesis.cancel(); }

  window.Commentary = {
    start, stop, say,
    get on(){ return on; },
    get hasUrdu(){ return !!urduVoice; }
  };
})();
