import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('concurrent fresh SQLite initialization serializes schema migrations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agora-db-migration-'));
  const database = join(directory, 'fresh.sqlite');
  const processes = Array.from({ length: 8 }, () => spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "const store=await import('./lib/server/db.ts');store.one('SELECT 1')"], {
    cwd: process.cwd(),
    env: { ...process.env, AGORA_DATABASE_PATH: database, AGORA_SEED: 'false', NODE_ENV: 'production' },
    stdio: ['ignore', 'ignore', 'pipe'],
  }));
  try {
    const results = await Promise.all(processes.map((child) => new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      let stderr = '';
      child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stderr }));
    })));
    for (const result of results) assert.equal(result.code, 0, result.stderr);
  } finally {
    await Promise.all(processes.map((child) => new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('close', () => resolve());
      child.kill('SIGKILL');
    })));
    await rm(directory, { recursive: true, force: true });
  }
});

test('legacy catalog rows survive the additive versioned-sales migration',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'agora-sales-upgrade-'));const database=join(directory,'legacy.sqlite');
 const script=`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.env.AGORA_DATABASE_PATH);db.exec("CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,amount INTEGER NOT NULL,currency TEXT NOT NULL,created_at TEXT NOT NULL);INSERT INTO products VALUES('prod_legacy','Legacy offer','Kept',1250,'usd','2025-01-01T00:00:00.000Z');");db.close();const store=await import('./lib/server/db.ts');const p=store.one('SELECT id,name,amount,version,tenant_id FROM products WHERE id=?','prod_legacy');if(!p||p.version!==1||p.tenant_id!=='owner'||p.amount!==1250)throw new Error('legacy product migration failed');const v=store.one('SELECT version,amount,updated_by FROM product_versions WHERE product_id=?','prod_legacy');if(!v||v.version!==1||v.amount!==1250||v.updated_by!=='migration')throw new Error('legacy product history missing');store.db.close();`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,AGORA_DATABASE_PATH:database,AGORA_SEED:'false',NODE_ENV:'production'},stdio:['ignore','ignore','pipe']});
 try{const result=await new Promise<{code:number|null;stderr:string}>((resolve,reject)=>{let stderr='';child.stderr?.setEncoding('utf8').on('data',(chunk:string)=>{stderr+=chunk;});child.once('error',reject);child.once('close',(code)=>resolve({code,stderr}));});assert.equal(result.code,0,result.stderr);}finally{await rm(directory,{recursive:true,force:true});}
});
