import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '/Users/xm-talen/Desktop/小明/coding/生图生视频/platform/src/server/app.ts';
import type {Actor} from '/Users/xm-talen/Desktop/小明/coding/生图生视频/platform/src/contracts/core.ts';
const folder=await mkdtemp(join(tmpdir(),'yingzao-team-account-review-'));
const instance=await createApp({host:'127.0.0.1',port:4310,publicOrigin:'http://127.0.0.1:5174',databasePath:join(folder,'test.sqlite'),storageDir:join(folder,'media'),sessionSecret:'fixture-only',encryptionKey:'fixture-only',isProduction:false,demoMode:false,environmentSecrets:{}},{serveWeb:false});
try{
 const core=instance.services.core;
 const owner=await core.auth.register({email:'local-review@example.test',password:'LocalReviewPassword2026!',displayName:'Review'});
 const actor:Actor={userId:owner.user.id,authType:'session',apiKeyId:null,workspaceId:null,scopes:[]};
 const wid=owner.workspace.id;
 const teams=[core.team.create(actor,{name:'First team'}),core.team.create(actor,{name:'Second team'})];
 console.log(JSON.stringify({case:'team-entry',createdTeams:teams.length,persistedOwnedTeams:core.auth.listWorkspaces(actor).filter(w=>w.kind==='team').length}));
 core.auth.update(actor,{preferences:{confirmGeneration:false,defaultPlatform:'通用电商'}});
 core.auth.update(actor,{preferences:{locale:'en',theme:'dark'}});
 const pref=core.auth.me(actor).user.preferences;
 console.log(JSON.stringify({case:'settings-preserved',theme:pref.theme,locale:pref.locale,confirmGeneration:pref.confirmGeneration}));
 for(let i=0;i<25;i++)instance.services.db.sqlite.prepare('INSERT INTO notifications(id,workspace_id,user_id,event_key,title,message,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),wid,actor.userId,`review:${i}`,`Test notice ${i}`,'Fixture-only message',new Date(Date.now()+i).toISOString());
 const first=core.business.notifications(actor,wid,{}),second=core.business.notifications(actor,wid,{page:2});
 console.log(JSON.stringify({case:'notifications-pagination',total:first.total,firstPageCount:first.items.length,pageSize:first.pageSize,secondPageCount:second.items.length,otherSpaceTotal:core.business.notifications(actor,teams[0]!.id,{}).total}));
 const ticket=core.business.createTicket(actor,wid,{subject:'Local feedback fixture',category:'feedback',message:'No external contact was attempted'});
 core.business.reply(actor,wid,ticket.id,{message:'Local supplementary text'});
 console.log(JSON.stringify({case:'feedback-local-ticket',status:core.business.ticket(actor,wid,ticket.id).status,replies:core.business.ticket(actor,wid,ticket.id).replies.length,externalProviderConfigured:false}));
}finally{await instance.app.close();await rm(folder,{recursive:true,force:true});}
