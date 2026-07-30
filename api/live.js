/**
 * Vercel serverless function — GET /api/live
 *
 * No caching here on purpose: the operator wants every ball to show up as
 * soon as the upstream feed has it, so each request goes straight to the
 * upstream API rather than serving a shared, slightly-stale CDN copy.
 */
const { fetchLiveRows, fetchScoreboardState, normalise } = require("../lib/cricket");

module.exports = async function handler(req, res) {
  const KEY  = process.env.CRIC_API_KEY || process.env.RAPIDAPI_KEY;
  const PICK = process.env.MATCH_ID || "";

  res.setHeader("Cache-Control", "no-store");

  try {
    const rows  = await fetchLiveRows(KEY, PICK);
    const state = normalise(rows, PICK);

    // Enrich a genuinely-live match with its current batsmen + bowler. Best
    // effort: if the scoreboard feed is empty or shaped unexpectedly, the core
    // score still renders and only the player cards fall back to placeholders.
    const picked = rows.find(r => r.id === state.matchId);
    if (picked && picked.ms === "live") {
      try {
        Object.assign(state, await fetchScoreboardState(KEY, state.matchId, picked.team1Id, picked.team2Id));
      } catch (_) { /* players are optional */ }
    }

    res.status(200).json({ ok:true, source:"rapidapi/free-cricbuzz", at:Date.now(), state });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok:false, reason:err.message });
  }
};
