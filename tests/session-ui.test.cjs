const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const client = fs.readFileSync(path.join(root, 'connect.js'), 'utf8');

test('persistent session entry exists outside hidden collector dialog', () => {
  assert.match(html, /id="openSessionPanel"/);
  assert.match(html, /id="sessionBadge"/);
  assert.match(html, /id="sessionFooter"/);
});
test('collector status distinguishes offline, disconnected and connected', () => {
  assert.match(client, /function setSessionUI\(mode\)/);
  for(const value of ['offline','disconnected','online']) assert.ok(client.includes(value));
  assert.match(client, /setSessionUI\(current.connected \? 'online' : 'disconnected'\)/);
});
test('session hints do not solicit sharing credentials outside localhost', () => {
  assert.match(client, /auth\.suno\.com/);
  assert.match(client, /__client/);
  assert.match(client, /GitHub'a veya başka bir kişiye gönderme/);
});
