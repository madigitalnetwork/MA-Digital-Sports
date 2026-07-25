/**
 * Shared cricket data helpers.
 * Used by the Vercel functions in /api and by server.js for local development,
 * so both environments normalise the upstream feed in exactly the same way.
 *
 * Everything here is stateless — no module-level mutable state. That matters,
 * because serverless functions are short-lived and cannot be relied on to
 * remember anything between requests.
 */

const UPSTREAM = "https://api.cricapi.com/v1/cricScore";

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

async function fetchMatches(key){
  if (!key) throw new Error("CRIC_API_KEY is not set");

  const res = await fetch(`${UPSTREAM}?apikey=${encodeURIComponent(key)}`);
  const json = await res.json();

  if (json.status !== "success" || !Array.isArray(json.data)){
    throw new Error(json.reason || "the API returned no data");
  }
  return json.data;
}

/* Turn the upstream rows into the shape the scoreboard expects.
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
      flag:`assets/img/${slug(battingT.short)}-flag.jpg`,
      captain:"Batting", photo:`assets/img/${slug(battingT.short)}-captain.png`
    },
    teamB:{
      name:bowlingT.name, short:bowlingT.short,
      flag:`assets/img/${slug(bowlingT.short)}-flag.jpg`,
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

module.exports = { fetchMatches, normalise, parseScore, parseTeam };
