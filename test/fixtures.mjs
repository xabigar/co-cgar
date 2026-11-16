import {emptyBoard} from '../public/core.js';
export const fixtureReply=(turn=1)=>({
 message:'Quieres diseñar una herramienta para revisión de código. ¿Qué existirá al terminar tu proyecto que todavía no existe?',
 board:emptyBoard(),
 record:{turn,phase:1,move:'elicit',check_run:'none',same_check_failures:0,alternatives_offered:false,declined_to_write:false},
});
export const fixtureInput=()=>({prompt:'You are a Socratic coach. Answer in the student language.',board:emptyBoard(),logging:true,messages:[{role:'user',content:'Quiero diseñar una herramienta para revisión de código.'}]});
export const openaiResponse=(reply=fixtureReply(),extra={})=>({ok:true,json:async()=>({choices:[{message:{content:typeof reply==='string'?reply:JSON.stringify(reply)},finish_reason:'stop',...extra}]})});
