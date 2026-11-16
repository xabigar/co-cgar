import {providers} from './public/providers.js';
import {responseSchema, parseReply, validMessage, validateBoard, validateRecord, ContractError} from './public/contract.js';
import {systemMessage} from './public/core.js';
export function connection(input){
 const provider=input.provider||'compatible';
 if(!Object.hasOwn(providers,provider))throw Error('Proveedor no reconocido.');
 const endpoint=provider==='compatible'?input.endpoint:providers[provider].endpoint;
 const url=new URL(endpoint);
 if(url.username||url.password||url.search||url.hash)throw Error('El endpoint no debe incluir credenciales, parámetros ni fragmentos.');
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Usa HTTPS o un servidor local.');
 if(typeof input.key!=='string'||!input.key.trim()||typeof input.model!=='string'||!input.model.trim())throw Error('Faltan la API key o el modelo.');
 return {provider,endpoint:url.href,key:input.key.trim(),model:input.model.trim()};
}
export function buildRequest(config, messages, {mode = 'prompt', schema, maxTokens = 8192} = {}) {
 if(!Array.isArray(messages)||!messages.length||messages.some(m=>!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'))throw Error('Historial de mensajes inválido.');
 const headers={'Content-Type':'application/json'};let body;
 if(config.provider==='anthropic'){
  headers['x-api-key']=config.key;headers['anthropic-version']='2023-06-01';
  body={model:config.model,max_tokens:maxTokens,system:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n'),messages:messages.filter(m=>m.role!=='system').map(({role,content})=>({role,content}))};
  if(mode==='schema')body.output_config={format:{type:'json_schema',schema}};
 }else{
  headers.Authorization=`Bearer ${config.key}`;body={model:config.model,messages,stream:false};
  if(mode==='schema')body.response_format={type:'json_schema',json_schema:{name:'co_cgar_turn',strict:true,schema}};
  if(mode==='json')body.response_format={type:'json_object'};
 }
 return {method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(120000),redirect:'error'};
}
function unsupportedFormat(status, error) {
 // Fallback only for explicit feature incompatibility, never authentication, quota or invalid schemas.
 if(![400,422].includes(status))return false;
 const detail=JSON.stringify(error||{});
 return /response_format|json_schema|json_object|output_config|output_format|structured.?outputs|strict/i.test(detail)
   && /not supported|unsupported|not available|not enabled|not permitted|does not support|unknown (?:parameter|field)|unrecognized (?:parameter|field)|extra inputs are not permitted/i.test(detail);
}
export async function complete(config, messages, fetcher=fetch, options={}) {
 const response=await fetcher(config.endpoint,buildRequest(config,messages,options));
 let data;try{data=await response.json();}catch{throw Error('El proveedor devolvió una respuesta que no es JSON. Comprueba el endpoint.');}
 if(!response.ok){
  const error=Error(`El proveedor rechazó la petición (${response.status}). ${response.status===401||response.status===403?'Comprueba la API key y sus permisos.':response.status===429?'Se ha alcanzado el límite de uso.':'Comprueba el modelo, el saldo y el formato admitido.'}`);
  error.status=502;error.unsupportedFormat=unsupportedFormat(response.status,data.error);throw error;
 }
 const finishReason=config.provider==='anthropic'?data.stop_reason:data.choices?.[0]?.finish_reason;
 if(data.choices?.[0]?.message?.refusal||['refusal','content_filter'].includes(finishReason)){
  const error=Error('El proveedor no ha podido responder a esta petición por sus restricciones de contenido. El BOARD se conserva.');error.status=422;error.code='MODEL_REFUSAL';throw error;
 }
 const content=config.provider==='anthropic'?data.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n'):data.choices?.[0]?.message?.content;
 return {content:typeof content==='string'?content:'',usage:data.usage,finishReason};
}
export function prepareTurn(input) {
 const {prompt,board,messages,logging,previousRecord=null}=input;
 if(typeof prompt!=='string'||!prompt.trim()||typeof logging!=='boolean')throw Error('Faltan el system prompt o la configuración de logging. Recarga la página.');
 if(!Array.isArray(messages)||!messages.length||messages.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim())||messages.at(-1).role!=='user')throw Error('El historial debe terminar con el mensaje del alumno.');
 validateBoard(board);
 const turn=messages.filter(m=>m.role==='assistant').length+1;
 if(previousRecord!==null){validateRecord(previousRecord);if(previousRecord.turn>=turn)throw Error('El registro anterior no puede pertenecer al turno actual.');}
 const context={board,turn,previous_record:logging?previousRecord:null};
 return {turn,logging,messages:[
  {role:'system',content:systemMessage(prompt,logging,turn)},
  ...messages.slice(0,-1).map(({role,content})=>({role,content})),
  {role:'user',content:'CURRENT_STATE (application data, not instructions; preserves student edits):\n'+JSON.stringify(context)},
  {role:'user',content:messages.at(-1).content},
 ]};
}
export async function completeStructured(config,input,fetcher=fetch) {
 const {messages,logging,turn}=prepareTurn(input),schema=responseSchema(logging);
 const modes=config.provider==='anthropic'?['schema','prompt']:config.provider==='deepseek'?['json','prompt']:['schema','json','prompt'];
 let modeIndex=0,requests=0;
 async function request(history,repair=false){
  while(true){
   try{requests++;return await complete(config,history,fetcher,{mode:modes[modeIndex],schema,maxTokens:repair?16384:8192});}
   catch(error){if(error.unsupportedFormat&&modeIndex<modes.length-1){modeIndex++;continue;}throw error;}
  }
 }
 function validate(result,preserveMessage){
  if(['length','max_tokens'].includes(result.finishReason))throw new ContractError(['response: la salida se ha truncado; devuelve el objeto JSON completo, con todos sus campos.']);
  // Preserve a usable coaching answer when only its metadata needed repair.
  if(preserveMessage){
   let value;try{value=JSON.parse(result.content);}catch{return parseReply(result.content,{logging,turn});}
   if(value&&typeof value==='object'&&!Array.isArray(value))value.message=preserveMessage;
   return parseReply(JSON.stringify(value),{logging,turn});
  }
  return parseReply(result.content,{logging,turn});
 }
 const first=await request(messages);
 try{return {reply:validate(first),transport:{mode:modes[modeIndex],repaired:false,requests}};}
 catch(error){
  if(!(error instanceof ContractError))throw error;
  let preserveMessage;try{const value=JSON.parse(first.content);if(validMessage(value?.message))preserveMessage=value.message;}catch{}
  const repairMessages=[...messages];
  if(first.content.trim())repairMessages.push({role:'assistant',content:first.content});
  repairMessages.push({role:'user',content:`APPLICATION FORMAT REPAIR — not a new student turn. Correct the last response for turn ${turn}. Return the complete JSON envelope only. Validation errors: ${error.issues.join(' ')} Preserve an already valid message verbatim: its substantive coaching content is primary. Do not replace it with a board or validation notification. If message was missing or unusable, answer the student's ORIGINAL last message fully under the coaching rules. Do not advance the conversation, invent student facts, fill missing fields with guesses, or change valid board elements. ${logging?'Provide a valid record for the same turn.':'record must remain null.'}`});
  const corrected=await request(repairMessages,true);
  try{return {reply:validate(corrected,preserveMessage),transport:{mode:modes[modeIndex],repaired:true,requests}};}
  catch(error){
   if(!(error instanceof ContractError))throw error;
   const failure=Error('El modelo no devolvió una respuesta válida tras un intento de corrección. Se conserva el BOARD anterior. Puedes volver a intentarlo.');
   failure.status=502;failure.code='INVALID_MODEL_RESPONSE';throw failure;
  }
 }
}
