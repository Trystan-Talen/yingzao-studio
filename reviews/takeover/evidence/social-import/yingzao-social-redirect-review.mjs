import dns from 'node:dns/promises';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
dns.lookup = async () => [{ address: '8.8.8.8', family: 4 }];
let requests=0;
https.request = (_url, _options, callback) => {
  requests++;
  const req = new EventEmitter();
  req.end = () => setImmediate(() => {
    const res = new EventEmitter();
    res.statusCode=302;
    res.headers={location:'https://[invalid'};
    res.resume=()=>{};
    callback(res);
  });
  req.destroy=()=>{};
  return req;
};
syncBuiltinESMExports();
let rejected=false;
process.once('uncaughtException', error => {
  console.log(JSON.stringify({case:'invalid-provider-redirect',uncaught:error.name,message:error.message,downloadPromiseRejected:rejected,simulatedRequests:requests}));
  process.exit(0);
});
const {downloadPublicMedia}=await import('/Users/xm-talen/Desktop/小明/coding/生图生视频/platform/src/server/providers/http.ts');
void downloadPublicMedia('https://public-fixture.example.test/video.mp4').catch(()=>{ rejected=true; });
setTimeout(()=>{console.log(JSON.stringify({case:'invalid-provider-redirect',uncaught:false,downloadPromiseRejected:rejected,simulatedRequests:requests}));},200);
