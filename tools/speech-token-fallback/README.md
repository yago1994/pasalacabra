# Speech token fallback (Azure Functions)

A second token endpoint for when the Cloudflare worker is unreachable: Spanish
ISPs block Cloudflare IPs during LaLiga matches, and the game can't get a speech
token. This one runs on Azure (`*.azurewebsites.net`), next to the Speech resource.

## Deploy

1. Azure portal → **Create a Function App**: Consumption (or Flex Consumption),
   runtime **Node.js 20**, same region as the Speech resource.
2. Function App → **Settings → Environment variables**, add:
   - `SPEECH_KEY`: the Speech resource's key (Keys and Endpoint)
   - `SPEECH_REGION`: e.g. `westeurope`
   - `ALLOWED_ORIGINS`: `https://pasalacabra.com`
   - `DEV_GATE_KEY` (optional): same value as the worker's, to allow localhost
3. Leave **API → CORS** empty: the function sets its own CORS headers.
4. Deploy this folder (VS Code Azure Functions extension → Deploy, or
   `func azure functionapp publish <app-name>` from here).
5. Check it: `curl -H "Origin: https://pasalacabra.com" https://<app-name>.azurewebsites.net/api/speech/token`
   should return `{ "token": "...", "region": "..." }`.
6. GitHub → repo **Settings → Secrets and variables → Actions → Variables**: add
   `VITE_SPEECH_TOKEN_FALLBACK_URL` = `https://<app-name>.azurewebsites.net/api/speech/token`.
   The next deploy picks it up.
