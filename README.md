# National Parks

A minimal website with a small local API that serves sample national park data.

Run locally:

```bash
# install dependencies
npm init -y
npm install express

# start server
node server.js

# open http://localhost:3000
```

Files:
- `server.js` — Express server exposing `/api/parks` and serving static files
- `data/parks.json` — sample data
- `index.html`, `styles.css`, `app.js` — front-end

New features
- `.env.example` — example env that includes `NPS_API_KEY`
- Rate limiting on the server (requires `express-rate-limit`)
- `/api/nps/parks` — proxy to the official NPS API (needs `NPS_API_KEY`)
- `/api/search?q=...` — unified search that queries local data and NPS (if configured)
- Front-end: favorites (stored in localStorage) and a "Use live NPS API" toggle

Notes about the diagnostic endpoint
- The server exposes a lightweight diagnostic endpoint at `/api/api_key` that checks whether a valid NPS API key is configured and can reach the NPS service. The front-end calls this to show the "Live API" status and auto-enable the "Use live NPS API" toggle when the key works.

Encouraging outdoor features
- `data/activities.json` — curated short activities (hike, picnic, birdwatching) with packing lists
- `/api/activities` — serves activities for the UI
- Daily challenge panel on the site that rotates suggestions by the day
- Packing checklist and an "Add to calendar" (.ics) export for planning visits

Install the extra packages:

```bash
npm install express-rate-limit node-fetch dotenv
```

Using the NPS Developer API (optional)

1. Register for an API key at https://www.nps.gov/subjects/developer/get-started.htm
2. Copy `.env.example` to `.env` and set `NPS_API_KEY` to the key you received.

The server accepts a few different environment variable names for backwards compatibility. Any of these will be detected automatically:

- `NPS_API_KEY` (recommended)
- `NATIONALPARKSERVICEAPIKEY`
- `API_KEY`
- `api_key` (lowercase)

3. Install `dotenv` if you want to load `.env` automatically (optional):

```bash
npm install dotenv
```

4. Run the server with the env var set. Example (macOS / zsh):

```bash
# example using lowercase env name
export api_key=your_key_here
node server.js
```

The server exposes a proxy route `/api/nps/parks` that forwards queries to the NPS API while keeping your key on the server. The front-end will try `/api/nps/parks` first, then fall back to the bundled sample data.

If you used a different env var name (for example `NATIONALPARKSERVICEAPIKEY`) the server will also pick it up automatically. To verify the server sees your key, start the server and watch the console for a message like:

```
Using NPS API key from NATIONALPARKSERVICEAPIKEY
```
