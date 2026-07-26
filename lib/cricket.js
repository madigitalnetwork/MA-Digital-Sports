/**
 * Shared cricket data helpers.
 * Used by the Vercel functions in /api and by server.js for local development,
 * so both environments normalise the upstream feed in exactly the same way.
 *
 * Upstream is the "Free Cricbuzz Cricket API" on RapidAPI. Auth is a RapidAPI
 * key sent in the `x-rapidapi-key` header. The key is read from the
 * CRIC_API_KEY environment variable (RAPIDAPI_KEY is also accepted) — it is
 * NEVER hard-coded here, so it can live only in the Vercel dashboard.
 *
 * Everything here is stateless — no module-level mutable state. That matters,
 * because serverless functions are short-lived and cannot be relied on to
 * remember anything between requests.
 *
 * The upstream splits its data across several endpoints, and the exact shape of
 * the score-bearing feeds (live/recent) can vary, so the parsing below is
 * deliberately defensive: it walks the response, pulls out anything that looks
 * like a match, and reads scores from whichever of the common field names is
 * present. Missing data degrades to an empty score rather than throwing.
 */

const HOST = "cricbuzz-cricket.p.rapidapi.com";
const BASE = `https://${HOST}`;

/* ------------------------------------------------------------------ *
 *  Low-level fetch
 * ------------------------------------------------------------------ */

async function apiGet(path, key){
  if (!key) throw new Error("CRIC_API_KEY is not set");

  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "x-rapidapi-key":  key,
      "x-rapidapi-host": HOST,
      "Content-Type":    "application/json"
    }
  });

  let json = null;
  try { json = await res.json(); } catch (_) { json = null; }

  if (!res.ok){
    const msg = (json && (json.message || json.reason)) || `upstream HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (json && json.status && json.status !== "success"){
    throw new Error(json.message || json.reason || "the API returned an error");
  }
  if (!json) return null;
  // Some upstreams wrap the payload in { status, response }, others (the raw
  // Cricbuzz feed) return it at the top level. Support both.
  return json.response !== undefined ? json.response : json;
}

/* ------------------------------------------------------------------ *
 *  Response walking — find match nodes wherever they live
 * ------------------------------------------------------------------ */

/* Collect { info, score, seriesName } for every match found anywhere in the
   response. Handles the three shapes the upstream is known to use:
     - schedule:  ...matchScheduleList[].{ seriesName, matchInfo:[ {...} ] }
     - cricbuzz:  { matchInfo:{...}, matchScore:{...} }
     - flat:      { matchId, team1, team2, ... }                              */
function collectMatchNodes(node, out){
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)){
    node.forEach(n => collectMatchNodes(n, out));
    return;
  }

  if (node.matchInfo){
    const infos = Array.isArray(node.matchInfo) ? node.matchInfo : [node.matchInfo];
    infos.forEach(info => {
      if (info && typeof info === "object"){
        out.push({
          info,
          score:      info.matchScore || node.matchScore || null,
          seriesName: node.seriesName || info.seriesName || ""
        });
      }
    });
    // Keep walking siblings (a series wrapper may hold both matches and more
    // nested groups) but not back into the match we just consumed.
    for (const k in node){
      if (k !== "matchInfo" && k !== "matchScore") collectMatchNodes(node[k], out);
    }
    return;
  }

  if (node.team1 && node.team2 && node.matchId != null){
    out.push({ info: node, score: node.matchScore || null, seriesName: node.seriesName || "" });
    return;                       // don't descend into a match's own internals
  }

  for (const k in node) collectMatchNodes(node[k], out);
}

/* ------------------------------------------------------------------ *
 *  Field helpers
 * ------------------------------------------------------------------ */

function num(v){
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* GMT epoch-millis -> "YYYY-MM-DD HH:MM:SS" (what schedule.html/normalise
   expect: a space-separated UTC string with no timezone suffix). */
function gmtString(ms){
  const n = num(ms);
  if (n === null) return "";
  const d = new Date(n);
  if (isNaN(d.getTime())) return "";
  const p = x => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
         `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function teamString(t){
  if (!t || typeof t !== "object") return "TBC [TBC]";
  const name  = t.teamName || t.name || t.teamSName || "TBC";
  const short = t.teamSName || t.teamShortName || (name || "TBC").slice(0, 3).toUpperCase();
  return `${name} [${short}]`;
}

function slugName(s){
  return (s || "").toString().toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "i";
}

/* Team logo, straight off Cricbuzz's image CDN, built from the imageId the
   match feed already carries. Filename mirrors the confirmed pattern
   (…/c<imageId>/<team-name-slug>.jpg); Cricbuzz keys on the c<imageId> segment
   so the exact filename is not critical. Returns "" when there is no imageId —
   the browser then shows its blank-flag fallback. */
function logoUrl(t){
  if (!t || typeof t !== "object") return "";
  const id = num(t.imageId ?? t.imageid ?? t.faceImageId);
  if (id === null) return "";
  return `https://static.cricbuzz.com/a/img/v1/152x152/i1/c${id}/${slugName(t.teamName || t.name)}.jpg`;
}

/* One team's score object/string -> "runs/wkts (overs)". Tolerant of the
   several field names the upstream might use, and of Test-style innings. */
function formatTeamScore(ts){
  if (!ts) return "";
  if (typeof ts === "string") return ts.trim();
  if (typeof ts !== "object")  return "";

  // Prefer the most advanced innings that actually has runs.
  const inn = ts.inngs2 || ts.innings2 || ts.inngs1 || ts.innings1 || ts;

  const runs  = num(inn.runs  ?? inn.r ?? inn.run);
  const wkts  = num(inn.wickets ?? inn.wkts ?? inn.wkt ?? inn.w);
  const overs = inn.overs ?? inn.over ?? inn.o;

  if (runs === null) return "";
  let s = `${runs}/${wkts === null ? 0 : wkts}`;
  if (overs !== undefined && overs !== null && `${overs}` !== "") s += ` (${overs})`;
  return s;
}

function scorePair(node){
  const src  = node.score || node.info.matchScore || {};
  const info = node.info;
  const t1 = formatTeamScore(src.team1Score || src.team1score || info.team1Score || info.t1s);
  const t2 = formatTeamScore(src.team2Score || src.team2score || info.team2Score || info.t2s);
  return [t1, t2];
}

/* Map an upstream state/status string onto the site's three buckets. */
function classifyState(text){
  const s = (text || "").toString().toLowerCase();
  if (!s) return "live";
  if (/\b(complete|completed|won|abandon|drawn|draw|no result|result|tied)\b/.test(s)) return "result";
  if (/\b(preview|upcoming|scheduled|starts|yet to|not started|match starts)\b/.test(s)) return "fixture";
  return "live";   // in progress, innings break, rain, stumps, tea, lunch, toss...
}

/* { info, score, seriesName } -> the row shape normalise()/schedule.html use. */
function toRow(node, forcedMs){
  const info  = node.info;
  const [t1s, t2s] = scorePair(node);
  const stateText  = info.state || info.status || info.stateTitle || "";

  return {
    id:          String(info.matchId != null ? info.matchId : (info.id != null ? info.id : "")),
    t1:          teamString(info.team1),
    t2:          teamString(info.team2),
    t1s, t2s,
    t1Logo:      logoUrl(info.team1),
    t2Logo:      logoUrl(info.team2),
    ms:          forcedMs || classifyState(stateText),
    matchType:   (info.matchFormat || info.matchType || "t20").toString().toLowerCase(),
    series:      node.seriesName || info.seriesName || info.series || "",
    dateTimeGMT: gmtString(info.startDate || info.startdate || info.startTime),
    status:      (info.status || info.stateTitle || "").toString()
  };
}

function rowsFrom(response, forcedMs){
  const nodes = [];
  collectMatchNodes(response, nodes);
  return nodes.map(n => toRow(n, forcedMs)).filter(r => r.id);
}

/* ------------------------------------------------------------------ *
 *  Public fetchers
 * ------------------------------------------------------------------ */

async function fetchLive(key){
  return rowsFrom(await apiGet("/matches/v1/live", key), null);   // classify per state
}

async function fetchRecent(key){
  return rowsFrom(await apiGet("/matches/v1/recent", key), "result");
}

async function fetchSchedule(key){
  return rowsFrom(await apiGet("/matches/v1/upcoming", key), "fixture");
}

/* ------------------------------------------------------------------ *
 *  Live players (current batsmen + bowler) from the scoreboard feed
 * ------------------------------------------------------------------ *
 * Reads the Cricbuzz match-centre "leanback" miniscore (batsmanstriker /
 * batsmannonstriker / bowlerstriker, lastwkt, partnership, batteamscore), with
 * fallbacks for camelCase and array-style shapes. Anything missing is simply
 * omitted, so an unexpected shape degrades to "no players" rather than
 * breaking the scoreboard.
 */

function pName(o){ return (o && (o.batName || o.bowlName || o.name || o.fullName || o.playerName || o.nickName || o.nickname)) || ""; }
/* Only a FACE-image id yields a player photo. The player's own id (o.id) is not
   an image id, and a 0 imageid means "no photo". */
function pId(o){
  if (!o) return null;
  const id = num(o.faceImageId ?? o.faceimageid ?? o.imageId ?? o.imageid);
  return id ? id : null;
}

function playerLogoUrl(o){
  const id = pId(o);
  if (id === null) return "";
  return `https://static.cricbuzz.com/a/img/v1/152x152/i1/c${id}/${slugName(pName(o))}.jpg`;
}

function batterFrom(o){
  if (!o || typeof o !== "object") return null;
  const name = pName(o).replace(/\s*\*\s*$/, "").trim();   // drop the on-strike "*" marker
  if (!name) return null;
  return {
    name,
    runs:  num(o.batRuns  ?? o.runs  ?? o.r) || 0,
    balls: num(o.batBalls ?? o.balls ?? o.b) || 0,
    fours: num(o.batFours ?? o.fours ?? o["4s"]) || 0,
    sixes: num(o.batSixes ?? o.sixes ?? o["6s"]) || 0,
    photo: playerLogoUrl(o)
  };
}

function bowlerFrom(o){
  if (!o || typeof o !== "object") return null;
  const name = pName(o);
  if (!name) return null;
  const overs = num(o.bowlOvers ?? o.overs ?? o.o) || 0;
  return {
    name,
    wickets: num(o.bowlWkts ?? o.wickets ?? o.wkts ?? o.w) || 0,
    runs:    num(o.bowlRuns ?? o.runs ?? o.r) || 0,
    overs:   Math.floor(overs),
    balls:   Math.round((overs - Math.floor(overs)) * 10),
    photo:   playerLogoUrl(o)
  };
}

function deepFindObject(node, keys){
  if (!node || typeof node !== "object") return null;
  for (const k of keys){
    if (node[k] && typeof node[k] === "object" && !Array.isArray(node[k])) return node[k];
  }
  for (const k in node){
    const v = node[k];
    if (v && typeof v === "object"){
      const found = deepFindObject(v, keys);
      if (found) return found;
    }
  }
  return null;
}

function deepFindArray(node, keys){
  if (!node || typeof node !== "object") return null;
  for (const k of keys){ if (Array.isArray(node[k]) && node[k].length) return node[k]; }
  for (const k in node){
    const v = node[k];
    if (v && typeof v === "object"){
      const found = deepFindArray(v, keys);
      if (found) return found;
    }
  }
  return null;
}

/* "Justin Greaves  c Salman Agha b Mohammad Ali 15(31)  - 231/5 in 78.6 ov."
   -> "Justin Greaves 15(31)" */
function cleanLastWkt(s){
  const score = /(\d+)\s*\(\s*(\d+)\s*\)/.exec(s);
  const name  = /^(.*?)\s+(?:c\s|c&|\(c\)|b\s|lbw|run\s*out|st\s|hit\s*wicket|retired)/i.exec(s);
  const nm = (name ? name[1] : s.split(/\s{2,}|\s-\s/)[0] || "").trim();
  return (nm + (score ? ` ${score[1]}(${score[2]})` : "")).trim();
}

function parseScoreboard(resp){
  const out = {};
  if (!resp || typeof resp !== "object") return out;

  const mini = deepFindObject(resp, ["miniscore"]) || resp;

  const striker    = deepFindObject(mini, ["batsmanstriker", "batsmanStriker", "strikerBatsman", "batStriker"]);
  const nonStriker = deepFindObject(mini, ["batsmannonstriker", "batsmanNonStriker", "nonStrikerBatsman", "batNonStriker"]);

  let batters = [];
  if (striker || nonStriker){
    const a = batterFrom(striker), b = batterFrom(nonStriker);
    if (a) batters.push(a);
    if (b) batters.push(b);
    out.striker = 0;                         // striker listed first
  } else {
    const arr = deepFindArray(mini, ["batsman", "batsmen", "batters", "currentBatsmen"]);
    if (arr){
      batters = arr.map(batterFrom).filter(Boolean).slice(0, 2);
      const si = arr.findIndex(x => x && (x.strike === true || x.onStrike === true ||
                                          x.isStriker === true || /\*/.test(pName(x))));
      out.striker = si >= 0 ? si : 0;
    }
  }
  if (batters.length) out.batters = batters;

  let bw = bowlerFrom(deepFindObject(mini, ["bowlerstriker", "bowlerStriker", "currentBowler", "bowler"]));
  if (!bw){
    const barr = deepFindArray(mini, ["bowler", "bowlers", "currentBowlers"]);
    if (barr) bw = bowlerFrom(barr[0]);
  }
  if (bw) out.bowler = bw;

  // partnership: string "22(38)" or object { totalRuns, totalBalls }
  const ps = mini.partnership;
  if (typeof ps === "string"){
    const m = /(\d+)\s*\(\s*(\d+)\s*\)/.exec(ps);
    if (m){ out.pshipRuns = +m[1]; out.pshipBalls = +m[2]; }
  } else {
    const pso = deepFindObject(mini, ["partnership", "partnerShip", "currentPartnership"]);
    if (pso){ out.pshipRuns = num(pso.totalRuns ?? pso.runs) || 0; out.pshipBalls = num(pso.totalBalls ?? pso.balls) || 0; }
  }

  // last wicket: string "Name c … b … 15(31) - …" or an object
  const lw = mini.lastwkt || mini.lastWicket || deepFindObject(mini, ["lastWicket", "fallOfWicket", "prevWicket"]);
  if (typeof lw === "string" && lw.trim()) out.lastMan = cleanLastWkt(lw);
  else if (lw && pName(lw)) out.lastMan = pName(lw);

  // current score straight from the miniscore — fresher than the list feed and
  // in step with the batter figures above.
  const sc  = deepFindObject(mini, ["batteamscore"]);
  const inns = mini.inningsscores && mini.inningsscores.inningsscore;
  const inn  = Array.isArray(inns) && inns.length ? inns[inns.length - 1] : null;
  const runs = num(sc && (sc.teamscore ?? sc.runs));
  const wkts = num(sc && (sc.teamwkts ?? sc.wickets));
  const ov   = inn ? inn.overs : null;
  if (runs !== null){ out.runs = runs; if (wkts !== null) out.wickets = wkts; }
  if (ov !== null && ov !== undefined){
    const o = Math.floor(ov);
    out.overs = o;
    out.ballInOver = Math.round((ov - o) * 10);
  }

  return out;
}

async function fetchScoreboardState(key, matchId){
  if (!matchId) return {};
  // match-centre "leanback" carries the miniscore: current batsmen + bowler.
  const resp = await apiGet(`/mcenter/v1/${encodeURIComponent(matchId)}/leanback`, key);
  return parseScoreboard(resp);
}

/* De-duplicate rows by match id, keeping the first (live > result > fixture,
   in the order the callers concatenate them). */
function dedupe(rows){
  const seen = new Set();
  const out  = [];
  for (const r of rows){
    if (!seen.has(r.id)){ seen.add(r.id); out.push(r); }
  }
  return out;
}

/* Everything, for the schedule page and the local dev server. Runs the three
   feeds in parallel and tolerates any one of them being empty or failing —
   but if they ALL fail, the first error is surfaced so the caller can report
   e.g. a missing key. */
async function fetchMatches(key){
  const settled = await Promise.allSettled([
    fetchLive(key),
    fetchRecent(key),
    fetchSchedule(key)
  ]);

  const rows = [];
  let firstErr = null;
  for (const r of settled){
    if (r.status === "fulfilled") rows.push(...r.value);
    else if (!firstErr) firstErr = r.reason;
  }

  const out = dedupe(rows);
  if (!out.length){
    throw firstErr || new Error("the API returned no data");
  }
  return out;
}

/* The scoreboard's hot path. Kept deliberately light: it hits only the live
   feed, and reaches for the schedule (to show the next match) only when
   nothing is live — so a broadcast that is on air makes one upstream call per
   cache window, not three. */
async function fetchLiveRows(key, pickId){
  let rows = await fetchLive(key);
  const hasLive = rows.some(r => r.ms === "live");
  if (pickId || !hasLive){
    try { rows = rows.concat(await fetchSchedule(key)); } catch (_) { /* fixtures optional */ }
  }
  return dedupe(rows);
}

/* ------------------------------------------------------------------ *
 *  Normalise into the shape the scoreboard expects
 *  (unchanged contract — see assets/js/live.js applyState)
 * ------------------------------------------------------------------ */

/* "190/7 (20)" -> { runs:190, wickets:7, overs:20, ball:0 }
   "47/1 (6.3)" -> { runs:47,  wickets:1, overs:6,  ball:3 }  */
function parseScore(text){
  if (!text) return null;
  const m = /(\d+)\s*[/-]\s*(\d+)(?:\s*\(([\d.]+)\))?/.exec(text);
  if (!m) return null;
  const ov = parseFloat(m[3] || "0");
  return {
    runs:    +m[1],
    wickets: +m[2],
    overs:   Math.floor(ov),
    ball:    Math.round((ov - Math.floor(ov)) * 10)
  };
}

/* "Pakistan [PAK]" -> { name:"Pakistan", short:"PAK" } */
function parseTeam(raw){
  const m = /^(.*?)\s*\[(.+?)\]\s*$/.exec(raw || "");
  return m
    ? { name:m[1].trim(), short:m[2].trim() }
    : { name:(raw || "TBC").trim(), short:(raw || "TBC").slice(0, 3).toUpperCase() };
}

/* Turn the normalised rows into the shape the scoreboard expects.
   Ball-by-ball is NOT derived here — the browser does that, because it is the
   only part of the system that reliably remembers the previous poll. */
function normalise(rows, pickId){
  const live  = rows.filter(m => (m.ms || "").toLowerCase() === "live");
  const match = pickId
    ? rows.find(m => m.id === pickId)
    : (live[0] || rows.find(m => (m.ms || "").toLowerCase() === "fixture"));

  if (!match) throw new Error("no live match found");

  const t1 = parseTeam(match.t1), t2 = parseTeam(match.t2);
  const s1 = parseScore(match.t1s), s2 = parseScore(match.t2s);

  const secondInnings = !!(s2 && s1);
  const batting  = secondInnings ? s2 : (s1 || { runs:0, wickets:0, overs:0, ball:0 });
  const battingT = secondInnings ? t2 : t1;
  const bowlingT = secondInnings ? t1 : t2;
  const battingLogo = secondInnings ? (match.t2Logo || "") : (match.t1Logo || "");
  const bowlingLogo = secondInnings ? (match.t1Logo || "") : (match.t2Logo || "");
  const target   = secondInnings && s1 ? s1.runs + 1 : 0;

  const fmt = (match.matchType || "t20").toLowerCase();
  const totalOvers = fmt.includes("test") ? 450 : fmt.includes("odi") ? 50 : 20;

  const upcoming = rows
    .filter(m => (m.ms || "").toLowerCase() === "fixture")
    .slice(0, 6)
    .map(m => {
      const a = parseTeam(m.t1).short, b = parseTeam(m.t2).short;
      const when = m.dateTimeGMT
        ? new Date(m.dateTimeGMT.replace(" ", "T") + "Z").toLocaleString("en-GB", {
            weekday:"short", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"
          })
        : "";
      return `${a} vs ${b} — ${when}`;
    });

  const slug = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  return {
    matchId: match.id,
    teamA:{
      name:battingT.name, short:battingT.short,
      flag:battingLogo || `assets/img/${slug(battingT.short)}-flag.jpg`,
      captain:"Batting", photo:`assets/img/${slug(battingT.short)}-captain.png`
    },
    teamB:{
      name:bowlingT.name, short:bowlingT.short,
      flag:bowlingLogo || `assets/img/${slug(bowlingT.short)}-flag.jpg`,
      captain:"Bowling", photo:`assets/img/${slug(bowlingT.short)}-captain.png`
    },
    runs:       batting.runs,
    wickets:    batting.wickets,
    overs:      batting.overs,
    ballInOver: batting.ball,
    totalOvers, target,
    toss:       match.status && /opt to|elected/i.test(match.status) ? match.status : "",
    statusText: match.status || "",
    eventName:  match.series || "",
    upcoming
  };
}

module.exports = {
  fetchMatches, fetchLiveRows, fetchLive, fetchRecent, fetchSchedule,
  fetchScoreboardState, parseScoreboard,
  normalise, parseScore, parseTeam
};
