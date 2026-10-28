const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const neutralId = '11111111-1111-4111-8111-111111111111';

test('empty imports stay empty', () => {
  assert.deepEqual(C.fromImport({songs:[]}).songs, []);
  assert.deepEqual(C.uniqueSongs([]), []);
});
test('generic playlist URL parses without an account', () => {
  const parsed = C.parseSunoLink('https://suno.com/playlist/' + neutralId);
  assert.equal(parsed.type, 'playlist');
  assert.equal(parsed.id, neutralId);
});
test('duplicate clip IDs collapse', () => {
  const out = C.uniqueSongs([{id:neutralId,title:'First'},{id:neutralId,title:'Latest'}]);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Latest');
});
test('generic archive metadata normalizes', () => {
  const song = C.normalizeSong({id:neutralId, title:'Track',metadata:{tags:'Ambient'}});
  assert.equal(song.id, neutralId);
  assert.equal(song.style, 'Ambient');
});
test('backup with no user data works', () => {
  const backup=C.fromImport({format:'sunoEFSS-archive-v2',songs:[],workspaces:[],playlists:[],playlistMembers:{},flags:{},activity:[]});
  assert.equal(backup.songs.length,0);
});
