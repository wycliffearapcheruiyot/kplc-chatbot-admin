# KPLC chatbot admin panel

React (Vite) admin for the Kenya Power chatbot gateway. Deploys to Netlify.

- **Knowledge base**: search, edit and save chunks. Each shows *Searchable* or *Needs embedding*. If the model session is live, saving re-embeds automatically; otherwise use **Embed pending** later. **Re-embed all** forces every chunk.
- **Chat logs**: newest conversations, with the chunk ids retrieved for each answer.
- **Model status** in the top bar polls `/session/status` every 5 s, with a **Start model** button, because embedding only works while a Kaggle session is `ready`.

## Warm-up first
On every load, before the login screen, the panel wakes the gateway, session backend and dataset backend in parallel and waits until each has answered with HTTP 200 (the gateway confirms the other two via `/health/upstreams`). If any is still asleep after ~2.5 min you get **Retry** or **Continue anyway**. It warms again before **Start model**, in case the tab sat open long enough for Render to put services back to sleep.

## Run locally
```bash
npm install
cp .env.example .env     # set VITE_API_URL to your gateway
npm run dev              # http://localhost:3000 (always allowed by the gateway's CORS)
```

## Deploy to Netlify
1. Push to GitHub, then New site → Import from Git.
2. Build command `npm run build`, publish directory `dist` (also set in `netlify.toml`).
3. Add environment variables `VITE_API_URL` (gateway), `VITE_SESSION_BACKEND_URL` and `VITE_DATASET_BACKEND_URL` (the other two Render URLs, used only for warm-up pings), then deploy.
4. Add the resulting Netlify origin (e.g. `https://your-admin.netlify.app`, no trailing slash) to the gateway's `ALLOWED_ORIGINS` on Render and redeploy the gateway.

## Security notes
- The admin token is **not** an environment variable. You type it into the login box; it is kept in `sessionStorage` (cleared when the tab closes) and sent as `X-Admin-Token` on admin requests.
- A 401 from the gateway signs you out; a 503 means `ADMIN_TOKEN` isn't set on the gateway.
- `index.html` sets `noindex`, but the page is still public: the token is the only lock.
