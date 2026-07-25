# MA Digital Sports

Live cricket score website with an animated broadcast scoreboard, plus news, blog,
schedule, about and FAQ pages.

---

## Seeing a plain white page with a form on it?

That means the CSS and JS did not load — almost always because `index.html` was
opened on its own, without the `assets/` folder next to it. The "form" you are
looking at is the adjust panel, which is hidden off-screen once the stylesheet
applies.

Two ways to fix it:

- **`standalone.html`** — one file with every stylesheet and script inlined. Open it
  directly, drag it into a browser, or use it as an OBS Browser Source. No server, no
  folder structure. It runs in demo mode so you can see all the animations.
- **The full project** — keep the whole folder together and run `npm start`. This is
  the one you deploy, and the only one that talks to the API.

---

## Run it locally

```bash
npm install
CRIC_API_KEY=your_key_here npm start
```

Open <http://localhost:3000>

It also runs with no key at all — the live page falls back to a demo loop so you
can see every animation working.

---

## Deploy to GitHub + Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "MA Digital Sports"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ma-digital-sports.git
git push -u origin main
```

`.gitignore` already keeps `node_modules`, `.env` and `.vercel` out of the repo.
Your API key is never in the code, so nothing secret gets pushed.

### 2. Import into Vercel

1. vercel.com → **Add New** → **Project** → import the repo
2. Framework preset: **Other**. Leave build command and output directory empty —
   this is a static site with serverless functions, there is nothing to build.
3. Before deploying, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `CRIC_API_KEY` | your key from cricketdata.org |
   | `MATCH_ID` | *(optional)* pin the board to one match id |

4. Deploy.

Or from the terminal:

```bash
npm i -g vercel
vercel          # preview deploy
vercel --prod   # production
```

### 3. After deploying

- Add the key to all three environments (Production, Preview, Development), or the
  preview builds will sit in demo mode.
- Changing an environment variable needs a **redeploy** to take effect.
- Check `https://your-site.vercel.app/api/live` directly — if it returns
  `{"ok":false,"reason":"CRIC_API_KEY is not set"}` the variable did not apply.

---

## Why the code is structured this way

Vercel is serverless. A function spins up, answers one request, and disappears —
it does not keep a `setInterval` running and it does not remember anything between
requests. Two consequences shaped this project:

**API polling moved to the CDN.** Instead of a loop on the server, `/api/live` sets
`Cache-Control: s-maxage=8`. Vercel's edge caches the response, so every visitor
inside the same 8-second window is served the same cached copy and the upstream API
is called once. Your API usage tracks how long you are on air, not how many people
are watching.

**Ball-by-ball derivation moved to the browser.** The API only returns a running
total ("47/1 (6.3)"), never a record of each delivery, so the ball has to be worked
out by comparing consecutive polls — four more runs plus one more ball is a
boundary. That needs memory of the previous poll, which a serverless function does
not have. The page does, so `deriveBalls()` in `assets/js/live.js` handles it.

Keep in mind this is inference, not a real feed. If two balls pass inside one poll
window, the runs have to be split by guesswork. For broadcast-grade accuracy, buy a
ball-by-ball feed and rewrite `lib/cricket.js`; nothing else changes.

---

## API cost — read this before going live

cricketdata.org's free tier is **100 hits per day**. With an 8-second cache that is
roughly 450 hits per hour of live coverage, so the free tier lasts about **13
minutes**. It is fine for building and testing, not for actual match coverage.

| Plan | Hits/day | Roughly this much live coverage |
|---|---|---|
| Free | 100 | ~13 minutes |
| $5.99/mo | 2,000 | ~4 hours |
| $12.99/mo | 10,000 | ~22 hours |
| $29.99/mo | 100,000 | effectively unlimited |

*(Prices as advertised — check cricketdata.org/pricing for current figures.)*

To stretch whichever plan you are on, raise both numbers together:

- `s-maxage` in `api/live.js`
- `POLL_MS` in `assets/js/live.js`

Going from 8s to 20s cuts usage by about 60%. A cricket ball is bowled roughly every
40 seconds, so 15–20 seconds still feels live.

---

## Project layout

```
api/live.js        Vercel function — current match state
api/matches.js     Vercel function — full fixture list
lib/cricket.js     Shared parsing and normalising (stateless)
server.js          Local dev server, mirrors the two API routes
assets/js/live.js  Scoreboard engine, animations, ball derivation
assets/js/site.js  Nav, footer, scroll reveal, marquees
assets/css/        base.css (site) and live.css (scoreboard grid)
vercel.json        Clean URLs and asset cache headers
```

| Page | What it is |
|---|---|
| `index.html` | The live scoreboard — this is the landing page |
| `standalone.html` | Same board, everything inlined into one file, demo mode |
| `schedule.html` | Fixtures, live matches and results |
| `news.html` | News listing |
| `blog.html` | Long-read listing |
| `about.html` | About and contact |
| `faq.html` | FAQ accordion |

---

## Streaming it on YouTube

The board is authored at a fixed **1920x1080** and scaled to fit whatever space it
is given, so the whole thing is always visible and the proportions never shift.

Add `?stream=1` to the URL for a clean capture — that hides the nav, footer and gear
button, drops the page background to transparent, and fills the window:

```
http://localhost:3000/index.html?stream=1          (local)
https://your-site.vercel.app/?stream=1             (deployed)
standalone.html?stream=1                           (single file, demo data)
```

In OBS, add a **Browser Source**:

- URL: one of the above
- Width **1920**, Height **1080**
- Turn **off** "Shutdown source when not visible"
- Turn **off** "Refresh browser when scene becomes active"

Below 900px wide the fixed frame is dropped for a normal stacked layout, so the site
still reads properly on a phone. Stream mode always keeps the fixed frame.

---

## Scoreboard layout

The live page is a CSS grid built to match the broadcast reference:

```
capA   |  top bar + stadium  |  capB
banA   |  logo strip         |  banB
score  |  over bar / event / upcoming  (spans right)
---------------------------------------------------
batter 1     |     batter 2     |     bowler
```

The scrolling top bar sits inside the centre column only, so it never runs across
the captain photos.

---

## The stadium view

The centre panel is a photograph (`assets/img/stadium.jpg`) with animated layers on
top of it: floodlight glow, drifting haze, crowd sparkle, and the ball itself. On a
boundary the crowd flares and the frame flashes; on a six or a wicket the camera
shakes.

### Using video instead

Video will always look better than composited cut-outs. Put clips in
`assets/video/` and name them in the `VIDEO` block at the top of
`assets/js/live.js`:

```js
const VIDEO = {
  idle:     "assets/video/idle.mp4",      // loops between deliveries
  delivery: "assets/video/delivery.mp4",  // plays once on every ball
  outcomes: {
    "4":  "assets/video/four.mp4",        // optional, per result
    "6":  "assets/video/six.mp4",
    "W":  "assets/video/wicket.mp4",
    "0":  "", "WD": "", "NB": ""
  }
};
```

As soon as any clip is set, the panel switches to video and the photo and cut-out
players are skipped. Anything you leave empty falls back: an outcome clip falls back
to `delivery`, and `delivery` falls back to `idle`. So one clip is enough to start.

The result burst, the boundary flash and the camera shake still fire on top of the
video, so a six still reads as a six even with a generic clip underneath.

**Specs for the clips**

| | |
|---|---|
| Format | MP4 (H.264) — widest browser and OBS support |
| Resolution | 1280×720 is plenty; 1920×1080 if you want headroom |
| Duration | 4–6 seconds for a delivery, 8–12 for the idle loop |
| Audio | none needed — clips are muted, you will have your own commentary |
| Size | keep each clip under about 4 MB |

The stadium panel is roughly **2.1:1**, wider than 16:9, so a 16:9 clip is cropped by
about 15% top and bottom. Keep the bowler, batsman and stumps in the middle band of
the frame and nothing important will be lost.

For the idle loop, ask for a locked-off camera with only the crowd moving — that
loops without a visible jump. Delivery clips do not need to loop.

**One thing to watch on Vercel:** video files count against your deployment size and
bandwidth. A handful of small clips is fine. If you add many, or large ones, host them
on storage or a CDN and put the full URL in `VIDEO` instead of a local path.

Video mode needs the full project folder — `standalone.html` cannot carry video inside
itself, though it will find the clips if you keep it next to the `assets/` folder.

### The players

The stadium is an empty photograph. The bowler, batsman and keeper are separate
transparent PNGs composited on top, so each one is a real layer that can be moved,
scaled and swapped between poses.

On every delivery the bowler steps through four poses — run up, gather, action,
follow through — while moving up the frame and shrinking, because he is running away
from the camera. The ball leaves his hand, travels to the far end, and the batsman
switches to the shot that matches the outcome: a drive for four, a pull for six, a
punch for singles, the stance for a dot.

Positions live in the `SCENE` object at the top of `assets/js/live.js`. Every value is
a percentage of the stadium panel, and `y` is where the player's **feet** land, not
the centre:

```js
batsman: { x:54.0, y:59.8, h:16.5, flip:true },
keeper:  { x:50.0, y:57.2, h:11.5, flip:true },

bowlerRun:    { x:41.5, y:88.5, h:23.0 },
bowlerGather: { x:44.0, y:82.0, h:20.0 },
bowlerAction: { x:46.5, y:77.5, h:17.5 },
bowlerFollow: { x:48.0, y:75.0, h:16.5 },
```

If someone floats above the ground, lower `y`. If they look too big, lower `h`.
`flip:true` mirrors the cut-out so the player faces back down the pitch. The far pair
are drawn slightly larger than strict perspective would allow — at true scale they
are almost invisible on a stream.

Poses live in `assets/img/`: `bat-stance`, `bat-drive`, `bat-punch`, `bat-pull`,
`bowl-runup`, `bowl-gather`, `bowl-action`, `bowl-follow`, `keeper`. To add a shot
type, drop in another cut-out and map it in `BAT_POSE`.

### Swapping the photo

To use a different photo, replace `assets/img/stadium.jpg` and re-measure the
positions in the `SCENE` object at the top of `assets/js/live.js`. Everything there is
a percentage of the frame, so it holds at any size:

```js
const SCENE = {
  towers:  [...],        // floodlight heads, where the glow sits
  release: { x, y },     // the bowler's hand
  contact: { x, y },     // in front of the bat
  keeper:  { x, y },
  ropeY:   43            // the far boundary line
};
```

---

## Images

Put them in `assets/img/` and set the path from the adjust panel (gear button,
bottom right of the scoreboard):

- Flag — `assets/img/pak-flag.jpg`, used as the captain panel background
- Captain — `assets/img/pak-captain.png`, best as a PNG with the background removed

The server also guesses: it lowercases the team's short code and looks for
`assets/img/pak-flag.jpg` and `assets/img/pak-captain.png`. Name your files that way
and you never have to type a path.

Note that flags and player photos are usually someone else's copyright — use your own
images or properly licensed ones for a public site.

---

## Changing the colours

Every colour is defined once, in the `:root` block of `assets/css/base.css`.
`--edge` is the magenta border, `--gold` the numerals, `--grn1`/`--grn2` the batting
panel.
