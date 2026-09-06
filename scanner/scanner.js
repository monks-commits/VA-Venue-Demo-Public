const LS_SECRET_KEY="venue_demo_scanner_secret_v1";
const LS_GATE_KEY_PREFIX="venue_demo_scanner_gate_v1:";
let cfg=null,qr=null,lastQr="",lastQrAt=0,scanLocked=false,audioCtx=null;
let venueId="",venueInfo=null;
const duplicateCooldownMs=4500,$=id=>document.getElementById(id);

function ensureAudio(){try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==="suspended")audioCtx.resume().catch(()=>{})}catch{}}
function beep({freq=880,duration=.1,type="sine",gain=.12}={}){try{ensureAudio();if(!audioCtx)return;const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type;o.frequency.value=freq;g.gain.value=gain;o.connect(g);g.connect(audioCtx.destination);o.start();setTimeout(()=>{try{o.stop()}catch{}},duration*1000)}catch{}}
function soundOk(){beep({freq:1046,duration:.11,gain:.18});setTimeout(()=>beep({freq:1318,duration:.10,gain:.15}),90)}
function soundBad(){beep({freq:220,duration:.16,type:"square",gain:.15});setTimeout(()=>beep({freq:196,duration:.18,type:"square",gain:.14}),150)}
function vibrateBad(){try{navigator.vibrate&&navigator.vibrate([90,50,140])}catch{}}
function setStatus(kind,title,details,qrText){const b=$("statusBox");b.classList.remove("ok","warn","bad");if(kind)b.classList.add(kind);$("stText").textContent=title||"";$("stDetails").textContent=details||"—";$("stQr").textContent=qrText||"—"}
function params(){return new URLSearchParams(location.search)}
function expectedSeance(){const p=params();return(p.get("seance")||p.get("seance_id")||cfg?.expectedSeanceId||"").trim()}
function gateStorageKey(){return LS_GATE_KEY_PREFIX+(venueId||"unknown")}
function fmt(v){if(!v)return"";const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString("uk-UA")}

async function loadVenue(){
  const endpoint=String(cfg?.endpoint||"").trim();
  venueId=String(params().get("venue")||params().get("venue_id")||"").trim();

  if(!venueId)throw new Error("venue_required");
  if(!endpoint)throw new Error("Endpoint venue-demo-scan-ticket не задано.");

  const u=new URL(endpoint);
  u.searchParams.set("venue_id",venueId);

  const r=await fetch(u.toString(),{cache:"no-store"});
  const data=await r.json().catch(()=>({}));

  if(!r.ok||!data?.ok)throw new Error(data?.error||`venue_http_${r.status}`);

  venueInfo=data.venue||{id:venueId,name:venueId};
  $("theatreName").textContent=`${venueInfo.name||venueId} • Сканер квитків`;
  $("venueLine").textContent=`Майданчик: ${venueInfo.name||venueId}`;
  document.title=`Сканер квитків — ${venueInfo.name||venueId}`;
}

async function loadConfig(){
  const r=await fetch("./config.json",{cache:"no-store"});
  if(!r.ok)throw new Error("Не вдалося завантажити scanner/config.json");
  cfg=await r.json();

  await loadVenue();

  const s=localStorage.getItem(LS_SECRET_KEY)||"";
  if(s)$("secret").value=s;

  const g=localStorage.getItem(gateStorageKey())||"";
  if(g)$("gate").value=g;

  const sid=expectedSeance();
  $("seanceLine").textContent=sid?`Сеанс: ${sid}`:"Сеанс: без додаткового обмеження";
  setStatus("ok","Готово","Запустіть камеру і скануйте QR квитка цього майданчика.","");
}

async function sendToServer(qr_payload){
  const endpoint=String(cfg?.endpoint||"").trim(),
        gate=($("gate").value||"gate-1").trim()||"gate-1",
        secret=($("secret").value||"").trim(),
        sid=expectedSeance();

  if(!venueId){setStatus("bad","Помилка","Майданчик не задано.",qr_payload);soundBad();return}
  if(!endpoint){setStatus("bad","Помилка","Endpoint venue-demo-scan-ticket не задано.",qr_payload);soundBad();return}

  if(cfg.requireSecret&&!secret){
    setStatus("warn","Потрібен secret","Вставте VENUE_DEMO_SCANNER_SECRET і повторіть сканування.",qr_payload);
    soundBad();return;
  }

  if(secret)localStorage.setItem(LS_SECRET_KEY,secret);
  localStorage.setItem(gateStorageKey(),gate);

  const body={venue_id:venueId,qr_payload,checked_in_by:gate};
  if(sid)body.expected_seance_id=sid;

  const r=await fetch(endpoint,{
    method:"POST",
    headers:{"Content-Type":"application/json","x-scanner-secret":secret},
    body:JSON.stringify(body)
  });

  const data=await r.json().catch(()=>({})),t=data?.ticket||{},at=data?.checked_in_at||t?.checked_in_at||"";
  const parts=[
    t?.seat_label?`Місце: ${t.seat_label}`:"",
    t?.ticket_number?`Квиток: ${t.ticket_number}`:"",
    t?.channel?`Канал: ${t.channel}`:""
  ];

  if(r.status===401){
    setStatus("bad","Доступ заборонено","Невірний VENUE_DEMO_SCANNER_SECRET.",qr_payload);
    soundBad();vibrateBad();return;
  }

  if(r.status===404){
    setStatus("bad","Квиток не знайдено","Цього квитка немає у контурі обраного майданчика.",qr_payload);
    soundBad();vibrateBad();return;
  }

  if(r.status===409&&(data?.response_code==="already_used"||data?.result==="already_used")){
    setStatus("warn","Вже використано",[...parts,at?`Погашено: ${fmt(at)}`:"",data?.checked_in_by?`Вхід: ${data.checked_in_by}`:""].filter(Boolean).join(" • "),qr_payload);
    soundBad();vibrateBad();return;
  }

  if(r.status===409&&data?.response_code==="wrong_seance"){
    setStatus("bad","Інший сеанс",[...parts,t?.seance_id?`Квиток на: ${t.seance_id}`:"",sid?`Сканер очікує: ${sid}`:""].filter(Boolean).join(" • "),qr_payload);
    soundBad();vibrateBad();return;
  }

  if(r.status===409&&data?.response_code==="scanner_seance_invalid"){
    setStatus("bad","Невірний сеанс сканера","Обраний у URL сеанс не належить цьому майданчику.",qr_payload);
    soundBad();vibrateBad();return;
  }

  if(r.status===409&&data?.response_code==="ticket_not_usable"){
    setStatus("bad","Квиток недійсний",[...parts,t?.status?`Статус: ${t.status}`:""].filter(Boolean).join(" • "),qr_payload);
    soundBad();vibrateBad();return;
  }

  if(!r.ok||data?.ok===false){
    setStatus("bad","Відмовлено",String(data?.response_code||data?.error||`HTTP ${r.status}`),qr_payload);
    soundBad();vibrateBad();return;
  }

  setStatus("ok","ПРОПУСТИТИ",[...parts,at?`Погашено: ${fmt(at)}`:""].filter(Boolean).join(" • "),qr_payload);
  soundOk();
}

async function onScanSuccess(decodedText){
  if(scanLocked)return;
  const text=String(decodedText||"").trim();
  if(!text)return;
  const now=Date.now();
  if(text===lastQr&&now-lastQrAt<duplicateCooldownMs)return;

  lastQr=text;lastQrAt=now;scanLocked=true;$("stQr").textContent=text;
  try{await sendToServer(text)}
  catch(e){setStatus("bad","Помилка мережі",String(e?.message||e),text);soundBad();vibrateBad()}
  finally{setTimeout(()=>scanLocked=false,900)}
}

async function start(){
  ensureAudio();$("btnStart").disabled=true;
  try{
    qr=new Html5Qrcode("reader");
    await qr.start({facingMode:"environment"},{fps:12,qrbox:{width:280,height:280},disableFlip:false},onScanSuccess);
    $("btnStop").disabled=false;
    setStatus("ok","Камера працює","Скануйте QR квитка цього майданчика.","");
    beep({freq:660,duration:.05,gain:.06})
  }catch(e){
    $("btnStart").disabled=false;$("btnStop").disabled=true;
    setStatus("bad","Помилка камери",String(e?.message||e),"");soundBad()
  }
}

async function stop(){
  $("btnStop").disabled=true;
  try{
    if(qr){await qr.stop();await qr.clear();qr=null}
    $("btnStart").disabled=false;
    setStatus("ok","Зупинено","Камеру зупинено.","")
  }catch(e){
    $("btnStart").disabled=false;
    setStatus("warn","Зупинено з попередженням",String(e?.message||e),"")
  }
}

function clearSecret(){
  localStorage.removeItem(LS_SECRET_KEY);
  $("secret").value="";
  setStatus("ok","Secret очищено","Вставте VENUE_DEMO_SCANNER_SECRET знову при потребі.","")
}

window.addEventListener("load",async()=>{
  try{
    await loadConfig();
    $("btnStart").addEventListener("click",start);
    $("btnStop").addEventListener("click",stop);
    $("btnClear").addEventListener("click",clearSecret)
  }catch(e){
    $("btnStart").disabled=true;
    setStatus("bad","Помилка запуску",String(e?.message||e),"")
  }
})
