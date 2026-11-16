import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.ts';
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(join(dataDir, 'panel.sqlite'));
chmodSync(join(dataDir, 'panel.sqlite'), 0o600);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','client')));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS attempts(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id INTEGER NOT NULL REFERENCES users(id),enabled INTEGER NOT NULL DEFAULT 1,ingest_hash TEXT NOT NULL,created_at INTEGER NOT NULL,fallback TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),name TEXT NOT NULL,filename TEXT NOT NULL,bytes INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,user_id INTEGER,event TEXT NOT NULL,resource TEXT);
CREATE INDEX IF NOT EXISTS audit_at ON audit(at);
CREATE INDEX IF NOT EXISTS channels_owner ON channels(owner_id);`);
export function audit(user: number | null, event: string, resource: string | null = null) {
  db.prepare('INSERT INTO audit(at,user_id,event,resource) VALUES(?,?,?,?)').run(Date.now(),user,event,resource);
}

// Additive migrations preserve installations created before 0.3.
for (const [table,columns] of Object.entries({channels:{storage_quota_bytes:"INTEGER",public_player:"INTEGER NOT NULL DEFAULT 0",autodj:"TEXT NOT NULL DEFAULT '{}'",watermark:"TEXT NOT NULL DEFAULT '{}'"},assets:{channel_id:"TEXT",folder:"TEXT NOT NULL DEFAULT ''",duration:"REAL NOT NULL DEFAULT 0",source_bytes:"INTEGER",source_sha256:"TEXT"}})) {
 const existing=new Set((db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(x=>x.name));
 for(const [name,type] of Object.entries(columns))if(!existing.has(name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}
db.exec('CREATE INDEX IF NOT EXISTS assets_source_duplicate ON assets(owner_id,channel_id,folder,source_sha256);');
db.exec(`CREATE TABLE IF NOT EXISTS folders(owner_id INTEGER NOT NULL REFERENCES users(id),path TEXT NOT NULL,PRIMARY KEY(owner_id,path));
CREATE TABLE IF NOT EXISTS logos(id TEXT PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),width INTEGER NOT NULL,height INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS playout_runtime(channel_id TEXT PRIMARY KEY,cycle INTEGER NOT NULL DEFAULT 0,current_asset TEXT,state TEXT NOT NULL DEFAULT 'waiting',updated_at INTEGER NOT NULL);`);

db.exec(`CREATE TABLE IF NOT EXISTS radio_channels(
 channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
 source_url TEXT NOT NULL,
 station_api_url TEXT NOT NULL DEFAULT '',
 station_data TEXT NOT NULL DEFAULT '{}',
 recording INTEGER NOT NULL DEFAULT 0,
 published INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL DEFAULT 'waiting',
 updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS radio_songs(
 channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
 played_at INTEGER NOT NULL,
 duration INTEGER NOT NULL DEFAULT 0,
 title TEXT NOT NULL,
 artist TEXT NOT NULL DEFAULT '',
 text TEXT NOT NULL DEFAULT '',
 art TEXT NOT NULL DEFAULT '',
 sh_id INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(channel_id, played_at)
);
CREATE INDEX IF NOT EXISTS radio_songs_channel_played ON radio_songs(channel_id, played_at DESC);`);

for (const [name, type] of Object.entries({
  station_api_url: "TEXT NOT NULL DEFAULT ''",
  station_data: "TEXT NOT NULL DEFAULT '{}'",
})) {
  const existing = new Set((db.prepare('PRAGMA table_info(radio_channels)').all() as { name: string }[]).map(x => x.name));
  if (!existing.has(name)) db.exec(`ALTER TABLE radio_channels ADD COLUMN ${name} ${type}`);
}
