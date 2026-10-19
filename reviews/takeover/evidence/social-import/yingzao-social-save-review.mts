import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '/Users/xm-talen/Desktop/小明/coding/生图生视频/platform/src/server/app.ts';
import { createWorker } from '/Users/xm-talen/Desktop/小明/coding/生图生视频/platform/src/worker/runner.ts';
import { jobInputSchema } from '/Users/xm-talen/Desktop/小明/coding/生图生视频/platform/src/contracts/jobs.ts';
import type { Actor } from '/Users/xm-talen/Desktop/小明/coding/生图生视频/platform/src/contracts/core.ts';
const folder=await mkdtemp(join(tmpdir(),'yingzao-social-save-review-'));
const config={host:'127.0.0.1',port:4310,publicOrigin:'http://127.0.0.1:5174',databasePath:join(folder,'test.sqlite'),storageDir:join(folder,'media'),sessionSecret:'fixture-only',encryptionKey:'fixture-only',isProduction:false,demoMode:false,environmentSecrets:{tikhub:'fixture-only'}};
const instance=await createApp(config,{serveWeb:false});
let worker:ReturnType<typeof createWorker>|undefined;
try{
 const file=join(folder,'fixture.mp4');
 await promisify(execFile)('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x240:r=12:d=1','-c:v','libx264','-pix_fmt','yuv420p',file]);
 const buffer=await readFile(file);
 const owner=await instance.services.core.auth.register({email:'social-review@example.test',password:'ReadonlySocial2026!',displayName:'Review'});
 const wid=owner.workspace.id;
 const actor:Actor={userId:owner.user.id,authType:'session',apiKeyId:null,workspaceId:null,scopes:[]};
 const input=jobInputSchema.parse({operation:'media.import',providerId:'tikhub',linkUrl:'https://v.douyin.com/fixture/',options:{referenceAuthorized:true,externalCostAccepted:true}});
 const quote=instance.services.quote(actor,wid,input);
 const job=instance.services.submit(actor,wid,input,quote.id,randomUUID());
 let parserCalls=0;
 worker=createWorker(instance.services,{tikhub:{id:'tikhub',async execute(){parserCalls++;return {state:'complete',outputs:[{buffer,mimeType:'video/mp4',name:'fixture.mp4'}]};}}});
 const sql=instance.services.db.sqlite;
 sql.exec("CREATE TRIGGER review_reject_asset BEFORE INSERT ON assets BEGIN SELECT RAISE(ABORT,'fixture persistence failure'); END");
 const countFiles=async()=>(await readdir(config.storageDir,{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile()&&entry.name.endsWith('.mp4')).length;
 for(let attempt=1;attempt<=2;attempt++){
  sql.prepare("UPDATE job_items SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(job.id);
  await worker.tick();await worker.drain();
  console.log(JSON.stringify({case:'import-commit-failure',attempt,parserCalls,originalFiles:await countFiles(),assetRows:(sql.prepare('SELECT count(*) n FROM assets').get() as {n:number}).n,jobStatus:instance.services.get(actor,wid,job.id).status}));
 }
 sql.exec('DROP TRIGGER review_reject_asset');
 sql.prepare("UPDATE job_items SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(job.id);
 await worker.tick();await worker.drain();
 console.log(JSON.stringify({case:'import-recovered',parserCalls,originalFiles:await countFiles(),assetRows:(sql.prepare('SELECT count(*) n FROM assets').get() as {n:number}).n,jobStatus:instance.services.get(actor,wid,job.id).status}));
}finally{await worker?.stop();await instance.app.close();await rm(folder,{recursive:true,force:true});}
