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
const { fetchLiveRows, normalise } = require("../lib/cricket");

module.exports = async function handler(req, res) {
  const KEY  = process.env.CRIC_API_KEY || process.env.RAPIDAPI_KEY;
  const PICK = process.env.MATCH_ID || "";

  res.setHeader("Cache-Control", "public, s-maxage=8, stale-while-revalidate=25");

  try {
    const rows  = await fetchLiveRows(KEY, PICK);
    const state = normalise(rows, PICK);
    res.status(200).json({ ok:true, source:"rapidapi/free-cricbuzz", at:Date.now(), state });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok:false, reason:err.message });
  }
};
