/**
 * Vercel serverless function — GET /api/live
 *
 * Stateless on purpose. Serverless functions are short-lived and do not share
 * memory, so nothing is cached in a variable here. Instead the CDN caches the
 * response: with s-maxage=8, every visitor inside the same 8-second window is
 * served the same cached response and the upstream API is hit once.
 *
 * That is what keeps the API bill tied to how long you are on air, not to how
 * many people are watching.
 */
const { fetchLiveRows, fetchScoreboardState, normalise } = require("../lib/cricket");

module.exports = async function handler(req, res) {
  const KEY  = process.env.CRIC_API_KEY || process.env.RAPIDAPI_KEY;
  const PICK = process.env.MATCH_ID || "";

  res.setHeader("Cache-Control", "public, s-maxage=25, stale-while-revalidate=60");

  try {
    const rows  = await fetchLiveRows(KEY, PICK);
    const state = normalise(rows, PICK);

    // Enrich a genuinely-live match with its current batsmen + bowler. Best
    // effort: if the scoreboard feed is empty or shaped unexpectedly, the core
    // score still renders and only the player cards fall back to placeholders.
    const picked = rows.find(r => r.id === state.matchId);
    if (picked && picked.ms === "live") {
      try {
        Object.assign(state, await fetchScoreboardState(KEY, state.matchId));
      } catch (_) { /* players are optional */ }
    }

    res.status(200).json({ ok:true, source:"rapidapi/free-cricbuzz", at:Date.now(), state });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok:false, reason:err.message });
  }
};
