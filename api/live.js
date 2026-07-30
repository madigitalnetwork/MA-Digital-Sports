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
  // ?matchId= in the URL overrides the MATCH_ID env var, so the operator can
  // switch to whichever match is live right now just by editing the page URL
  // (or the OBS Browser Source URL) — no env var edit or redeploy needed.
  const PICK = (req.query && req.query.matchId) || process.env.MATCH_ID || "";

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

        // Show each side's actual captain in the captain box instead of the
        // team crest, when the squad has one. picked.team1Id/team2Id don't
        // inherently know which of teamA/teamB (batting/bowling) they are —
        // work that out from which side's short code appears in picked.t1.
        if (state.captainPhotos) {
          const team1IsA = picked.t1 && state.teamA && picked.t1.indexOf(`[${state.teamA.short}]`) !== -1;
          const aPhoto = team1IsA ? state.captainPhotos.team1 : state.captainPhotos.team2;
          const bPhoto = team1IsA ? state.captainPhotos.team2 : state.captainPhotos.team1;
          if (aPhoto) state.teamA.photo = aPhoto;
          if (bPhoto) state.teamB.photo = bPhoto;
          delete state.captainPhotos;
        }
      } catch (_) { /* players are optional */ }
    }

    res.status(200).json({ ok:true, source:"rapidapi/free-cricbuzz", at:Date.now(), state });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok:false, reason:err.message });
  }
};
