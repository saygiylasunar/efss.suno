const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

test('CSV UTF8 BOM, quotes, embedded newlines and commas',()=>{
  const rows=C.parseCsv('\uFEFFid,title,lyrics,is_liked\r\na1,"Hello, World","line 1\nline 2",False\r\na2,"Foo ""Bar""",,True\r\n');
  assert.equal(rows.length,2);assert.equal(rows[0].title,'Hello, World');assert.equal(rows[0].lyrics,'line 1\nline 2');assert.equal(rows[1].title,'Foo "Bar"');assert.equal(C.normalizeSong(rows[0]).liked,false);assert.equal(C.normalizeSong(rows[1]).liked,true);
});
test('catalog normalizes custom fields and relation',()=>{
  const song=C.normalizeSong({id:'b',title:'b',created_at:'2025-01-01T12:00:00Z',_workspaces:['Öcü'],project:{name:'Zarar'},is_disliked:'True', metadata:{prompt:'Lyrics',tags:'Dark, Rock',type:'stem',cover_clip_id:'a',gpt_description_prompt:'Prompt',duration:130}});
  assert.deepEqual(song.workspaces,['Öcü','Zarar']);assert.equal(song.stem,true);assert.equal(song.disliked,true);assert.equal(song.isCover,true);assert.equal(song.style,'Dark, Rock');assert.equal(song.lyrics,'Lyrics');assert.equal(song.prompt,'Prompt');assert.deepEqual(song.refs,['a']);
});
test('unique by clip ID preserving workspace membership',()=>{
  const entries=C.uniqueSongs([{id:'a',title:'First',_workspaces:['A']},{id:'a',title:'New',_workspaces:['B']}]);
  assert.equal(entries.length,1);assert.equal(entries[0].title,'New');assert.deepEqual(entries[0]._workspaces,['A','B']);
});
test('full backup restores raw collection and statuses',()=>{
  const imported=C.fromImport({format:'sunoEFSS-archive-v1',songs:[{id:'a'}],workspaces:[],flags:{a:{status:'downloaded'}},activity:[{id:'a'}]});
  assert.equal(imported.songs.length,1);assert.equal(imported.flags.a.status,'downloaded');
  assert.equal(C.validFlags({a:{status:'downloaded'},b:{status:'missing'}},['a']).b,undefined);
});
test('CSV flags escapes dangerous newline and punctuation',()=>{
  const csv=C.flagsCsv([{id:'x',title:'A,"B"\nC'}],{x:{status:'missing',note:'comment'}});
  assert.match(csv,/"A,""B""\nC"/);assert.match(csv,/missing/);
});
test('invalid csv does not silently accept unmapped data',()=>{assert.throws(()=>C.parseCsv('title,other\nOne,Two'),/id/);});

test('CSV status export prevents spreadsheet formula injection',()=>{
  const csv=C.flagsCsv([{id:'x',title:'=HYPERLINK("evil")'}],{});
  assert.match(csv, /"\'=HYPERLINK/);
});

test('Suno playlist and single-song URLs are parsed without network access',()=>{
  const pl=C.parseSunoLink('https://suno.com/playlist/e4fc5b93-d19b-4ce0-ae4a-668b7c059187?utm_source=share');
  assert.equal(pl.type,'playlist');assert.equal(pl.id,'e4fc5b93-d19b-4ce0-ae4a-668b7c059187');
  assert.equal(pl.url,'https://suno.com/playlist/e4fc5b93-d19b-4ce0-ae4a-668b7c059187');
  const song=C.parseSunoLink('https://www.suno.com/s/aBc123');
  assert.equal(song.type,'song');assert.equal(song.url,'https://suno.com/song/aBc123');
});
test('Suno link registry rejects credentials, foreign origins and unsafe protocols',()=>{
  for(const input of [
    'https://suno.com.evil.example/song/a',
    'javascript:alert(1)',
    'http://suno.com/song/a',
    'https://foo:pass@suno.com/song/a',
    'https://suno.com:9001/song/a',
    'https://suno.com/other/a'
  ])assert.throws(()=>C.parseSunoLink(input));
});
test('Playlist song references deduplicate and reject mixed playlist URLs',()=>{
  const parsed=C.parseSongLines('https://suno.com/song/id1\nhttps://suno.com/song/id1\nhttps://suno.com/song/id2');
  assert.deepEqual(parsed.map(x=>x.id),['id1','id2']);
  assert.throws(()=>C.parseSongLines('https://suno.com/playlist/pl1'));
});
test('v2 archive roundtrip preserves registered playlists and memberships',()=>{
  const restored=C.fromImport({format:'sunoEFSS-archive-v2',songs:[{id:'song1'}],playlists:[{id:'pl1',name:'Münzevi',url:'https://suno.com/playlist/pl1'}],playlistMembers:{pl1:['song1','ghost']}});
  const playlists=C.validPlaylists(restored.playlists);
  assert.equal(playlists[0].url,'https://suno.com/playlist/pl1');
  assert.deepEqual(C.validPlaylistMembers(restored.playlistMembers,playlists,['song1']),{pl1:['song1']});
});

test('CSV export preserves source link and linked playlist',()=>{
  const csv=C.flagsCsv([{id:'s1',title:'Song'}],{s1:{status:'downloaded'}},[{id:'p1',name:'My Playlist'}],{p1:['s1']});
  assert.match(csv,/My Playlist/);
  assert.match(csv,/https:\/\/suno.com\/song\/s1/);
});