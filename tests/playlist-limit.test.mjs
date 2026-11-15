import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';

const dir=mkdtempSync(join(tmpdir(),'openmediacp-playlist-limit-'));
process.env.DATA_DIR=dir;
const {db}=await import('../src/server/db.ts');
const auth=await import('../src/server/auth.ts');
const channels=await import('../src/server/channels.ts');
const playlist=await import('../src/server/playlist.ts');
const {maxPlaylistEntries,maxPlaylistVideos,playlistAssetIds}=await import('../src/server/playlist-entries.ts');

const userId=await auth.createUser('limit'+randomBytes(4).toString('hex'),'long enough password 1!','client');
const actor={id:userId,username:'limit',role:'client'};
const channel=channels.createChannel('Canal de límites',userId,actor).channel;

test.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});

test('playlist limits are shared and above one folder of 100 videos',()=>{
  assert.equal(maxPlaylistEntries,500);
  assert.equal(maxPlaylistVideos,500);
});

test('a folder with more than 100 videos can be added to the playlist',()=>{
  const ids=[];
  for(let i=0;i<120;i++){
    const id=randomBytes(16).toString('hex');
    ids.push(id);
    db.prepare('INSERT INTO assets(id,owner_id,name,filename,bytes,created_at,folder,duration,channel_id) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id,userId,`clip-${i}.mp4`,`${id}.mp4`,10,Date.now(),'80s Pop',1,channel.id);
  }
  const entries=[{folder:'80s Pop',ids:[...ids]}];
  assert.equal(playlistAssetIds(entries).length,120);
  channels.setFallback(actor,channel.id,ids,{shuffle:false,reshuffle:false,every:0,separatorIds:[]},undefined,entries);
  const saved=JSON.parse(channels.accessibleChannel(actor,channel.id).fallback);
  assert.equal(saved.length,120,'All 120 videos must survive the save');
});

test('the server still rejects oversized playlists',()=>{
  const assets=new Map();
  for(let i=0;i<=maxPlaylistVideos;i++)assets.set(`id-${i}`,'80s Pop');
  const ids=[...assets.keys()];
  assert.throws(()=>playlist.validatePlaylistEntries([{folder:'80s Pop',ids}],assets),/Los videos deben pertenecer/);
  assert.throws(()=>channels.setFallback(actor,channel.id,ids.slice(0,maxPlaylistVideos+1),{}),/hasta 500 videos distintos/);
});
