import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp,serverDefault} from '../server.mjs';
import {connection,buildRequest,complete} from '../llm.mjs';
import {providers} from '../public/providers.js';
import {fixtureInput,fixtureReply,openaiResponse} from './fixtures.mjs';
const messages=[{role:'system',content:'coach instructions'},{role:'user',content:'BOARD'},{role:'user',content:'my idea'}];
const defaults={provider:'openai',endpoint:providers.openai.endpoint,key:'test-server-secret',model:'configured-model',password:'test-password-12345'};
test('all providers use their fixed destination and appropriate authorization',()=>{
 for(const provider of Object.keys(providers)){
  const c=connection({provider,key:'test',model:'test-model',endpoint:'http://localhost:9999/chat/completions'}),r=buildRequest(c,messages),b=JSON.parse(r.body);
  assert.equal(c.endpoint,provider==='compatible'?'http://localhost:9999/chat/completions':providers[provider].endpoint);
  if(provider==='anthropic'){assert.equal(b.system,'coach instructions');assert.equal(b.messages.length,2);assert.equal(r.headers['x-api-key'],'test');assert.equal(b.max_tokens,8192);assert.equal(r.headers.Authorization,undefined);}
  else{assert.deepEqual(b.messages,messages);assert.equal(r.headers.Authorization,'Bearer test');}
 }
});
test('Anthropic response extracts text, not thinking blocks',async()=>{
 const data=await complete({...defaults,provider:'anthropic'},messages,async()=>({ok:true,json:async()=>({content:[{type:'thinking',thinking:'private'},{type:'text',text:'Reply'}]})}));assert.equal(data.content,'Reply');
});
test('provider errors never echo server credentials',async()=>{
 await assert.rejects(complete(defaults,messages,async()=>({ok:false,status:401,json:async()=>({error:{message:defaults.key}})})),e=>!e.message.includes(defaults.key));
});
test('startup requires complete defaults and a password',()=>{assert.equal(serverDefault({}),null);assert.throws(()=>serverDefault({SERVER_DEFAULT_API_KEY:'test'}));assert.throws(()=>serverDefault({SERVER_DEFAULT_API_KEY:'test',SERVER_DEFAULT_PASSWORD:'long-password'}));});
test('password unlock, no secret disclosure, fixed defaults, expiry, lock and rate limit',async t=>{
 let time=1000000;const calls=[];
 const app=createApp({defaults,now:()=>time,fetcher:async(url,request)=>{calls.push({url,request});return openaiResponse();}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.close(resolve)));
 const base=`http://127.0.0.1:${app.address().port}`;
 const post=(path,body,cookie)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 let response=await fetch(base+'/api/config');const configText=await response.text();assert.ok(!configText.includes(defaults.key));assert.ok(!configText.includes(defaults.password));
 assert.equal((await post('/api/chat',{...fixtureInput(),provider:'server-default'})).status,401);
 assert.equal((await post('/api/server-default/unlock',{password:'wrong'})).status,401);
 response=await post('/api/server-default/unlock',{password:defaults.password});assert.equal(response.status,200);const header=response.headers.get('set-cookie'),cookie=header.split(';')[0];assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Strict/);
 response=await post('/api/chat',{...fixtureInput(),provider:'server-default',model:'evil-model',endpoint:'https://attacker.invalid',key:'evil'},cookie);assert.equal(response.status,200);assert.deepEqual((await response.json()).reply,fixtureReply());assert.equal(calls[0].url,defaults.endpoint);assert.equal(JSON.parse(calls[0].request.body).model,defaults.model);assert.equal(calls[0].request.headers.Authorization,`Bearer ${defaults.key}`);
 time+=86400001;assert.equal((await post('/api/chat',{...fixtureInput(),provider:'server-default'},cookie)).status,401);
 response=await post('/api/server-default/unlock',{password:defaults.password});const fresh=response.headers.get('set-cookie').split(';')[0];assert.equal((await post('/api/server-default/lock',{},fresh)).status,200);assert.equal((await post('/api/chat',{...fixtureInput(),provider:'server-default'},fresh)).status,401);
 response=await fetch(base+'/api/config',{headers:{Origin:'http://attacker.invalid'}});assert.equal(response.status,403);
 for(let i=0;i<10;i++)assert.equal((await post('/api/server-default/unlock',{password:'wrong'})).status,401);
 assert.equal((await post('/api/server-default/unlock',{password:defaults.password})).status,429);
 time+=900001;assert.equal((await post('/api/server-default/unlock',{password:defaults.password})).status,200);
 assert.equal(calls.length,1);
});
