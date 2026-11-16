import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {connection,completeStructured} from './llm.mjs';
const root=fileURLToPath(new URL('./public/',import.meta.url));
const mime={html:'text/html',js:'text/javascript',css:'text/css',md:'text/plain',png:'image/png'};
const digest=s=>createHash('sha256').update(s).digest();
export function serverDefault(env){
 if(!env.SERVER_DEFAULT_API_KEY&&!env.SERVER_DEFAULT_PASSWORD)return null;
 if(!env.SERVER_DEFAULT_PASSWORD||env.SERVER_DEFAULT_PASSWORD.length<12)throw Error('SERVER_DEFAULT_PASSWORD debe tener al menos 12 caracteres.');
 return {...connection({provider:env.SERVER_DEFAULT_PROVIDER||'openai',key:env.SERVER_DEFAULT_API_KEY,model:env.SERVER_DEFAULT_MODEL,endpoint:env.SERVER_DEFAULT_ENDPOINT}),password:env.SERVER_DEFAULT_PASSWORD};
}
export function createApp({defaults=null,fetcher=fetch,now=Date.now}={}){
 const sessions=new Map(),attempts=new Map();const ttl=86400000;
 const tokenFor=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('cocgar_access='))?.slice(14);
 const authorized=req=>{const token=tokenFor(req),expires=sessions.get(token);if(expires>now())return true;sessions.delete(token);return false;};
 const cookie=(token,seconds)=>`cocgar_access=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${seconds}`;
 return http.createServer(async(req,res)=>{
  const json=(status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));};
  try{
   // Reject DNS rebinding and cross-origin requests before reading any credentials.
   const host=req.headers.host||'';
   if(!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))return json(403,{error:'Host no permitido.'});
   if(req.headers.origin&&req.headers.origin!==`http://${host}`)return json(403,{error:'Origen no permitido.'});
   if(req.method==='GET'&&req.url==='/api/config')return json(200,{serverDefault:{available:!!defaults,provider:defaults?.provider||'',model:defaults?.model||'',unlocked:authorized(req)}});
   if(req.method==='POST'&&req.url.startsWith('/api/')){
    if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'Se requiere application/json.'});
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2_000_000)return json(413,{error:'La conversación supera el límite de 2 MB.'});}
    const body=JSON.parse(raw);
    if(req.url==='/api/server-default/unlock'){
     if(!defaults)return json(503,{error:'Server default no está configurado. Consulta .env.example.'});
     const address=req.socket.remoteAddress,attempt=attempts.get(address)||{count:0,until:now()+900000};
     if(attempt.until<=now()){attempt.count=0;attempt.until=now()+900000;}
     if(attempt.count>=10)return json(429,{error:'Demasiados intentos. Espera 15 minutos.'});
     if(typeof body.password!=='string'||!timingSafeEqual(digest(body.password),digest(defaults.password))){attempt.count++;attempts.set(address,attempt);return json(401,{error:'Contraseña incorrecta.'});}
     attempts.delete(address);
     for(const [token,expires]of sessions)if(expires<=now())sessions.delete(token);
     sessions.delete(tokenFor(req));const token=randomBytes(32).toString('hex');sessions.set(token,now()+ttl);
     return json(200,{unlocked:true,expiresAt:new Date(now()+ttl).toISOString()},{'Set-Cookie':cookie(token,ttl/1000)});
    }
    if(req.url==='/api/server-default/lock'){sessions.delete(tokenFor(req));return json(200,{unlocked:false},{'Set-Cookie':cookie('',0)});}
    if(req.url==='/api/chat'){
     let config;
     if(body.provider==='server-default'){
      if(!defaults)return json(503,{error:'Server default no está configurado.'});
      if(!authorized(req))return json(401,{error:'Server default está bloqueado o ha caducado. Desbloquéalo desde Configuración.'});
      config=defaults; // Never accept a browser-supplied destination, key or model for server credentials.
     }else config=connection(body);
     return json(200,await completeStructured(config,body,fetcher));
    }
    return json(404,{error:'Ruta no encontrada.'});
   }
   if(req.method!=='GET'){res.writeHead(405);return res.end();}
   const pathname=new URL(req.url,'http://localhost').pathname,name=pathname==='/'?'index.html':pathname.slice(1);
   if(!['index.html','app.js','core.js','contract.js','providers.js','onekin-logo.png','style.css','system-prompt.md'].includes(name)){res.writeHead(404);return res.end();}
   const data=await readFile(root+name);res.writeHead(200,{'Content-Type':`${mime[name.split('.').pop()]||'text/plain'}; charset=utf-8`,'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(data);
  }catch(err){json(err.status||400,{error:err.name==='TimeoutError'?'El proveedor ha tardado demasiado. Inténtalo de nuevo.':err.message==='fetch failed'?'No se pudo conectar con el proveedor.':err.message});}
 });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 try{process.loadEnvFile?.();}catch(err){if(err.code!=='ENOENT')throw err;}
 const defaults=serverDefault(process.env),port=Number(process.env.PORT||3000);
 createApp({defaults}).listen(port,'127.0.0.1',()=>console.log(`co-CGAR listo en http://localhost:${port}\nServer default: ${defaults?defaults.provider+' / '+defaults.model+' (protegido por contraseña)':'sin configurar; usa una clave propia o configura .env'}`));
}
