/**
 * Vercel serverless function — GET /api/img?u=<encoded upstream image URL>
 *
 * A small image proxy: the browser never talks to Cricbuzz's CDN directly,
 * so a Referer/hotlink check on their end can't block team logos or player
 * photos from loading on this site. This fetches the image server-side (with
 * a Cricbuzz-looking Referer, just in case that matters) and re-serves the
 * bytes from our own domain.
 *
 * Only ever proxies a small allowlist of known Cricbuzz image hosts — never
 * an arbitrary caller-supplied host — so this can't be turned into an open
 * proxy for fetching arbitrary URLs.
 */
const ALLOWED_HOSTS = new Set(["static.cricbuzz.com"]);

module.exports = async function handler(req, res) {
  const raw = req.query && req.query.u;
  if (!raw) { res.status(400).send("missing u"); return; }

  let target;
  try { target = new URL(String(raw)); } catch (_) { res.status(400).send("bad url"); return; }

  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
    res.status(400).send("host not allowed");
    return;
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        "Referer": "https://www.cricbuzz.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
      }
    });

    if (!upstream.ok) {
      res.setHeader("Cache-Control", "no-store");
      res.status(upstream.status).send("upstream " + upstream.status);
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
    // Player/team photos are effectively immutable once published — cache hard.
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.status(200).send(buf);
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).send("proxy fetch failed");
  }
};
