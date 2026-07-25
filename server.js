/**
 * Local development server.
 * ------------------------------------------------------------
 *   npm install
 *   CRIC_API_KEY=your_key npm start
 *   http://localhost:3000
 *
 * This exists only so you can run the site on your machine. It serves the
 * static files and mirrors the two API routes that Vercel handles in
 * production, using the same lib/cricket.js code, so local and deployed
 * behaviour match.
 *
 * In-process caching here does the job that Vercel's CDN does in production:
 * one upstream call is shared by everyone inside the cache window.
 */

const express = require("express");
const { fetchMatches, normalise } = require("./lib/cricket");

const app  = express();
const PORT = process.env.PORT || 3000;
const KEY  = process.env.CRIC_API_KEY || "";
const PICK = process.env.MATCH_ID || "";

const CACHE_MS = 8000;
const cache = new Map();          // route -> { at, body }

async function cached(route, build){
  const hit = cache.get(route);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;

  const body = await build();
  cache.set(route, { at:Date.now(), body });
  return body;
}

app.use(express.static(__dirname));

app.get("/api/live", async (req, res) => {
  try {
    const body = await cached("live", async () => {
      const rows = await fetchMatches(KEY);
      return { ok:true, source:"cricketdata.org (local)", at:Date.now(), state:normalise(rows, PICK) };
    });
    res.json(body);
  } catch (err) {
    res.json({ ok:false, reason:err.message });
  }
});

app.get("/api/matches", async (req, res) => {
  try {
    const body = await cached("matches", async () => ({ ok:true, data:await fetchMatches(KEY) }));
    res.json(body);
  } catch (err) {
    res.json({ ok:false, reason:err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  MA Digital Sports — http://localhost:${PORT}`);
  if (!KEY) console.warn(`  !  CRIC_API_KEY is not set — the site will run in demo mode\n`);
  else      console.log(`  Upstream cache   — ${CACHE_MS / 1000}s\n`);
});
