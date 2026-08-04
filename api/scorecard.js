/**
 * Vercel serverless function — GET /api/scorecard?matchId=...
 *
 * The full bowling-figures + fall-of-wickets card, separate from /api/live
 * on purpose: it is a heavier upstream call than the leanback miniscore, and
 * the operator only needs it while the scorecard panel is open, not on every
 * 4s poll — so the client fetches this on demand rather than in the main
 * polling loop.
 */
const { fetchFullScorecard } = require("../lib/cricket");

module.exports = async function handler(req, res) {
  const KEY     = process.env.CRIC_API_KEY || process.env.RAPIDAPI_KEY;
  const matchId = req.query && req.query.matchId;

  res.setHeader("Cache-Control", "no-store");

  if (!matchId) {
    res.status(200).json({ ok:false, reason:"missing matchId" });
    return;
  }

  try {
    const card = await fetchFullScorecard(KEY, matchId);
    res.status(200).json({ ok:true, card });
  } catch (err) {
    res.status(200).json({ ok:false, reason:err.message });
  }
};
