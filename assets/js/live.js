/* =========================================================
   LIVE SCOREBOARD ENGINE
   - Data arrives from the API every POLL_MS, no manual entry
   - Every new delivery plays an animation in the stadium
   - Every value change animates in and out
   ========================================================= */

const POLL_MS = 15000;         // auto refresh window (kept modest to spare the API quota)
const API_URL = "/api/live";   // server.js serves normalised state here

/* ---------------------------------------------------------
   Placeholder images used until real ones are set
   --------------------------------------------------------- */
const BLANK_PLAYER = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 132">
     <rect width="120" height="132" fill="#131A2B"/>
     <circle cx="60" cy="47" r="25" fill="#28324D"/>
     <path d="M10 132c0-29 23-48 50-48s50 19 50 48z" fill="#28324D"/></svg>`);

const BLANK_FLAG = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">
     <rect width="300" height="400" fill="#0F1830"/>
     <circle cx="150" cy="150" r="120" fill="#18234A" opacity=".7"/></svg>`);

let S = {
  teamA:{ name:"Team A", short:"TBC", flag:"", captain:"CAPTAIN", photo:"" },
  teamB:{ name:"Team B", short:"TBC", flag:"", captain:"CAPTAIN", photo:"" },
  runs:0, wickets:0, overs:0, ballInOver:0,
  totalOvers:20, target:0,
  pshipRuns:0, pshipBalls:0,
  toss:"", statusText:"Waiting for match data",
  lastMan:"",
  thisOver:[],
  striker:0,
  batters:[
    { name:"Batter 1", runs:0, balls:0, fours:0, sixes:0, photo:"" },
    { name:"Batter 2", runs:0, balls:0, fours:0, sixes:0, photo:"" }
  ],
  bowler:{ name:"Bowler", runs:0, wickets:0, overs:0, balls:0, photo:"" },
  eventName:"",
  upcoming:[]
};

let lastBallCount  = 0;
let liveConnected  = false;
const overrides    = new Set();   // fields the operator edited by hand

/* =========================================================
   1.  ANIMATED VALUE HELPER
   ========================================================= */
function anim(id, value){
  const box = document.getElementById(id);
  if (!box) return false;
  const v = box.querySelector(".v");
  if (!v || v.textContent === String(value)) return false;

  const old = document.createElement("span");
  old.className   = "old go";
  old.textContent = v.textContent;
  box.appendChild(old);

  v.textContent = value;
  v.classList.remove("go");
  void v.offsetWidth;                 // force reflow so it replays
  v.classList.add("go");

  setTimeout(() => old.remove(), 340);
  return true;
}

function flash(id){
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
}

/* =========================================================
   2.  STADIUM SCENE
   An empty stadium photograph with the players composited on top
   as separate transparent layers, so each one can be moved, scaled
   and swapped between poses independently.
   ========================================================= */

/* ---------------------------------------------------------
   SCENE — every number is a percentage of the stadium panel,
   so it holds at any size. These are the values to nudge if a
   player sits too high, too low, or looks the wrong size.
     x, y  = position (y is the FEET, not the centre)
     h     = height as a percentage of the panel
   --------------------------------------------------------- */
/* ---------------------------------------------------------
   VIDEO
   Drop clips into assets/video/ and name them here. As soon as
   any clip is set, the stadium panel switches to video and the
   photo + cut-out players are skipped entirely.

   idle      loops quietly between deliveries
   delivery  plays once on every ball, unless an outcome clip exists
   outcomes  a clip per result — the ones you leave empty fall back
             to `delivery`, and if that is empty too, to `idle`
   --------------------------------------------------------- */
const VIDEO = {
  idle:     "",   // e.g. "assets/video/idle.mp4"
  delivery: "",   // e.g. "assets/video/delivery.mp4"
  outcomes: {
    "4":  "",     // e.g. "assets/video/four.mp4"
    "6":  "",
    "W":  "",
    "0":  "",
    "WD": "",
    "NB": ""
  }
};

const videoMode = () =>
  !!(VIDEO.idle || VIDEO.delivery || Object.values(VIDEO.outcomes).some(Boolean));

const clipFor = code =>
  VIDEO.outcomes[code] || VIDEO.delivery || VIDEO.idle || "";

const SCENE = {
  photo: "assets/img/ground-night.png",

  /* This ground photo already has the bowler, batsman, keeper, umpire and
     fielders in it. So we do NOT composite cut-out players on top (that would
     double them up) — only the ball flies and the outcome effects play. */
  playersInPhoto: true,

  /* floodlight heads in the photo — the glow sits on these */
  towers: [{ x:9, y:6 }, { x:91, y:6 }],

  /* far end — the pair stand at the far crease, feet on the pitch just
     below the boundary boards. flip:true mirrors the cut-out so they face
     back down the pitch. */
  batsman: { x:50.0, y:66.0, h:12.0, flip:true },
  keeper:  { x:52.0, y:62.0, h:8.5,  flip:true },

  /* near end — the bowler runs away from camera, so he shrinks
     as he moves up the frame */
  bowlerRun:    { x:47.0, y:89.0, h:20.0 },
  bowlerGather: { x:48.0, y:84.0, h:18.0 },
  bowlerAction: { x:49.0, y:80.0, h:16.0 },
  bowlerFollow: { x:49.5, y:77.0, h:15.0 },

  /* ball waypoints — tuned to THIS photo: the bowler runs in at the near
     end and the striker stands at the far crease. */
  release: { x:55.0, y:76.0 },     // leaves the near-end bowler's hand
  contact: { x:49.0, y:61.0 },     // meets the bat at the far crease
  ropeY:   51.0                    // the boundary boards
};

/* which bat pose each outcome plays */
const BAT_POSE = {
  "6":"bat-pull", "4":"bat-drive", "3":"bat-drive", "2":"bat-punch",
  "1":"bat-punch", "0":"bat-stance", "W":"bat-punch", "WD":"bat-stance", "NB":"bat-stance"
};

const BOWL_POSES = ["bowl-runup", "bowl-gather", "bowl-action", "bowl-follow"];
const BAT_POSES  = ["bat-stance", "bat-drive", "bat-punch", "bat-pull"];
const IMG = n => `assets/img/${n}.png`;

function buildStadium(){
  if (videoMode()) return buildVideoStage();
  const crowdTop = SCENE.playersInPhoto ? 22 : 22;   // where the crowd band sits in the photo
  let sparkles = "";
  for (let i = 0; i < 80; i++){
    const x = 2 + Math.random() * 96;
    const y = crowdTop + Math.random() * 24;
    sparkles += `<span class="sparkle" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;` +
                `animation-delay:${(Math.random() * 1.6).toFixed(2)}s"></span>`;
  }

  const glows = SCENE.towers
    .map(t => `<span class="glow" style="left:${t.x}%;top:${t.y}%"></span>`).join("");

  /* scrolling LED boundary board (left -> right), if configured */
  let led = "";
  if (SCENE.branding){
    const unit = `<span><b class="ma">MA</b>&nbsp;${SCENE.branding.text}&nbsp;&nbsp;&bull;&nbsp;&nbsp;</span>`;
    const half = unit.repeat(12);
    led = `<div class="ledboard"><div class="ledtrack">${half}${half}</div></div>`;
  }

  /* every pose is preloaded and stacked; only one of each is visible */
  const poses = (list, cls) => list
    .map((n, k) => `<img class="ply ${cls}${k === 0 ? " on" : ""}" data-pose="${n}" src="${IMG(n)}" alt="">`)
    .join("");

  /* Cut-out players are only composited when the photo is an EMPTY ground.
     For a photo that already contains the players we skip them entirely. */
  const figures = SCENE.playersInPhoto ? "" : `
    <span class="figure" id="keeperFig">
      <img class="ply on" src="${IMG("keeper")}" alt="">
    </span>
    <span class="figure" id="batFig">${poses(BAT_POSES, "bat")}</span>
    <span class="figure" id="bowlFig">${poses(BOWL_POSES, "bowl")}</span>`;

  return `
    <img class="shot on${SCENE.playersInPhoto ? " still" : ""}" src="${SCENE.photo}" alt="">
    ${glows}
    <span class="haze"></span>
    ${sparkles}
    ${led}
    ${figures}

    <svg class="trail" id="trail" viewBox="0 0 100 100" preserveAspectRatio="none">
      <path vector-effect="non-scaling-stroke"></path>
    </svg>
    <span class="ball" id="ball"></span>
    <span class="flashlayer" id="flashLayer"></span>`;
}

/* =========================================================
   VIDEO STAGE
   Two stacked players: one looping quietly underneath, one that
   plays a clip on top for each delivery and fades away after.
   Both are muted and playsinline so browsers allow autoplay.
   ========================================================= */
function buildVideoStage(){
  const idle = VIDEO.idle || VIDEO.delivery || "";
  return `
    <video class="vid idle on" id="vidIdle" ${idle ? `src="${idle}"` : ""}
           autoplay loop muted playsinline preload="auto"></video>
    <video class="vid shot" id="vidShot" muted playsinline preload="auto"></video>
    <svg class="trail" id="trail" viewBox="0 0 100 100" preserveAspectRatio="none">
      <path vector-effect="non-scaling-stroke"></path>
    </svg>
    <span class="ball" id="ball"></span>
    <span class="flashlayer" id="flashLayer"></span>`;
}

/* warm the outcome clips so the first four does not stutter */
function preloadClips(){
  if (!videoMode()) return;
  const seen = new Set();
  [VIDEO.delivery, ...Object.values(VIDEO.outcomes)].filter(Boolean).forEach(src => {
    if (seen.has(src)) return;
    seen.add(src);
    const v = document.createElement("video");
    v.preload = "auto"; v.muted = true; v.src = src;
  });
}

/* play the clip for this outcome, then settle back to the idle loop */
function playClip(code){
  const shot = document.getElementById("vidShot");
  const src  = clipFor(code);
  if (!shot || !src) return;

  if (shot.getAttribute("src") !== src){
    shot.setAttribute("src", src);
    shot.load();
  }
  shot.currentTime = 0;
  shot.classList.add("on");

  const done = () => {
    shot.classList.remove("on");
    shot.removeEventListener("ended", done);
  };
  shot.addEventListener("ended", done);

  const p = shot.play();
  if (p && p.catch) p.catch(() => done());   // autoplay blocked — stay on idle
}

/* place a figure: x/y are percentages, y is where the feet land */
function placeFigure(el, spot){
  if (!el) return;
  el.style.left   = spot.x + "%";
  el.style.top    = spot.y + "%";
  el.style.height = spot.h + "%";
  if (spot.flip !== undefined) el.classList.toggle("flip", !!spot.flip);
}

/* show one pose inside a figure, hide the rest */
function setPose(figId, poseName){
  const fig = document.getElementById(figId);
  if (!fig) return;
  fig.querySelectorAll(".ply").forEach(img =>
    img.classList.toggle("on", img.dataset.pose === poseName));
}

/* Lock the LED boundary board onto the boards baked into the photo. The photo
   is object-fit:cover, so its displayed rectangle — and therefore the boards —
   move as the panel is resized; recompute the band's top/height from the
   photo's own geometry every time. */
function positionLED(){
  const b = SCENE.branding; if (!b || b.imgTop == null) return;
  const el = document.querySelector(".ledboard"); if (!el) return;
  const st = document.getElementById("stadium"); if (!st) return;
  const img = st.querySelector(".shot");
  const iw = (img && img.naturalWidth)  || 1672;
  const ih = (img && img.naturalHeight) || 941;
  const pw = st.clientWidth, ph = st.clientHeight;
  if (!pw || !ph) return;
  const scale = Math.max(pw / iw, ph / ih);   // object-fit: cover
  const dispH = ih * scale;
  const offY  = (ph - dispH) / 2;
  el.style.top    = ((offY + b.imgTop * dispH) / ph * 100).toFixed(2) + "%";
  el.style.height = ((b.imgH * dispH) / ph * 100).toFixed(2) + "%";
}

function seatPlayers(){
  if (videoMode()) { preloadClips(); return; }
  if (SCENE.playersInPhoto) return;   // players are part of the photo — nothing to seat
  placeFigure(document.getElementById("batFig"),    SCENE.batsman);
  placeFigure(document.getElementById("keeperFig"), SCENE.keeper);
  placeFigure(document.getElementById("bowlFig"),   SCENE.bowlerRun);
  setPose("batFig",  "bat-stance");
  setPose("bowlFig", "bowl-runup");
}

/* =========================================================
   3.  DELIVERY ANIMATION
   Bowler runs in and delivers, ball travels, batsman plays the
   shot that matches the outcome, then everyone resets.
   ========================================================= */
const REDUCED = window.matchMedia("(prefers-reduced-motion:reduce)").matches;

/* percentage point -> pixels inside the stadium panel */
const px = (p, r) => ({ x: p.x / 100 * r.width, y: p.y / 100 * r.height });

/* delivery timeline, in ms */
const T = {
  gather: 260,     // bowler loads up
  action: 430,     // arm comes over, ball released
  follow: 560,     // follow through
  arrive: 900,     // ball reaches the bat
  reset: 2000      // back to the top of the mark
};

let deliveryBusy = false;

function playDelivery(code){
  // crowd reacts to boundaries and wickets
  if (window.Crowd){
    const x = code === "6" ? 1 : code === "4" ? 0.8 : code === "W" ? 0.9 : 0;
    if (x) Crowd.cheer(x);
  }

  if (REDUCED){ showBurst(code); return; }

  /* video mode: play the clip, keep the burst, camera and crowd reactions */
  if (videoMode()){
    const stad = document.querySelector(".stadium");
    const flash = document.getElementById("flashLayer");
    playClip(code);
    if (code === "4" || code === "6"){
      flash.classList.remove("go"); void flash.offsetWidth; flash.classList.add("go");
    }
    if (code === "6" || code === "W"){
      stad.classList.remove("shake"); void stad.offsetWidth; stad.classList.add("shake");
      setTimeout(() => stad.classList.remove("shake"), 600);
    }
    showBurst(code);
    return;
  }

  const stad  = document.querySelector(".stadium");
  const ball  = document.getElementById("ball");
  const trail = document.getElementById("trail");
  const flash = document.getElementById("flashLayer");
  const bowl  = document.getElementById("bowlFig");
  if (!stad || !ball) return;

  const rect = stad.getBoundingClientRect();
  deliveryBusy = true;

  /* ---------- bowler runs in (only when we composite a cut-out bowler) ---------- */
  if (bowl && !SCENE.playersInPhoto){
    const marks = [SCENE.bowlerRun, SCENE.bowlerGather, SCENE.bowlerAction, SCENE.bowlerFollow];
    placeFigure(bowl, marks[0]);
    setPose("bowlFig", "bowl-runup");

    bowl.animate(
      marks.map(m => ({ left:m.x + "%", top:m.y + "%", height:m.h + "%" })),
      { duration:T.follow, easing:"cubic-bezier(.35,0,.62,1)", fill:"forwards" });

    setTimeout(() => setPose("bowlFig", "bowl-gather"), T.gather);
    setTimeout(() => setPose("bowlFig", "bowl-action"), T.action);
    setTimeout(() => setPose("bowlFig", "bowl-follow"), T.follow);
  }

  /* ---------- ball down the pitch ---------- */
  const R = px(SCENE.release, rect);
  const C = px(SCENE.contact, rect);

  ball.style.left = SCENE.release.x + "%";
  ball.style.top  = SCENE.release.y + "%";
  ball.getAnimations().forEach(a => a.cancel());

  setTimeout(() => {
    ball.style.opacity = 1;
    const run = ball.animate(
      [{ transform:"translate(-50%,-50%) scale(1.05)" },
       { transform:`translate(calc(-50% + ${C.x - R.x}px), calc(-50% + ${C.y - R.y}px)) scale(.55)` }],
      { duration:T.arrive - T.action, easing:"cubic-bezier(.3,.05,.7,1)", fill:"forwards" });

    run.onfinish = () => onContact(code, stad, ball, trail, flash, rect, R, C);
  }, T.action);

  /* ---------- back to the top of the mark ---------- */
  setTimeout(() => {
    setPose("bowlFig", "bowl-runup");
    placeFigure(bowl, SCENE.bowlerRun);
    setPose("batFig", "bat-stance");
    deliveryBusy = false;
  }, T.reset);
}

function onContact(code, stad, ball, trail, flash, rect, R, C){
  /* batsman plays the shot */
  setPose("batFig", BAT_POSE[code] || "bat-stance");

  const shot   = shotFor(code);
  const target = px(shot.target, rect);
  const frames = shot.frames(C, R, target);

  const flight = ball.animate(frames, { duration:shot.dur, easing:shot.ease, fill:"forwards" });

  if (shot.trail){
    const path = trail.querySelector("path");
    const c = SCENE.contact, t = shot.target;
    path.setAttribute("d", `M${c.x} ${c.y} Q${(c.x + t.x) / 2} ${shot.ctrlY} ${t.x} ${t.y}`);
    const len = path.getTotalLength();
    trail.style.opacity = 1;
    path.style.strokeDasharray = len;
    path.animate(
      [{ strokeDashoffset:len }, { strokeDashoffset:0, offset:.6 }, { strokeDashoffset:0, opacity:0 }],
      { duration:shot.dur + 240, easing:"ease-out", fill:"forwards" });
  }

  if (code === "4" || code === "6"){
    flash.classList.remove("go"); void flash.offsetWidth; flash.classList.add("go");
    sparkleBurst();
  }
  if (code === "6" || code === "W"){
    stad.classList.remove("shake"); void stad.offsetWidth; stad.classList.add("shake");
    setTimeout(() => stad.classList.remove("shake"), 600);
  }

  flight.onfinish = () => {
    ball.style.opacity = 0;
    ball.getAnimations().forEach(a => a.cancel());
    trail.style.opacity = 0;
  };

  showBurst(code);
}

/* every outcome gets its own destination and flight shape */
function shotFor(code){
  const side = Math.random() < .5 ? -1 : 1;

  const t = (C, R, p, extra = "") =>
    `translate(calc(-50% + ${p.x - R.x}px), calc(-50% + ${p.y - R.y}px)) ${extra}`;

  switch (code){
    /* over the ropes and out of frame */
    case "6": return {
      target:{ x:50 + side * (24 + Math.random() * 18), y:-8 }, ctrlY:18, dur:1250, trail:true,
      ease:"cubic-bezier(.16,.62,.38,1)",
      frames:(C,R,T2) => [
        { transform:t(C,R,C,"scale(.55)") },
        { transform:t(C,R,{ x:(C.x + T2.x)/2, y:C.y * .45 },"scale(1.5)"), offset:.5 },
        { transform:t(C,R,T2,"scale(.4)"), opacity:.15 }
      ]
    };

    /* along the ground to the boards */
    case "4": return {
      target:{ x:50 + side * (30 + Math.random() * 16), y:SCENE.ropeY }, ctrlY:57, dur:820, trail:true,
      ease:"cubic-bezier(.12,.72,.32,1)",
      frames:(C,R,T2) => [
        { transform:t(C,R,C,"scale(.55)") },
        { transform:t(C,R,T2,"scale(.85)"), opacity:.25 }
      ]
    };

    /* through to the keeper */
    case "W": return {
      target:{ x:SCENE.keeper.x, y:SCENE.keeper.y - 2 }, ctrlY:57, dur:420, trail:false, ease:"ease-out",
      frames:(C,R,T2) => [
        { transform:t(C,R,C,"scale(.55)") },
        { transform:t(C,R,T2,"scale(.4)"), opacity:0 }
      ]
    };

    case "WD": case "NB": return {
      target:{ x:SCENE.keeper.x - 5, y:SCENE.keeper.y - 1 }, ctrlY:58, dur:520, trail:false, ease:"linear",
      frames:(C,R,T2) => [
        { transform:t(C,R,C,"scale(.55)") },
        { transform:t(C,R,T2,"scale(.4)"), opacity:0 }
      ]
    };

    /* blocked, drops at his feet */
    case "0": return {
      target:{ x:SCENE.contact.x + 1.4, y:SCENE.contact.y + 2.2 }, ctrlY:58, dur:420, trail:false, ease:"ease-out",
      frames:(C,R,T2) => [
        { transform:t(C,R,C,"scale(.55)") },
        { transform:t(C,R,T2,"scale(.5)"), opacity:0 }
      ]
    };

    /* pushed into the gap */
    default: return {
      target:{ x:50 + side * (12 + Math.random() * 14), y:SCENE.ropeY + 3 }, ctrlY:57, dur:760, trail:true,
      ease:"cubic-bezier(.2,.68,.4,1)",
      frames:(C,R,T2) => [
        { transform:t(C,R,C,"scale(.55)") },
        { transform:t(C,R,T2,"scale(.7)"), opacity:.3 }
      ]
    };
  }
}

function showBurst(code){
  const el = document.getElementById("burst");
  if (!el) return;
  const map = {
    "4":  ["FOUR!",    "four"],
    "6":  ["SIX!",     "six"],
    "W":  ["OUT!",     "out"],
    "WD": ["WIDE",     "wide"],
    "NB": ["NO BALL",  "wide"],
    "0":  ["DOT BALL", "dot"]
  };
  const [text, cls] = map[code] || [`${code} RUN${code === "1" ? "" : "S"}`, "dot"];
  el.className = "burst " + cls;
  el.textContent = text;
  void el.offsetWidth;
  el.classList.add("go");
  setTimeout(() => el.classList.remove("go"), 1000);
}

/* crowd reacts to a boundary */
function sparkleBurst(){
  document.querySelectorAll(".stadium .sparkle").forEach(s => {
    s.animate([{ opacity:.15, transform:"scale(1)" },
               { opacity:1,   transform:"scale(2.2)" },
               { opacity:.15, transform:"scale(1)" }],
      { duration:300, iterations:4, delay:Math.random() * 260 });
  });
}

/* =========================================================
   4.  RENDER
   ========================================================= */
function render(){
  const bat = S.batters, bw = S.bowler;
  const legal = S.overs * 6 + S.ballInOver;
  const crr = legal ? (S.runs / (legal / 6)) : 0;

  /* teams */
  document.getElementById("teamAName").textContent = S.teamA.short || S.teamA.name;
  document.getElementById("teamBName").textContent = S.teamB.short || S.teamB.name;
  document.getElementById("roleA").textContent = (S.teamA.captain || "Captain").toUpperCase();
  document.getElementById("roleB").textContent = (S.teamB.captain || "Captain").toUpperCase();
  setImg("flagA", S.teamA.flag,  BLANK_FLAG);
  setImg("flagB", S.teamB.flag,  BLANK_FLAG);
  setImg("capA",  S.teamA.photo, BLANK_PLAYER);
  setImg("capB",  S.teamB.photo, BLANK_PLAYER);

  /* score */
  if (anim("scoreRuns", `${S.runs}-${S.wickets}`)) flash("scoreRuns");
  anim("scoreOvers", `${S.overs}.${S.ballInOver}`);
  document.getElementById("scoreCRR").textContent = "CRR " + crr.toFixed(2);
  document.getElementById("scoreOf").textContent  = "OF " + S.totalOvers + " OV";
  document.getElementById("lastOut").textContent  = S.lastMan || "—";

  /* scrolling top bar */
  const parts = [
    `CRR <em>${crr.toFixed(2)}</em>`,
    S.target ? `RRR <em class="hot">${rrr().toFixed(2)}</em>` : `RRR <em>—</em>`,
    `P'SHIP <em>${S.pshipRuns}(${S.pshipBalls})</em>`,
    S.target ? `TO WIN <em class="hot">${Math.max(0, S.target - S.runs)} off ${Math.max(0, S.totalOvers*6 - legal)}</em>` : "",
    S.toss || "",
    S.statusText ? `<em class="hot">${S.statusText}</em>` : ""
  ].filter(Boolean);
  window.fillMarquee(document.getElementById("topMarquee"), parts, { dur:26 });

  /* over strip */
  renderBalls();

  /* event lines */
  window.fillMarquee(document.getElementById("evNow"),
    [S.eventName || "Live coverage — MA Digital Sports"], { dur:22 });
  window.fillMarquee(document.getElementById("evNext"),
    S.upcoming.length ? S.upcoming : ["Upcoming fixtures will appear here"], { dur:32 });

  /* batters */
  [0,1].forEach(i => {
    const b = bat[i] || {};
    const n = i + 1;
    anim(`bat${n}Name`, b.name || "—");
    if (anim(`bat${n}Fig`, `${b.runs || 0} (${b.balls || 0})`)) flash(`bat${n}Fig`);
    document.getElementById(`bat${n}Four`).textContent = b.fours || 0;
    document.getElementById(`bat${n}Six`).textContent  = b.sixes || 0;
    document.getElementById(`bat${n}SR`).textContent   =
      b.balls ? (b.runs / b.balls * 100).toFixed(2) : "0.00";
    setImg(`bat${n}Photo`, b.photo, BLANK_PLAYER);
    document.getElementById(`card${n}`).classList.toggle("striker", S.striker === i);
  });

  /* bat marker slides to whoever is on strike */
  const mark = document.getElementById("batMark");
  if (mark) mark.style.left = S.striker === 0 ? "calc(16.6% - 27px)" : "calc(50% - 27px)";

  /* bowler */
  anim("bowlName", bw.name || "—");
  if (anim("bowlFig", `${bw.wickets}-${bw.runs} (${bw.overs}.${bw.balls})`)) flash("bowlFig");
  const bo = bw.overs + bw.balls / 6;
  document.getElementById("bowlEcon").textContent = bo ? (bw.runs / bo).toFixed(2) : "0.00";
  setImg("bowlPhoto", bw.photo, BLANK_PLAYER);
}

function rrr(){
  const left = S.totalOvers * 6 - (S.overs * 6 + S.ballInOver);
  return left > 0 ? (S.target - S.runs) / (left / 6) : 0;
}

function setImg(id, src, fallback){
  const el = document.getElementById(id);
  if (!el) return;
  const want = src || fallback;
  if (el.getAttribute("src") !== want) el.setAttribute("src", want);
  el.onerror = () => { el.onerror = null; el.src = fallback; };
}

function renderBalls(){
  const box = document.getElementById("ballsBox");
  if (!box) return;

  const cls = c => {
    const v = String(c).toUpperCase();
    if (v === "W") return "w";
    if (v === "0") return "dot";
    if (v === "4") return "r4";
    if (v === "6") return "r6";
    if (v === "WD" || v === "NB") return "x";
    return "r1";
  };
  const runsOf = c => {
    const v = String(c).toUpperCase();
    if (v === "W") return 0;
    if (v === "WD" || v === "NB") return 1;
    return parseInt(v, 10) || 0;
  };

  const cells = [];
  for (let i = 0; i < 6; i++){
    const b = S.thisOver[i];
    const isNew = i === S.thisOver.length - 1 && S.thisOver.length > lastBallCount;
    cells.push(b === undefined
      ? `<span class="bl dot">&middot;</span>`
      : `<span class="bl ${cls(b)} ${isNew ? "pop" : ""}">${b}</span>`);
  }
  box.innerHTML = cells.join("");
  document.getElementById("overNo").textContent  = S.overs + 1;
  document.getElementById("overTot").textContent = S.thisOver.reduce((t,b) => t + runsOf(b), 0);
}

/* =========================================================
   5.  API POLLING
   ========================================================= */
let everLive = false;   // have we ever received real match data?

async function poll(){
  if (!livePolling) return;                 // paused -> make no API calls at all
  try{
    const res = await fetch(API_URL, { cache:"no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!data || !data.ok) throw new Error((data && data.reason) || "no data");

    applyState(data.state);
    everLive = true;
    setConn(true, data.source || "API");
  } catch(err){
    setConn(false, err.message);
    // Only simulate a match before any real data has ever arrived (offline
    // preview). Once we have shown a real score, a failed poll (e.g. the API
    // quota running out) must FREEZE on the last real score — never invent
    // fake runs during a live broadcast.
    if (!everLive) demoTick();
  }
}

/* =========================================================
   LIVE ON/OFF — the operator controls when the page polls the
   API, so a paused board spends no quota at all.
   ========================================================= */
let livePolling = false;
let pollTimer   = null;

function updateLiveBtn(){
  const b = document.getElementById("liveToggle");
  if (!b) return;
  b.classList.toggle("on",  livePolling);
  b.classList.toggle("off", !livePolling);
  b.textContent = livePolling ? "● LIVE — tap to pause" : "▶ GO LIVE";
}

function startLive(){
  livePolling = true;
  try { localStorage.setItem("maLive", "1"); } catch (_) {}
  updateLiveBtn();
  poll();                                        // fetch immediately
  if (!pollTimer) pollTimer = setInterval(poll, POLL_MS);
}

function stopLive(){
  livePolling = false;
  try { localStorage.setItem("maLive", "0"); } catch (_) {}
  if (pollTimer){ clearInterval(pollTimer); pollTimer = null; }
  updateLiveBtn();
  const led = document.getElementById("connLed");
  const txt = document.getElementById("connTxt");
  if (led) led.classList.remove("on");
  if (txt) txt.textContent = everLive
    ? "Paused — showing last score, no API calls"
    : "Paused — tap GO LIVE to start";
}

function toggleLive(){ livePolling ? stopLive() : startLive(); }

/* ---- crowd sound (ambient stadium noise, cheers on boundaries/wickets) ---- */
let soundOn = false;

function updateSoundBtn(){
  const b = document.getElementById("soundToggle");
  if (!b) return;
  b.classList.toggle("on",  soundOn);
  b.classList.toggle("off", !soundOn);
  b.textContent = soundOn ? "🔊 CROWD" : "🔇 CROWD";
}

function toggleSound(){
  soundOn = !soundOn;
  try { localStorage.setItem("maSound", soundOn ? "1" : "0"); } catch (_) {}
  updateSoundBtn();
  // this click is the user gesture the browser needs to allow audio
  if (window.Crowd){ soundOn ? Crowd.start() : Crowd.stop(); }
}

function initLive(){
  const p = new URLSearchParams(location.search);
  let saved = false;
  try { saved = localStorage.getItem("maLive") === "1"; } catch (_) {}
  const wantLive = p.has("live") || document.body.classList.contains("stream") || saved;

  const btn = document.getElementById("liveToggle");
  if (btn) btn.addEventListener("click", toggleLive);
  const sbtn = document.getElementById("soundToggle");
  if (sbtn) sbtn.addEventListener("click", toggleSound);

  // Always start muted — the browser only allows audio after a click, so the
  // operator taps CROWD to switch it on (that tap is the gesture).
  soundOn = false;
  updateSoundBtn();

  if (wantLive) startLive(); else stopLive();
}

/* =========================================================
   BALL DERIVATION — runs in the browser
   ---------------------------------------------------------
   The API only returns a running total, never a record of each
   delivery. So we compare consecutive polls: four more runs plus
   one more ball is a boundary, a wicket increment is W, runs with
   no extra ball is a wide.

   This lives in the browser rather than the server because the page
   is the only part of the system that reliably remembers the previous
   poll — serverless functions do not share memory between requests.
   ========================================================= */
let snap      = null;     // previous score snapshot
let overStrip = [];       // current-over strip, maintained locally

const legalCount = arr => arr.filter(c => c !== "WD" && c !== "NB").length;
const clampRun   = r => String(Math.max(0, Math.min(6, r)));

/* Compare the new poll with the last one and return a list of FRAMES — one per
   delivery since the previous poll — each carrying the running score and the
   over strip AS OF that ball. applyState then plays them back one at a time so
   the number, the over strip and the stadium animation all advance together
   instead of the score jumping ahead of the balls. */
function deriveFrames(next){
  const now = {
    matchId: next.matchId,
    runs:    next.runs,
    wickets: next.wickets,
    overs:   next.overs,
    ball:    next.ballInOver
  };

  /* first poll, or a different match — take a baseline, no animation */
  if (!snap || snap.matchId !== now.matchId){ snap = now; overStrip = []; return []; }

  const prevBalls = snap.overs * 6 + snap.ball;
  const nowBalls  = now.overs  * 6 + now.ball;

  /* score went backwards — new innings or a feed reset, no animation */
  if (nowBalls < prevBalls || now.runs < snap.runs){ snap = now; overStrip = []; return []; }

  const ballsAdded = nowBalls - prevBalls;
  const runsAdded  = now.runs - snap.runs;
  const wktsAdded  = now.wickets - snap.wickets;

  if (!ballsAdded && !runsAdded && !wktsAdded){ snap = now; return []; }

  /* per-ball steps: code + the runs / wickets / legal-ball it carries */
  const steps = [];
  if (ballsAdded === 0 && runsAdded > 0){
    steps.push({ code:"WD", dRuns:runsAdded, dWkt:0, legal:false });
  } else if (ballsAdded === 1){
    steps.push({ code: wktsAdded > 0 ? "W" : clampRun(runsAdded), dRuns:runsAdded, dWkt:wktsAdded, legal:true });
  } else {
    let left = runsAdded, wk = wktsAdded;
    for (let i = 0; i < ballsAdded; i++){
      if (wk > 0 && i === ballsAdded - 1){ steps.push({ code:"W", dRuns:left, dWkt:1, legal:true }); left = 0; wk--; continue; }
      const take = (i === ballsAdded - 1) ? left : Math.min(left, 1);
      steps.push({ code:clampRun(take), dRuns:take, dWkt:0, legal:true });
      left -= take;
    }
  }

  /* fold the steps into cumulative frames, carrying score + strip forward */
  const frames = [];
  let runs = snap.runs, wkts = snap.wickets, balls = prevBalls, strip = overStrip.slice();
  for (const s of steps){
    runs += s.dRuns; wkts += s.dWkt; if (s.legal) balls += 1;
    strip = strip.slice(); strip.push(s.code);
    if (legalCount(strip) >= 6) strip = [];
    frames.push({ code:s.code, runs, wickets:wkts, overs:Math.floor(balls / 6), ballInOver:balls % 6, thisOver:strip.slice() });
  }

  /* commit module state to the true API values */
  snap = now;
  overStrip = frames.length ? frames[frames.length - 1].thisOver.slice() : overStrip;
  if (legalCount(overStrip) !== now.ball){ overStrip = overStrip.slice(-Math.max(0, now.ball)); }

  return frames;
}

/* fields edited by hand are protected from later API updates */
function stripOverrides(obj){
  const out = JSON.parse(JSON.stringify(obj));
  overrides.forEach(pathStr => {
    const path = pathStr.split(".");
    let node = out;
    for (let i = 0; i < path.length - 1; i++){
      if (node == null) return;
      node = node[path[i]];
    }
    if (node) delete node[path[path.length - 1]];
  });
  return out;
}

let stepTimers = [];               // pending per-ball playback timers
const BALL_STEP_MS  = 1400;        // gap between consecutive balls
const SCORE_LAG_MS  = 850;         // score ticks up as the ball reaches the bat
const MAX_ANIM_BALLS = 8;          // beyond this, jump instead of animating

const SCORE_KEYS = ["runs", "wickets", "overs", "ballInOver"];

function applyState(raw){
  const frames = deriveFrames(raw);
  const next   = stripOverrides(raw);

  stepTimers.forEach(clearTimeout); stepTimers = [];   // drop any earlier sequence

  const stepping = frames.length > 0 && frames.length <= MAX_ANIM_BALLS;

  /* Apply everything now — but if we're going to step the score in time with
     the animation, hold the score fields at their previous values for a beat. */
  const meta = Object.assign({}, next);
  if (stepping) SCORE_KEYS.forEach(k => delete meta[k]);

  S = Object.assign({}, S, meta, {
    teamA:   Object.assign({}, S.teamA,  next.teamA  || {}),
    teamB:   Object.assign({}, S.teamB,  next.teamB  || {}),
    bowler:  Object.assign({}, S.bowler, next.bowler || {}),
    batters: next.batters || S.batters
  });

  if (!stepping){
    if (!overrides.has("thisOver")) S.thisOver = overStrip.slice();
    render();
    lastBallCount = S.thisOver.length;
    // too many balls to animate cleanly — flash the last few quickly
    if (frames.length){
      frames.slice(-MAX_ANIM_BALLS).forEach((f, i) =>
        stepTimers.push(setTimeout(() => playDelivery(String(f.code)), i * 320)));
    }
    return;
  }

  render();   // names / status / event now; score still on the previous ball

  frames.forEach((f, i) => {
    stepTimers.push(setTimeout(() => {
      playDelivery(String(f.code));                     // bowl the ball
      stepTimers.push(setTimeout(() => {                // ...score ticks as it lands
        S.runs = f.runs; S.wickets = f.wickets; S.overs = f.overs; S.ballInOver = f.ballInOver;
        if (!overrides.has("thisOver")) S.thisOver = f.thisOver.slice();
        render();
        lastBallCount = S.thisOver.length;
      }, SCORE_LAG_MS));
    }, i * BALL_STEP_MS));
  });
}

function setConn(ok, note){
  liveConnected = ok;
  const led = document.getElementById("connLed");
  const txt = document.getElementById("connTxt");
  if (led) led.classList.toggle("on", ok);
  if (txt) txt.textContent = ok
    ? `Live · ${note} · auto refresh every ${POLL_MS / 1000}s`
    : `Offline — running demo (${note})`;
}

/* =========================================================
   6.  DEMO MODE
   ========================================================= */
const DEMO_BALLS = ["1","0","4","1","6","0","W","2","1","4","0","1"];
let demoI = 0;

function demoSeed(){
  S.teamA = { name:"Pakistan", short:"PAK", flag:"", captain:"Captain", photo:"" };
  S.teamB = { name:"Namibia",  short:"NAM", flag:"", captain:"Captain", photo:"" };
  S.toss = "NAM opt to bowl";
  S.statusText = "Pakistan batting";
  S.totalOvers = 20;
  S.runs = 47; S.wickets = 1; S.overs = 6; S.ballInOver = 3;
  S.thisOver = ["1","1","1"];
  S.pshipRuns = 28; S.pshipBalls = 22;
  S.batters = [
    { name:"Abdullah Sha",    runs:9,  balls:12, fours:2, sixes:0, photo:"" },
    { name:"Shayan Jahangir", runs:28, balls:19, fours:3, sixes:2, photo:"" }
  ];
  S.bowler = { name:"Akeal Hosein", runs:8, wickets:0, overs:1, balls:3, photo:"" };
  S.lastMan = "Saim Ayub 4(8)";
  S.eventName = "ICC T20 World Cup — Group Stage";
  S.upcoming = [
    "PAK vs SL — Sunday 7:00 PM PKT",
    "Semi Final — Wednesday 7:30 PM PKT",
    "PSL 2026 opening night"
  ];
  render();
  lastBallCount = S.thisOver.length;
}

function demoTick(){
  addBallLocal(DEMO_BALLS[demoI++ % DEMO_BALLS.length]);
}

/* the same scoring rules the server uses */
function addBallLocal(code){
  const extra  = (code === "WD" || code === "NB");
  const offBat = (extra || code === "W") ? 0 : (parseInt(code, 10) || 0);
  const total  = extra ? 1 : offBat;
  const b = S.batters[S.striker];

  S.runs += total;
  S.pshipRuns += total;
  S.bowler.runs += total;

  if (!extra){
    S.bowler.balls++;
    b.balls++; b.runs += offBat; S.pshipBalls++;
    if (offBat === 4) b.fours++;
    if (offBat === 6) b.sixes++;
  }

  if (code === "W"){
    S.wickets++; S.bowler.wickets++;
    S.lastMan = `${b.name} ${b.runs}(${b.balls})`;
    S.batters[S.striker] = { name:"New Batter", runs:0, balls:0, fours:0, sixes:0, photo:"" };
    S.pshipRuns = 0; S.pshipBalls = 0;
  }

  S.thisOver.push(code);
  if (offBat % 2 === 1) S.striker = 1 - S.striker;

  if (!extra){
    S.ballInOver++;
    if (S.ballInOver >= 6){
      S.overs++; S.ballInOver = 0; S.thisOver = [];
      S.striker = 1 - S.striker;
      S.bowler.overs++; S.bowler.balls = 0;
    }
  }

  render();
  lastBallCount = S.thisOver.length;
  playDelivery(code);
}

/* =========================================================
   7.  ADJUST PANEL
   ========================================================= */
function initAdjust(){
  const panel = document.getElementById("adjust");
  const open  = document.getElementById("adjustBtn");
  const close = document.getElementById("adjustClose");
  if (!panel) return;

  open.addEventListener("click",  () => { fillAdjust(); panel.classList.add("open"); });
  close.addEventListener("click", () => panel.classList.remove("open"));

  panel.addEventListener("input", e => {
    const f = e.target.dataset.field;
    if (!f) return;
    overrides.add(f);
    const val  = e.target.type === "number" ? (+e.target.value || 0) : e.target.value;
    const path = f.split(".");
    let node = S;
    while (path.length > 1) node = node[path.shift()];
    node[path[0]] = val;
    render();
  });

  document.querySelectorAll("[data-ball]").forEach(btn =>
    btn.addEventListener("click", () => addBallLocal(btn.dataset.ball)));
}

function fillAdjust(){
  document.querySelectorAll("[data-field]").forEach(el => {
    let v = S;
    el.dataset.field.split(".").forEach(p => { v = v == null ? "" : v[p]; });
    el.value = v == null ? "" : v;
  });
}

/* =========================================================
   8.  STAGE SCALING
   The board is authored at a fixed 1920x1080 and scaled to fit
   whatever box it sits in, so the whole thing is always visible
   and the proportions never shift.
   ========================================================= */
function fitStage(){
  const stage = document.getElementById("stage");
  const wrap  = stage && stage.parentElement;
  if (!stage || !wrap) return;

  /* below 900px the CSS drops the fixed stage for a stacked layout */
  if (window.innerWidth <= 900 && !document.body.classList.contains("stream")){
    stage.style.transform = "";
    return;
  }
  const scale = Math.min(wrap.clientWidth / 1920, wrap.clientHeight / 1080);
  stage.style.transform = `scale(${scale})`;
  positionLED();
}

/* index.html?stream=1 hides the site chrome and fills the window —
   use that URL as the OBS Browser Source at 1920x1080 */
function initStreamMode(){
  const p = new URLSearchParams(location.search);
  if (p.has("stream")) document.body.classList.add("stream");
}

/* =========================================================
   9.  BOOT
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  const stadium = document.getElementById("stadium");
  if (!stadium) return;

  initStreamMode();
  stadium.insertAdjacentHTML("afterbegin", buildStadium());
  seatPlayers();

  /* keep the LED boundary board locked to the photo as it loads / resizes */
  const shot = stadium.querySelector(".shot");
  if (shot) shot.addEventListener("load", positionLED);
  positionLED();

  fitStage();
  window.addEventListener("resize", fitStage);

  demoSeed();
  initAdjust();

  initLive();   // starts paused (no API calls) unless remembered / stream / ?live
});
