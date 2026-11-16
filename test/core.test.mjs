import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyBoard,reviseBoard,systemMessage,acceptReply} from '../public/core.js';
import {parseReply,validateReply,validateBoard,responseSchema} from '../public/contract.js';
import {fixtureReply} from './fixtures.mjs';

test('student revision invalidates gating checks',()=>{
 const before=emptyBoard();before.checks={C0:'pass',C1:'pass',C2:'pass',C3:'pass'};
 const next=structuredClone(before);next.artifact={text:'mi herramienta',status:'checked',source:'unknown'};
 const result=reviseBoard(before,next);assert.equal(result.artifact.status,'stated');
 assert.deepEqual(result.checks,{C0:'na',C1:'pass',C2:'na',C3:'na'});assert.equal(before.artifact.text,'');
});
test('valid JSON preserves the entire coaching message and complete state',()=>{
 const reply=fixtureReply();reply.message='Un requisito describe una propiedad del artefacto en su contexto.\nPor ejemplo, una biblioteca puede pedir que el préstamo se registre en menos de un minuto. ¿Qué propiedad necesitas en tu caso?';
 assert.deepEqual(parseReply(JSON.stringify(reply),{logging:true,turn:1}),reply);
});
test('rejects missing, malformed, fenced or partial envelopes',()=>{
 for(const raw of ['```json\n'+JSON.stringify(fixtureReply())+'\n```','Hola <!-- STATE {} -->','{"message":"Hola"}',JSON.stringify({...fixtureReply(),board:null}),'{']){
  assert.throws(()=>parseReply(raw,{logging:true,turn:1}));
 }
 for(const message of ['', '   ', JSON.stringify(fixtureReply()),'```json\n'+JSON.stringify(fixtureReply())+'\n```','Respuesta <!-- BOARD_STATE {} -->'])assert.throws(()=>validateReply({...fixtureReply(),message}));
});
test('rejects extra fields, invalid types, enum values and false turn numbers',()=>{
 const changes=[r=>r.record.turn=2,r=>r.record.phase=5,r=>r.record.same_check_failures=-1,r=>r.record.alternatives_offered='false',r=>r.record.move='unknown',r=>r.board.checks.C0='not yet',r=>r.board.artifact.status='complete',r=>r.record.elements={},r=>r.extra=true];
 for(const change of changes){const reply=fixtureReply();change(reply);assert.throws(()=>validateReply(reply,{logging:true,turn:1}));}
});
test('requirements can be unlinked, but cannot refer to absent or duplicate goals',()=>{
 const board=emptyBoard();board.requirements=[{id:'R1',text:'mis palabras',status:'stated',serves:[]}];
 validateBoard(board);board.requirements[0].serves=['G1'];assert.throws(()=>validateBoard(board));
 board.goals=[{id:'G1',text:'mi objetivo',stakeholder:'alumno',status:'stated',source:'unknown'}];validateBoard(board);
 board.goals.push({...board.goals[0]});assert.throws(()=>validateBoard(board));board.goals.pop();board.requirements[0].serves=['G1','G1'];assert.throws(()=>validateBoard(board));
});
test('logging off requires null and still validates the message and board',()=>{
 const reply={...fixtureReply(),record:null};assert.deepEqual(validateReply(reply,{logging:false}),reply);
 assert.throws(()=>validateReply(fixtureReply(),{logging:false}));assert.throws(()=>validateReply(reply,{logging:true}));
 assert.equal(responseSchema(false).properties.record.type,'null');
});
test('contract prioritizes the message while overriding old packaging without changing custom coaching instructions',()=>{
 const prompt='My custom coaching rule.\nlogging: on\nEmit <!-- STATE {} -->';
 const result=systemMessage(prompt,false,3);
 assert.ok(result.includes('My custom coaching rule.'));assert.match(result,/logging: off/);
 assert.match(result,/PRIMARY deliverable is message/);assert.match(result,/record must be null/);
 assert.match(result,/replaces ONLY older output packaging/);assert.match(systemMessage(prompt,true,3),/record.turn must be 3/);
 assert.equal(prompt.includes('logging: on'),true);
});
test('accepting a valid turn saves message, board and independent research snapshot',()=>{
 const session={messages:[{role:'user',content:'Idea'}],board:emptyBoard(),events:[]};const reply=fixtureReply();
 reply.board.artifact={text:'mi herramienta',status:'stated',source:'unknown'};
 const updated=acceptReply(session,reply,{logging:true,turn:1,at:'timestamp'});
 assert.equal(updated.messages.at(-1).content,reply.message);assert.equal(updated.events[0].type,'record');
 assert.deepEqual(updated.events[0].board,reply.board);assert.deepEqual(updated.events[0].data,reply.record);
 assert.equal(updated.events[0].message,reply.message);
 updated.board.artifact.text='edición posterior';assert.equal(updated.events[0].board.artifact.text,'mi herramienta');assert.equal(session.messages.length,1);
 const restored=JSON.parse(JSON.stringify(updated));assert.equal(restored.events[0].board.artifact.text,'mi herramienta');
});
test('invalid response cannot partially update the session and logging off creates no record',()=>{
 const session={messages:[],board:emptyBoard(),events:[]},original=structuredClone(session);
 assert.throws(()=>acceptReply(session,{...fixtureReply(),record:null},{logging:true,turn:1}));assert.deepEqual(session,original);
 const updated=acceptReply(session,{...fixtureReply(),record:null},{logging:false,turn:1,at:'timestamp'});
 assert.equal(updated.events.length,0);assert.equal(updated.messages.length,1);
});
