/**
 * Vercel serverless function — GET /api/matches
 * Full match list for the homepage and schedule page.
 * Cached longer than /api/live because fixtures barely move.
 */
const { fetchMatches } = require("../lib/cricket");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");

  try {
    const data = await fetchMatches(process.env.CRIC_API_KEY);
    res.status(200).json({ ok:true, data });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok:false, reason:err.message });
  }
};
