import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { readFile, stat, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KEYS = ['AMAZON_ADS_CLIENT_ID', 'AMAZON_ADS_CLIENT_SECRET', 'AMAZON_ADS_REFRESH_TOKEN', 'AMAZON_ADS_PROFILE_ID', 'AMAZON_ADS_REGION'];
const envPath = () => process.env.ADS_AUTH_ENV_PATH || join(dirname(fileURLToPath(import.meta.url)), '..', '.env.ads');
const sensitive = new Set();
function safe(value) {
  let text = String(value ?? '');
  for (const secret of sensitive) {
    if (!secret) continue;
    for (const form of [secret, encodeURIComponent(secret), new URLSearchParams({ v: secret }).toString().slice(2)]) {
      text = text.split(form).join('[redacted]');
    }
  }
  return text.replace(/[\x00-\x1f\x7f]/g, ' ');
}
export const mask = value => `****${String(value).slice(-4)}`;
export function buildAuthorizeUrl(clientId, redirectUri, state) {
  return `https://www.amazon.com/ap/oa?${new URLSearchParams({ client_id: clientId, scope: 'advertising::campaign_management', response_type: 'code', redirect_uri: redirectUri, state })}`;
}
export function parseCallbackUrl(value, expectedState) {
  let url;
  try { url = new URL(value); } catch { return { error: 'Invalid redirected URL.' }; }
  if (url.searchParams.has('error')) return { error: 'Amazon authorization was denied.' };
  if (url.searchParams.get('state') !== expectedState) return { error: 'State mismatch.' };
  const code = url.searchParams.get('code');
  return code ? { code } : { error: 'Missing authorization code.' };
}
export function parseEnvFile(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index > 0) values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return values;
}
export function formatEnvFile(values) {
  return KEYS.map(key => {
    const value = String(values[key] ?? '');
    if (!value || /[\r\n\0]/.test(value) || value !== value.trim()) throw new Error('Invalid credential file value.');
    return `${key}=${value}\n`;
  }).join('');
}
export const pickUsProfiles = profiles => profiles.filter(profile => profile.countryCode === 'US');
async function request(url, options) {
  try { return await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error('Network request failed or timed out.'); }
}
export function adsRequest(path, options = {}) {
  if ((options.method || 'GET').toUpperCase() !== 'GET') throw new Error('Ads API requests must use GET.');
  const base = process.env.ADS_AUTH_API_BASE || 'https://advertising-api.amazon.com';
  return request(`${base.replace(/\/$/, '')}${path}`, { ...options, method: 'GET' });
}
async function json(response) {
  try { return await response.json(); } catch { throw new Error(`Invalid JSON response (HTTP ${response.status}).`); }
}
async function token(values) {
  const response = await request(process.env.ADS_AUTH_TOKEN_URL || 'https://api.amazon.com/auth/o2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values),
  });
  const data = await json(response);
  for (const key of ['access_token', 'refresh_token', 'code', 'client_secret']) if (typeof data[key] === 'string') sensitive.add(data[key]);
  if (!response.ok) {
    const fields = ['error', 'error_description'].filter(key => typeof data[key] === 'string').map(key => `${key}: ${safe(data[key])}`).join('; ');
    throw new Error(`Token endpoint HTTP ${response.status}${fields ? `; ${fields}` : ''}`);
  }
  if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('Token response is missing an access token.');
  return data;
}
function headers(values, access, scope = false) {
  return { Authorization: `Bearer ${access}`, 'Amazon-Advertising-API-ClientId': values.AMAZON_ADS_CLIENT_ID,
    ...(scope ? { 'Amazon-Advertising-API-Scope': values.AMAZON_ADS_PROFILE_ID } : {}) };
}
function prompt(label, hidden = false) {
  if (!process.stdin.isTTY) return Promise.reject(new Error('Interactive input requires a TTY; supply credentials through the environment.'));
  if (!hidden) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve, reject) => {
      rl.once('SIGINT', () => { rl.close(); reject(new Error('Aborted.')); });
      rl.question(label, answer => { rl.close(); resolve(answer.trim()); });
    });
  }
  return new Promise((resolve, reject) => {
    const input = process.stdin; const wasRaw = input.isRaw; let value = '';
    process.stdout.write(label); input.setRawMode(true); input.setEncoding('utf8'); input.resume();
    const finish = error => {
      input.removeListener('data', onData); input.setRawMode(Boolean(wasRaw)); input.pause(); process.stdout.write('\n');
      error ? reject(error) : resolve(value.trim());
    };
    const onData = chunk => {
      for (const char of chunk) {
        if (char === '\u0003') return finish(new Error('Aborted.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') value = [...value].slice(0, -1).join('');
        else if (char >= ' ') value += char;
      }
    };
    input.on('data', onData);
  });
}
async function waitForCode(port, state, url) {
  return new Promise((resolve, reject) => {
    let rl; let timer; let settled = false;
    const server = createServer((req, res) => {
      const parsed = new URL(req.url, `http://localhost:${port}`);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      if (req.method !== 'GET' || parsed.pathname !== '/callback') { res.writeHead(404); res.end('Not found.'); return; }
      const result = parseCallbackUrl(parsed.href, state);
      if (parsed.searchParams.has('error')) { res.writeHead(400); res.end(result.error); finish(new Error(result.error)); }
      else if (result.error) { res.writeHead(400); res.end(result.error); }
      else { res.end('Authorization received. You can close this tab.'); finish(null, result.code); }
    });
    const onSigint = () => finish(new Error('Aborted.'));
    function finish(error, code) {
      if (settled) return; settled = true;
      clearTimeout(timer); rl?.close(); process.stdin.pause(); process.removeListener('SIGINT', onSigint);
      server.close(); server.closeIdleConnections();
      error ? reject(error) : resolve(code);
    }
    server.once('error', () => finish(new Error('Could not start localhost callback server.')));
    process.once('SIGINT', onSigint);
    timer = setTimeout(() => finish(new Error('Authorization timed out after 10 minutes.')), 600_000);
    server.listen(port, '127.0.0.1', () => {
      console.log(url);
      console.log('If the browser could not reach localhost, paste the full redirected URL here and press Enter (input is hidden):');
      // No output interface: pasted codes must not be echoed by readline.
      // A TTY itself echoes typed text, so disable echo with raw input below.
      if (process.stdin.isTTY) {
        const input = process.stdin; const wasRaw = input.isRaw; let line = '';
        input.setRawMode(true); input.setEncoding('utf8');
        const onData = chunk => {
          for (const char of chunk) {
            if (char === '\u0003') return onSigint();
            if (char === '\r' || char === '\n') { accept(line); line = ''; }
            else if (char === '\u007f' || char === '\b') line = [...line].slice(0, -1).join('');
            else if (char >= ' ') line += char;
          }
        };
        input.on('data', onData); input.resume();
        rl = { close() { input.removeListener('data', onData); input.setRawMode(Boolean(wasRaw)); } };
      } else {
        rl = createInterface({ input: process.stdin, terminal: false });
        rl.on('line', accept);
      }
    });
    function accept(line) {
      if (settled) return;
      const result = parseCallbackUrl(line.trim(), state);
      if (result.error) console.error(`${result.error} Try again:`);
      else finish(null, result.code);
    }
  });
}
async function writeCredentials(path, values) {
  const temp = `${path}.${randomBytes(12).toString('hex')}.tmp`;
  try {
    await writeFile(temp, formatEnvFile(values), { mode: 0o600, flag: 'wx' });
    await rename(temp, path); await chmod(path, 0o600);
  } finally { await unlink(temp).catch(() => {}); }
}
async function verify() {
  let text;
  try { text = await readFile(envPath(), 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('.env.ads not found; run: node scripts/ads-auth.mjs authorize');
    throw error;
  }
  const values = parseEnvFile(text);
  for (const key of KEYS) if (!values[key]) throw new Error('Credential file is missing required keys.');
  sensitive.add(values.AMAZON_ADS_CLIENT_SECRET); sensitive.add(values.AMAZON_ADS_REFRESH_TOKEN);
  const mode = (await stat(envPath())).mode & 0o777;
  console.log(`.env.ads mode: ${mode.toString(8)}`);
  if (mode !== 0o600) console.warn('Warning: .env.ads mode is not 600.');
  const data = await token({ grant_type: 'refresh_token', refresh_token: values.AMAZON_ADS_REFRESH_TOKEN, client_id: values.AMAZON_ADS_CLIENT_ID, client_secret: values.AMAZON_ADS_CLIENT_SECRET });
  const response = await adsRequest(`/v2/profiles/${encodeURIComponent(values.AMAZON_ADS_PROFILE_ID)}`, { headers: headers(values, data.access_token, true) });
  console.log(`HTTP ${response.status}`);
  if (response.status !== 200) throw new Error('Profile verification failed.');
  const profile = await json(response);
  for (const [key, value] of Object.entries({ profileId: profile.profileId, countryCode: profile.countryCode, currencyCode: profile.currencyCode, 'accountInfo.name': profile.accountInfo?.name, 'accountInfo.type': profile.accountInfo?.type })) console.log(`${key}: ${safe(value)}`);
}
async function authorize(port, force) {
  if (!force) {
    try { await stat(envPath()); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot inspect credential file.'); return run(); }
    throw new Error('.env.ads already exists; use --force to replace it.');
  }
  return run();
  async function run() {
    const values = {};
    for (const key of KEYS.slice(0, 2)) {
      values[key] = (process.env[key] ?? await prompt(`${key}: `, key.endsWith('SECRET'))).trim();
      if (!values[key]) throw new Error(`${key} must not be empty.`);
    }
    sensitive.add(values.AMAZON_ADS_CLIENT_SECRET);
    const state = randomBytes(32).toString('hex'); const redirect = `http://localhost:${port}/callback`;
    const code = await waitForCode(port, state, buildAuthorizeUrl(values.AMAZON_ADS_CLIENT_ID, redirect, state)); sensitive.add(code);
    const data = await token({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: values.AMAZON_ADS_CLIENT_ID, client_secret: values.AMAZON_ADS_CLIENT_SECRET });
    if (typeof data.refresh_token !== 'string' || !data.refresh_token) throw new Error('Token response is missing a refresh token.');
    const response = await adsRequest('/v2/profiles', { headers: headers(values, data.access_token) });
    if (!response.ok) throw new Error(`Profiles endpoint HTTP ${response.status}.`);
    const profiles = await json(response);
    if (!Array.isArray(profiles)) throw new Error('Invalid profiles response.');
    const us = pickUsProfiles(profiles); let selected = us[0];
    if (!us.length) {
      for (const profile of profiles) console.log(`${safe(profile.countryCode)} / ${safe(profile.accountInfo?.name)}`);
      throw new Error('No US profiles found; credential file was not written.');
    }
    if (us.length > 1) {
      us.forEach((profile, index) => console.log(`${index + 1}. ${safe(profile.profileId)} | ${safe(profile.accountInfo?.name)} | ${safe(profile.accountInfo?.type)} | ${safe(profile.accountInfo?.marketplaceStringId)}`));
      for (;;) {
        const answer = await prompt('Choose a US profile number: ');
        if (/^\d+$/.test(answer) && Number(answer) >= 1 && Number(answer) <= us.length) { selected = us[Number(answer) - 1]; break; }
        console.error('Invalid profile selection.');
      }
    }
    Object.assign(values, { AMAZON_ADS_REFRESH_TOKEN: data.refresh_token, AMAZON_ADS_PROFILE_ID: String(selected.profileId), AMAZON_ADS_REGION: 'NA' });
    await writeCredentials(envPath(), values); await verify();
  }
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || command === '-h') { console.log('Usage:\n  node scripts/ads-auth.mjs authorize [--port 3000] [--force]\n  node scripts/ads-auth.mjs verify'); return; }
  if (command === 'verify' && !args.length) return verify();
  if (command !== 'authorize') throw new Error('Use --help for usage.');
  let port = 3000; let force = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force') force = true;
    else if (args[i] === '--port' && /^\d+$/.test(args[i + 1] || '')) port = Number(args[++i]);
    else throw new Error('Invalid arguments; use --help.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
  await authorize(port, force);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(safe(error.message)); process.exitCode = 1; });
}

export { prompt, waitForCode, token, sensitive };
