import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { buildAuthorizeUrl, parseCallbackUrl, parseEnvFile, formatEnvFile, pickUsProfiles, mask, adsRequest } from './ads-auth.mjs';

test('authorize URL encodes scope, redirect and state', () => {
  const url = buildAuthorizeUrl('client id', 'http://localhost:3000/callback', 'abc');
  assert.match(url, /scope=advertising%3A%3Acampaign_management/);
  assert.match(url, /redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback/);
  assert.equal(new URL(url).searchParams.get('state'), 'abc');
});
test('callback validation', () => {
  assert.deepEqual(parseCallbackUrl('http://localhost/callback?state=s&code=c', 's'), { code: 'c' });
  for (const query of ['state=x&code=c', 'error=denied', 'state=s']) {
    assert.ok(parseCallbackUrl(`http://localhost/callback?${query}`, 's').error);
  }
});
test('env round trip and comments', () => {
  const values = { AMAZON_ADS_CLIENT_ID: 'id', AMAZON_ADS_CLIENT_SECRET: 'a=b', AMAZON_ADS_REFRESH_TOKEN: 'refresh', AMAZON_ADS_PROFILE_ID: '42', AMAZON_ADS_REGION: 'NA' };
  assert.deepEqual(parseEnvFile(`# comment\n\n${formatEnvFile(values)}`), values);
  assert.throws(() => formatEnvFile({ ...values, AMAZON_ADS_CLIENT_SECRET: 'bad\nvalue' }));
});
test('US filtering and masking', () => {
  assert.deepEqual(pickUsProfiles([{ countryCode: 'US' }, { countryCode: 'CA' }]), [{ countryCode: 'US' }]);
  for (const value of ['', 'a', 'abcd', 'abcdefghi']) assert.equal(mask(value), `****${value.slice(-4)}`);
});
test('Ads helper rejects POST before network', () => {
  assert.throws(() => adsRequest('/v2/profiles', { method: 'POST' }), /GET/);
});

test('verify explains how to authorize when the env file is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ads-auth-missing-'));
  try {
    const child = spawn(process.execPath, [new URL('./ads-auth.mjs', import.meta.url).pathname, 'verify'], {
      env: { ...process.env, ADS_AUTH_ENV_PATH: join(dir, '.env.ads') }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const [code] = await once(child, 'close');
    assert.equal(code, 1);
    assert.equal(output, '.env.ads not found; run: node scripts/ads-auth.mjs authorize\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('authorize and verify against local endpoints without leaking credentials', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ads-auth-'));
  const file = join(dir, '.env.ads');
  const secret = 'secret-unique-123'; const code = 'code-unique-456';
  const access = 'access-unique-789'; const refresh = 'refresh-unique-012';
  const requests = [];
  const mock = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: new URLSearchParams(body) });
    res.setHeader('Content-Type', 'application/json');
    const profile = { profileId: 42, countryCode: 'US', currencyCode: 'USD', accountInfo: { name: 'Test account', type: 'seller' } };
    res.end(JSON.stringify(req.url === '/token' ? { access_token: access, refresh_token: refresh } : req.url === '/v2/profiles' ? [profile] : profile));
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const portServer = createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
  const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
  const base = `http://127.0.0.1:${mock.address().port}`;
  const child = spawn(process.execPath, [new URL('./ads-auth.mjs', import.meta.url).pathname, 'authorize', '--port', String(port)], {
    cwd: dir, env: { ...process.env, AMAZON_ADS_CLIENT_ID: 'client-id', AMAZON_ADS_CLIENT_SECRET: secret, ADS_AUTH_ENV_PATH: file, ADS_AUTH_TOKEN_URL: `${base}/token`, ADS_AUTH_API_BASE: base }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = ''; let callback;
  child.stdout.on('data', chunk => {
    output += chunk;
    const match = output.match(/https:\/\/www\.amazon\.com\/ap\/oa\?[^\s]+/);
    if (match && !callback) {
      const state = new URL(match[0]).searchParams.get('state');
      child.stdin.write('invalid redirected URL\n');
      callback = new Promise(resolve => {
        child.stderr.on('data', () => {
          if (output.includes('Invalid redirected URL. Try again:')) resolve();
        });
      }).then(() => { child.stdin.end(`http://localhost:${port}/callback?state=${state}&code=${code}\n`); });
    }
  });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    const [exit] = await once(child, 'exit'); await callback;
    assert.equal(exit, 0, output);
    assert.match(output, /paste the full redirected URL here and press Enter \(input is hidden\):/);
    assert.match(output, /Invalid redirected URL\. Try again:/);
    const values = parseEnvFile(await readFile(file, 'utf8'));
    assert.deepEqual(Object.keys(values), ['AMAZON_ADS_CLIENT_ID', 'AMAZON_ADS_CLIENT_SECRET', 'AMAZON_ADS_REFRESH_TOKEN', 'AMAZON_ADS_PROFILE_ID', 'AMAZON_ADS_REGION']);
    assert.equal(values.AMAZON_ADS_CLIENT_ID, 'client-id');
    assert.equal(values.AMAZON_ADS_REGION, 'NA');
    assert.equal(values.AMAZON_ADS_CLIENT_SECRET, secret);
    assert.equal(values.AMAZON_ADS_REFRESH_TOKEN, refresh);
    assert.equal(values.AMAZON_ADS_PROFILE_ID, '42');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    for (const value of [secret, code, access, refresh]) assert.ok(!output.includes(value));
    assert.equal(requests[0].body.get('code'), code);
    assert.equal(requests[1].method, 'GET');
    assert.equal(requests[2].body.get('grant_type'), 'refresh_token');
    assert.equal(requests[3].headers['amazon-advertising-api-scope'], '42');
  } finally {
    child.kill(); mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve)); await rm(dir, { recursive: true, force: true });
  }
});

test('help succeeds and existing env file blocks authorization before credentials or network', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ads-auth-existing-'));
  const { writeFile } = await import('node:fs/promises');
  const file = join(dir, '.env.ads');
  await writeFile(file, 'existing file');
  async function run(args) {
    const child = spawn(process.execPath, [new URL('./ads-auth.mjs', import.meta.url).pathname, ...args], {
      env: { ...process.env, AMAZON_ADS_CLIENT_ID: '', AMAZON_ADS_CLIENT_SECRET: '', ADS_AUTH_ENV_PATH: file }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    const [code] = await once(child, 'close'); return { code, output };
  }
  try {
    const help = await run(['--help']); assert.equal(help.code, 0); assert.match(help.output, /Usage:/);
    const result = await run(['authorize']); assert.equal(result.code, 1); assert.match(result.output, /already exists/);
    assert.equal(await readFile(file, 'utf8'), 'existing file');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
