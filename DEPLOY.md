# Deploy instructions

Paste the block below into Claude Code, from inside this folder.

---

Push this folder to a NEW GitHub repository called "ma-digital-sports".
Then create a NEW project on Vercel and deploy it.

Settings for the Vercel project:
- Framework Preset: Other
- Build Command: leave empty
- Output Directory: leave empty
- Install Command: npm install

Important:
- Do NOT touch or modify any of my existing Vercel projects.
- Do NOT put my API key anywhere in the code. I will add the environment
  variable CRIC_API_KEY myself in the Vercel dashboard afterwards.
- .gitignore already exists — keep node_modules and .env out of the repo.

After deploying, tell me the live URL.

---

## Then, by hand in the Vercel dashboard

1. Open the new project -> Settings -> Environment Variables
2. Add:
     Name:  CRIC_API_KEY
     Value: your key from cricketdata.org
     Tick all three: Production, Preview, Development
3. Save
4. Go to Deployments -> latest -> "..." -> Redeploy
   (a new environment variable does not apply until you redeploy)

## Check it worked

Open:  https://YOUR-SITE.vercel.app/api/live

  {"ok":true, ...}                             -> working
  {"ok":false,"reason":"CRIC_API_KEY is..."}   -> variable did not apply, redeploy

## URLs

  https://YOUR-SITE.vercel.app            the site
  https://YOUR-SITE.vercel.app/?stream=1  clean capture for OBS (1920x1080)
