import {validateRecord,recordSchema} from './contract.js';
import {providers} from './providers.js';
import {emptyBoard,reviseBoard,acceptReply} from './core.js';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storageKey='co-cgar-v1';let saved;try{saved=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{}
let sessions=Array.isArray(saved?.sessions)?saved.sessions:[],active=saved?.active,key='',busy=false;
let serverInfo={available:false,unlocked:false},configReady=false;
let config={provider:'compatible',endpoint:'https://api.openai.com/v1/chat/completions',model:'',logging:true,prompt:'',...saved?.config};
const current=()=>sessions.find(s=>s.id===active);
function persist(){try{localStorage.setItem(storageKey,JSON.stringify({sessions,active,config}));}catch{$('#notice').textContent='No se pudo guardar en el navegador. Exporta la sesión para conservarla.';}}
function newSession(){if(busy)return;const s={id:crypto.randomUUID(),title:'Nueva investigación',messages:[],board:emptyBoard(),events:[],created:new Date().toISOString()};sessions.unshift(s);active=s.id;persist();render();}
function render(){
 const s=current();$('#title').textContent=s.messages.length?s.title:'Una idea. Una buena pregunta.';
 $('#sessions').innerHTML=sessions.map(x=>`<button class="session ${x.id===active?'selected':''}" data-id="${x.id}" ${busy?'disabled':''}><span>◌</span> ${esc(x.title)}</button>`).join('');
 $('#model-label').textContent=config.provider==='server-default'?`Server default · ${serverInfo.model||'sin configurar'}${serverInfo.unlocked?'':' · bloqueado'}`:`${providers[config.provider]?.label||''} · ${config.model||'sin configurar'}`;
 $('#messages').innerHTML=s.messages.length?s.messages.map(m=>`<article class="message ${m.role}"><div class="message-meta">${m.role==='user'?'TÚ':'◈ CO-CGAR'} <span>${new Date(m.at).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'})}</span></div><div class="message-body">${esc(m.content)}</div></article>`).join(''):`<div class="welcome"><div class="welcome-symbol">✳</div><p class="eyebrow">EL PRINCIPIO DE TU INVESTIGACIÓN</p><h2>Las buenas preguntas<br>empiezan con una idea.</h2><p>Comparte lo que tienes en mente, aunque todavía sea impreciso. Juntos iremos explorando qué diseñar, para quién y por qué.</p><div class="intro-note"><span>01</span><p>Describe tu idea como se la contarías a un colega. No necesitas encajarla en ningún template todavía.</p></div></div>`;
 const b=s.board,names={artifact:'Artefacto',context:'Contexto del problema',requirements:'Requisitos',goals:'Objetivos'},labels={missing:'Por definir',vague:'Por concretar',stated:'Enunciado',checked:'Comprobado',disputed:'En discusión'};
 $('#board-content').innerHTML=Object.entries(names).map(([k,label],i)=>{
 const list=Array.isArray(b[k])?b[k]:[b[k]];
 return `<article class="board-card"><div class="card-title"><span class="number">0${i+1}</span><h3>${label}</h3></div>${list.length?list.map(e=>`<div class="element"><span class="badge ${esc(e.status)}">${labels[e.status]||esc(e.status)}</span><p class="${e.text?'':'placeholder'}">${esc(e.id?e.id+' · ':'')}${esc(e.text||({artifact:'¿Qué vas a diseñar o rediseñar?',context:'¿Dónde y con quién interactuará?'}[k]||'Todavía por definir'))}</p>${e.text?`<small>${esc(e.source||'')} ${e.stakeholder?'· '+esc(e.stakeholder):''}${e.serves?'Sirve a: '+esc(e.serves.join(', ')||'sin vincular'):''}</small>`:''}</div>`).join(''):`<p class="placeholder">${k==='requirements'?'¿Qué propiedades debe satisfacer?':'¿A quién ayudará y qué cambiará?'}</p>`}</article>`;
 }).join('')+`<div class="checks"><h3>Comprobaciones de coherencia</h3><div>${Object.entries(b.checks).map(([k,v])=>`<span title="${{C0:'Problema de diseño',C1:'Requisitos y objetivos',C2:'Interacción con el contexto',C3:'Contexto dado'}[k]}" class="${v}">${v==='pass'?'✓':v==='fail'?'×':'○'} ${k}</span>`).join('')}</div></div>${b.disputed?`<p><b>En discusión:</b> ${esc(b.disputed)}</p>`:''}${b.parked?`<p><b>Aparcado:</b> ${esc(b.parked)}</p>`:''}`;
 $('#next').textContent=b.next||'Comparte tu idea inicial en el chat.';
 $('#log-count').textContent=s.events.length;
 $('#logs-view').innerHTML=`<p class="eyebrow">TRAZABILIDAD DE LA SESIÓN</p><h2>Registro de investigación</h2><p class="muted">${config.logging?'Logging activado':'Logging desactivado'}. Los cambios manuales se conservan como revisiones del BOARD.</p>`+(s.events.length?s.events.map(e=>`<details class="log"><summary>${['state','record'].includes(e.type)?'Registro · Turno '+e.data.turn:e.type==='revision'?'Edición del alumno':'Diagnóstico del turno'} <small>${new Date(e.at).toLocaleTimeString('es')}</small></summary><pre>${esc(JSON.stringify(e.type==='record'?{record:e.data,board:e.board,message:e.message}:e.type==='state'?{record:e.data,board:e.board}:e.data,null,2))}</pre></details>`).join(''):'<div class="empty">Los registros aparecerán después de cada respuesta del modelo.</div>');
 $('#send').disabled=busy;$('#send').textContent=busy?'Esperando…':'Enviar ↑';$('#new').disabled=busy;$('#edit-board').disabled=busy;$('#settings').disabled=busy;$('#prompt-settings').disabled=busy;
 $('#messages').scrollTop=$('#messages').scrollHeight;
}
$('#new').onclick=newSession;
$('#sessions').onclick=e=>{const b=e.target.closest('[data-id]');if(b&&!busy){active=b.dataset.id;persist();render();}};
async function refreshServer(){const r=await fetch('/api/config');if(!r.ok)throw Error('No se pudo consultar la configuración del servidor.');serverInfo=(await r.json()).serverDefault;}
function connectionFields(){
 const f=$('#config-form'),provider=f.elements.provider.value,isServer=provider==='server-default';
 $('#personal-connection').hidden=isServer;$('#server-connection').hidden=!isServer;
 for(const k of ['endpoint','model','key']){f.elements[k].disabled=isServer;f.elements[k].required=!isServer;}
 f.elements.endpoint.readOnly=provider!=='compatible';
 $('#server-status').textContent=!serverInfo.available?'No hay una conexión por defecto. Completa .env y reinicia npm start.':`${providers[serverInfo.provider]?.label} · ${serverInfo.model} · ${serverInfo.unlocked?'Desbloqueado':'Bloqueado'}`;
 $('#unlock-label').hidden=serverInfo.unlocked||!serverInfo.available;$('#unlock-server').hidden=serverInfo.unlocked||!serverInfo.available;$('#lock-server').hidden=!serverInfo.unlocked;
}
async function openSettings(){
 const f=$('#config-form');$('#config-error').textContent='';for(const k of ['provider','endpoint','model'])f.elements[k].value=config[k];f.elements.key.value=key;f.elements.serverPassword.value='';f.elements.logging.checked=config.logging;
 connectionFields();$('#config').showModal();try{await refreshServer();connectionFields();}catch(err){$('#config-error').textContent=err.message;}
}
$('#settings').onclick=openSettings;
$('#config-form').elements.provider.onchange=()=>{const f=$('#config-form'),provider=f.elements.provider.value;f.elements.key.value='';f.elements.model.value=provider===config.provider?config.model:'';f.elements.endpoint.value=providers[provider]?.endpoint||(provider===config.provider?config.endpoint:'');connectionFields();};
$('#unlock-server').onclick=async()=>{
 const f=$('#config-form'),button=$('#unlock-server');button.disabled=true;$('#config-error').textContent='';
 try{const r=await fetch('/api/server-default/unlock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:f.elements.serverPassword.value})});const data=await r.json();if(!r.ok)throw Error(data.error);f.elements.serverPassword.value='';await refreshServer();connectionFields();render();}
 catch(err){$('#config-error').textContent=err.message;}finally{button.disabled=false;}
};
$('#lock-server').onclick=async()=>{try{const r=await fetch('/api/server-default/lock',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error('No se pudo bloquear.');await refreshServer();connectionFields();render();}catch(err){$('#config-error').textContent=err.message;}};
$('#config-form').onsubmit=async e=>{
 e.preventDefault();const f=e.target,provider=f.elements.provider.value;$('#config-error').textContent='';
 if(provider==='server-default'){try{await refreshServer();}catch(err){$('#config-error').textContent=err.message;return;}if(!serverInfo.unlocked){$('#config-error').textContent='Desbloquea Server default antes de guardar.';connectionFields();return;}}
 config={provider,endpoint:provider==='server-default'?'':f.elements.endpoint.value.trim(),model:provider==='server-default'?serverInfo.model:f.elements.model.value.trim(),prompt:config.prompt,logging:f.elements.logging.checked};key=provider==='server-default'?'':f.elements.key.value.trim();f.elements.key.value='';f.elements.serverPassword.value='';persist();$('#config').close();render();
};
let defaultPrompt='';
async function getDefaultPrompt(){
 if(!defaultPrompt){const r=await fetch('/system-prompt.md');if(!r.ok)throw Error('No se pudo cargar el prompt predeterminado. Inténtalo de nuevo.');const text=await r.text();if(!text.trim())throw Error('El prompt predeterminado está vacío.');defaultPrompt=text;}
 return defaultPrompt;
}
function lockPrompt(){
 $('#prompt-text').readOnly=true;$('#save-prompt').disabled=true;$('#unlock-prompt').disabled=false;
 $('#prompt-status').textContent=(defaultPrompt&&config.prompt===defaultPrompt?'Predeterminado':'Personalizado')+' · Edición bloqueada';
}
function storePrompt(text){
 const next={...config,prompt:text};
 // Persist first so a storage failure cannot silently change the active prompt.
 localStorage.setItem(storageKey,JSON.stringify({sessions,active,config:next}));
 config=next;configReady=!!text.trim();$('#prompt-text').value=text;lockPrompt();
}
$('#prompt-settings').onclick=async()=>{
 $('#prompt-text').value=config.prompt;$('#prompt-feedback').textContent='';lockPrompt();$('#prompt-config').showModal();
 try{await getDefaultPrompt();if($('#prompt-text').readOnly)lockPrompt();}catch(err){$('#prompt-feedback').textContent=err.message;}
};
$('#unlock-prompt').onclick=()=>{
 $('#prompt-text').readOnly=false;$('#save-prompt').disabled=false;$('#unlock-prompt').disabled=true;$('#prompt-status').textContent='Edición desbloqueada · Pulsa Guardar cambios para aplicar';$('#prompt-feedback').textContent='';$('#prompt-text').focus();
};
$('#prompt-form').onsubmit=e=>{
 e.preventDefault();if($('#prompt-text').readOnly)return;
 const text=$('#prompt-text').value;if(!text.trim()){$('#prompt-feedback').textContent='El system prompt no puede estar vacío.';return;}
 try{storePrompt(text);$('#prompt-feedback').textContent='Cambios guardados en este navegador. Se usarán en la siguiente interacción.';}catch{$('#prompt-feedback').textContent='No se pudo guardar en localStorage. Conserva una copia del texto y vuelve a intentarlo.';}
};
$('#reset-prompt').onclick=async()=>{
 const button=$('#reset-prompt');button.disabled=true;
 try{storePrompt(await getDefaultPrompt());$('#prompt-feedback').textContent='Prompt predeterminado restablecido y guardado en este navegador.';}catch(err){$('#prompt-feedback').textContent='No se pudo restablecer: '+err.message;}finally{button.disabled=false;}
};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$('#'+b.dataset.close).close();
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{for(const t of document.querySelectorAll('[data-tab]')){t.classList.toggle('active',t===b);$('#'+t.dataset.tab+'-view').hidden=t!==b;}};
$('#input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#composer').requestSubmit();}};
$('#composer').onsubmit=async e=>{
 e.preventDefault();if(busy)return;const text=$('#input').value.trim();if(!text)return;
 if(!configReady){$('#notice').textContent='Espera a que termine de cargar la configuración.';return;}
 if(config.provider==='server-default'){try{await refreshServer();}catch(err){$('#notice').textContent=err.message;return;}if(!serverInfo.unlocked){openSettings();return;}}else if(!key||!config.model){openSettings();return;}
 const s=current(),at=new Date().toISOString(),snapshot=structuredClone(s.board),turn=s.messages.filter(m=>m.role==='assistant').length+1,logging=config.logging;
 const outgoing=[...s.messages.map(m=>({role:m.role,content:m.content})),{role:'user',content:text}];
 let previousRecord=null;
 if(logging){for(const event of [...s.events].reverse()){
  if(!['record','state'].includes(event.type))continue;
  const candidate=Object.fromEntries(Object.keys(recordSchema.properties).map(k=>[k,event.data[k]]));
  try{validateRecord(candidate);if(candidate.turn<turn){previousRecord=candidate;break;}}catch{}
 }}
 const payload={prompt:config.prompt,board:snapshot,messages:outgoing,logging,previousRecord};
 s.messages.push({role:'user',content:text,at});if(s.messages.length===1)s.title=text.slice(0,48);$('#input').value='';busy=true;$('#notice').textContent='Leemos tu idea y revisamos el siguiente paso…';persist();render();
 try{
 const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(config.provider==='server-default'?{...payload,provider:'server-default'}:{...payload,provider:config.provider,endpoint:config.endpoint,model:config.model,key})});const data=await response.json();if(!response.ok)throw Error(data.error||'No se pudo conectar.');
 const timestamp=new Date().toISOString();
 const updated=acceptReply(s,data.reply,{logging,turn,at:timestamp});
 Object.assign(s,updated);
 $('#notice').textContent='';
 }catch(err){s.messages.pop();$('#input').value=text;$('#notice').textContent='No se ha completado el envío: '+err.message+' Puedes volver a intentarlo.';}
 finally{busy=false;persist();render();$('#input').focus();}
};
$('#edit-board').onclick=()=>{
 const b=current().board;$('#edit-error').textContent='';
 $('#board-fields').innerHTML=['artifact','context'].map(k=>`<fieldset><legend>${k==='artifact'?'Artefacto':'Contexto'}</legend><label>Tus palabras<textarea name="${k}-text" rows="2">${esc(b[k].text)}</textarea></label><label>Fuente<input name="${k}-source" value="${esc(b[k].source)}"></label></fieldset>`).join('')+['requirements','goals'].map(k=>`<label>${k==='requirements'?'Requisitos':'Objetivos'} · JSON<textarea name="${k}" rows="6" spellcheck="false">${esc(JSON.stringify(b[k],null,2))}</textarea></label><small>${k==='requirements'?'Ejemplo: [{"id":"R1","text":"…","status":"stated","serves":["G1"]}]':'Ejemplo: [{"id":"G1","text":"…","stakeholder":"…","status":"stated","source":"unknown"}]'}</small>`).join('')+['disputed','parked','next'].map(k=>`<label>${{disputed:'En discusión · elemento y motivo',parked:'Aparcado',next:'Próximo paso'}[k]}<textarea rows="2" name="${k}">${esc(b[k])}</textarea></label>`).join('');
 $('#editor').showModal();
};
$('#board-form').onsubmit=e=>{
 e.preventDefault();try{const s=current(),before=structuredClone(s.board),b=structuredClone(before),f=e.target;
 for(const k of ['artifact','context']){b[k].text=f.elements[k+'-text'].value;b[k].source=f.elements[k+'-source'].value;}
 for(const k of ['requirements','goals'])b[k]=JSON.parse(f.elements[k].value);
 for(const k of ['disputed','parked','next'])b[k]=f.elements[k].value;
 s.board=reviseBoard(before,b);s.events.push({type:'revision',at:new Date().toISOString(),data:{before,after:structuredClone(s.board)}});persist();render();$('#editor').close();
 }catch(err){$('#edit-error').textContent=err.message;}
};
$('#export').onclick=()=>{const blob=new Blob([JSON.stringify({version:2,exportedAt:new Date().toISOString(),session:current(),configuration:config},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='co-cgar-'+active+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
if(!current())newSession();else render();
if(!config.prompt){try{const r=await fetch('/system-prompt.md');if(!r.ok)throw Error();config.prompt=await r.text();persist();}catch{$('#notice').textContent='No se pudo cargar el system prompt. Recarga la página antes de comenzar.';}}

try{await refreshServer();if(!saved&&serverInfo.available){config.provider='server-default';config.model=serverInfo.model;persist();}configReady=!!config.prompt;render();}catch(err){$('#notice').textContent=err.message;configReady=!!config.prompt;}
