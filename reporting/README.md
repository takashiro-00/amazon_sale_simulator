# Amazon daily reports

Read-only local MCP server for AussieGifty, US marketplace (`ATVPDKIKX0DER`), NA region. Requires Node 24+ and the dependencies in this directory. stdout is reserved for MCP; errors go to stderr. No credentials are needed to list tools.

## Setup

Run from the repository root:

```sh
node reporting/setup.mjs ads
node reporting/setup.mjs sp
node reporting/setup.mjs check
```

Ads setup uses Login with Amazon, localhost:3000/callback, a checked random state, a 10-minute deadline and a hidden full-URL paste fallback. Pick a US profile. SP setup accepts credentials and a Seller Central self-authorized refresh token; the app needs the role permitting Sales and Traffic reports. Secrets are hidden. Environment variables with matching names bypass credential prompts. The Ads authorization code is always obtained through the callback/state flow.

Credentials are merged into root `.env.amazon` atomically with mode 600; unrelated keys and comments are preserved. See `.env.amazon.example` for keys. Defaults: NA region, US marketplace. `AMAZON_ENV_PATH` overrides the credential file location. Existing process environment credentials take precedence. `check` verifies each part separately and returns nonzero if either is missing or fails.

Register with Claude Code:

```sh
claude mcp add amazon-reports -- node /Users/macbook/Projects/amazon-ads-automation/reporting/server.mjs
```

## Tools

Exactly two tools are exposed:

```json
{"name":"get_daily_ads_report","arguments":{"date":"2026-07-04"}}
{"name":"get_daily_sales_report","arguments":{"date":"2026-07-04","refresh":true}}
{"name":"get_daily_ads_report","arguments":{"date":"2026-07-04","reportId":"existing-report-id"}}
```

Dates default to yesterday: Ads profile timezone (fallback America/Los_Angeles), sales America/Los_Angeles. Sales day boundaries account for daylight saving time, including transition days. Pending reports return the reportId and date after at most four minutes of polling; pass both back to resume. Polling defaults to 15 seconds. `AMAZON_REPORT_POLL_MS` and `AMAZON_REPORT_MAX_POLL_MS` allow shorter test intervals (the latter is capped at four minutes).

Ads returns totals and campaigns sorted by spend, including CTR/ACoS percentages, CPC and ROAS. Zero divisors yield null. Sales returns the day's sales, units, order items, traffic and percentages plus the top ten parent ASINs by ordered sales. Parsed final results are cached at `reporting/data/<date>-ads.json` or `<date>-sales.json` with mode 600. `refresh: true` bypasses the cache. Use refresh when switching accounts; caches are local to this single-account installation. Numeric results round to two decimals.

## Read-only guarantee

All report-service HTTP requests pass through `amazonRequest`, which rejects methods and paths before networking. The explicit allowlist is:

| Service | Method | Path |
| --- | --- | --- |
| Ads | GET | `/v2/profiles`, `/v2/profiles/{id}` |
| Ads | POST | `/reporting/reports` |
| Ads | GET | `/reporting/reports/{id}` |
| SP-API | POST | `/reports/2021-06-30/reports` |
| SP-API | GET | `/reports/2021-06-30/reports/{id}` |
| SP-API | GET | `/reports/2021-06-30/documents/{id}` |
| SP-API | GET | `/sellers/v1/marketplaceParticipations` |
| LWA | POST | `https://api.amazon.com/auth/o2/token`, refresh-token grant only |
| Download | GET | HTTPS presigned report document URL returned by Amazon |

The two service POSTs only generate reports. There are no tools or code paths to change campaigns, bids, budgets, listings, inventory or orders. The interactive Ads setup alone reuses the existing `scripts/ads-auth.mjs` authorization-code exchange to bootstrap credentials; the running MCP server allows only token refresh. Authorization-code exchange cannot be performed by an MCP tool.

Downloads never include Amazon auth headers. Redirects are rejected. HTTP downloads are accepted only for 127.0.0.1 when all three endpoint overrides also point to HTTP 127.0.0.1. Endpoint overrides for local tests: `ADS_API_BASE`, `SP_API_BASE`, `LWA_TOKEN_URL`. Production defaults are the NA Amazon endpoints. Tokens are cached separately in memory until 60 seconds before expiry. 429/5xx responses retry up to three times with exponential backoff or Retry-After. Errors redact known secrets and their encoded forms.

## Tests

```sh
cd reporting && npm test
cd .. && node --test scripts/ads-auth.test.mjs
```

The HTTP integration tests bind a local mock server. A sandbox denying localhost listening will report EPERM; those tests remain present and fail visibly, rather than being skipped. The stdio integration tests verify actual MCP startup, tools/list, safe error output, and setup check behavior without networking.
