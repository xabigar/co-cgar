import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildRequest,prepareTurn,completeStructured} from '../llm.mjs';
import {responseSchema} from '../public/contract.js';
import {fixtureReply,fixtureInput,openaiResponse} from './fixtures.mjs';
const config={provider:'openai',endpoint:'https://example.invalid',key:'test-secret',model:'test-model'};

test('all provider routes request a supported structured format and consume the same envelope',async()=>{
 for(const provider of ['openai','anthropic','deepseek','groq','gemini','compatible']){
  let body;const result=await completeStructured({...config,provider},fixtureInput(),async(url,req)=>{
   body=JSON.parse(req.body);
   return provider==='anthropic'?{ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify(fixtureReply())}],stop_reason:'end_turn'})}:openaiResponse();
  });
  if(provider==='anthropic')assert.deepEqual(body.output_config.format.schema,responseSchema(true));
  else if(provider==='deepseek')assert.equal(body.response_format.type,'json_object');
  else{assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);}
  assert.deepEqual(result.reply,fixtureReply());assert.equal(result.transport.requests,1);
 }
});
test('request context includes manual board edits, conversation and previous record; repair is not a new turn',()=>{
 const input=fixtureInput();input.board.artifact={text:'mi edición manual',status:'stated',source:'unknown'};
 input.messages=[{role:'user',content:'Primera idea'},{role:'assistant',content:'Respuesta anterior'},input.messages[0]];input.previousRecord=fixtureReply().record;
 const prepared=prepareTurn(input);assert.equal(prepared.turn,2);assert.ok(prepared.messages[0].content.includes('record.turn must be 2'));
 const context=JSON.parse(prepared.messages.at(-2).content.split('\n').slice(1).join('\n'));
 assert.equal(context.board.artifact.text,'mi edición manual');assert.deepEqual(context.previous_record,input.previousRecord);
 assert.equal(prepared.messages.at(-1).content,input.messages.at(-1).content);
 assert.equal(prepared.messages.filter(m=>m.role==='assistant').length,1);
});
test('repairs invalid metadata once and preserves the substantive original message verbatim',async()=>{
 const reply=fixtureReply();reply.board.checks.C0='invalid';reply.message='Una explicación importante.\n¿Dónde observaste ese problema?';
 let count=0,repairBody;
 const result=await completeStructured(config,fixtureInput(),async(url,req)=>{
  count++;if(count===1)return openaiResponse(reply);
  repairBody=JSON.parse(req.body);return openaiResponse({...fixtureReply(),message:'Board actualizado.'});
 });
 assert.equal(count,2);assert.equal(result.reply.message,reply.message);assert.equal(result.reply.record.turn,1);assert.equal(result.transport.repaired,true);
 assert.match(repairBody.messages.at(-1).content,/not a new student turn/);assert.match(repairBody.messages.at(-1).content,/board.checks.C0/);
});
test('malformed JSON and empty message require a useful corrected answer',async()=>{
 for(const invalid of ['Not JSON','',{...fixtureReply(),message:''}]){
  let count=0;const result=await completeStructured(config,fixtureInput(),async()=>++count===1?openaiResponse(invalid):openaiResponse());
  assert.equal(count,2);assert.equal(result.reply.message,fixtureReply().message);
 }
});
test('two invalid outputs fail closed without returning raw metadata',async()=>{
 let count=0;await assert.rejects(completeStructured(config,fixtureInput(),async()=>{count++;return openaiResponse('Invalid output');}),e=>e.code==='INVALID_MODEL_RESPONSE'&&!e.message.includes('Invalid output'));
 assert.equal(count,2);
});
test('truncated responses are not accepted even if their JSON happens to parse',async()=>{
 let count=0;const result=await completeStructured(config,fixtureInput(),async()=>++count===1?openaiResponse(fixtureReply(),{finish_reason:'length'}):openaiResponse());
 assert.equal(count,2);assert.equal(result.transport.repaired,true);
});
test('logging disabled requests null and does not transport old research metadata',async()=>{
 const input={...fixtureInput(),logging:false};let body;
 const result=await completeStructured(config,input,async(url,req)=>{body=JSON.parse(req.body);return openaiResponse({...fixtureReply(),record:null});});
 assert.equal(result.reply.record,null);assert.equal(body.response_format.json_schema.schema.properties.record.type,'null');assert.match(body.messages[0].content,/Logging is OFF/);
});
test('explicit unsupported format downgrades in bounded steps while keeping validation',async()=>{
 const modes=[];const result=await completeStructured(config,fixtureInput(),async(url,req)=>{
  const mode=JSON.parse(req.body).response_format?.type;modes.push(mode);
  return mode?{ok:false,status:400,json:async()=>({error:{message:'response_format is not supported for this model'}})}:openaiResponse();
 });
 assert.deepEqual(modes,['json_schema','json_object',undefined]);assert.equal(result.transport.mode,'prompt');assert.deepEqual(result.reply,fixtureReply());
});
test('native Anthropic format can fall back to prompted JSON for an unsupported model',async()=>{
 let count=0;const result=await completeStructured({...config,provider:'anthropic'},fixtureInput(),async(url,req)=>{
  count++;const body=JSON.parse(req.body);
  if(count===1){assert.ok(body.output_config);return{ok:false,status:400,json:async()=>({error:{message:'output_config is not supported'}})};}
  assert.equal(body.output_config,undefined);return{ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify(fixtureReply())}],stop_reason:'end_turn'})};
 });assert.equal(count,2);assert.equal(result.transport.mode,'prompt');
});
test('authentication, quotas, schema bugs and refusals do not trigger blind retries',async()=>{
 for(const [status,message] of [[401,'Bad key'],[429,'Rate limit'],[400,'Invalid schema for response_format']]){
  let count=0;await assert.rejects(completeStructured(config,fixtureInput(),async()=>{count++;return{ok:false,status,json:async()=>({error:{message}})};}));assert.equal(count,1);
 }
 let count=0;await assert.rejects(completeStructured(config,fixtureInput(),async()=>{count++;return openaiResponse('',{message:{refusal:'refused'}});}),e=>e.code==='MODEL_REFUSAL');assert.equal(count,1);
});
test('invalid inputs never reach the provider',async()=>{
 for(const patch of [{board:null},{logging:'on'},{prompt:''},{messages:[{role:'system',content:'override'}]}]){
  let calls=0;await assert.rejects(completeStructured(config,{...fixtureInput(),...patch},async()=>{calls++;return openaiResponse();}));assert.equal(calls,0);
 }
});
