import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Torrent = { id:number; hashString:string; name:string; status:number; percentDone:number; rateDownload:number; rateUpload:number; eta:number };
type PrinterStatus = { configured:boolean; online:boolean; host:string; adminUrl:string; detectedPorts:number[]; protocol:string; note:string };
type NetworkStatus = { id:string; name:string; kind:string; online:boolean; adminOnline?:boolean; ip:string; mac:string; latencyMs:number; adminUrl:string; note:string };
type CopyState = { torrentName:string; destination:string; state:string; message?:string; attempts?:number; copiedBytes?:number; totalBytes?:number; currentFile?:string; fileCopiedBytes?:number; fileTotalBytes?:number; speedBytesPerSec?:number; etaSeconds?:number; percent?:number };
type TuyaPoint = { code:string; value:unknown };
type TuyaSpec = { code:string; type:string; values:string; dp_id?:number; dpId?:number };
type TuyaDevice = { id:string; name:string; online:boolean; category:string; productName:string; productId?:string; homeId?:string; status:TuyaPoint[]; functions:TuyaSpec[]; statusSpec:TuyaSpec[] };
type TuyaScene = { id:string; name:string; homeId?:string; enabled?:boolean; capabilities?:Array<{interface_name?:string; commands?:string[]}> };
type SmartHome = { configured:boolean; online:boolean; lastUpdatedAt:string|null; error?:string; devices:TuyaDevice[]; scenes:TuyaScene[] };
type State = {
  snapshot:null|{
    timestamp:string;
    kd20:{online:boolean;torrents:Torrent[]};
    wd:{online:boolean;freeBytes:number;totalBytes:number;mediaRoot:string};
    printer?:PrinterStatus;
    network?:NetworkStatus[];
  };
  bridgeLastSeenAt:string|null;
  bridgeOnline:boolean;
  settings:{autoCopyEnabled:boolean;autoCopyDestination:string};
  copies:Record<string,CopyState>;
  recentCommands:Array<{id:string;type:string;createdAt:string;completedAt?:string;ok?:boolean;message?:string}>;
  smartHome:SmartHome;
};
type Tab = "overview"|"downloads"|"smart"|"network"|"printer"|"settings";
type SmartFilter = "all"|"switch"|"sensor"|"climate"|"light"|"gate"|"charger"|"device";

const fmtBytes=(n:number)=>{if(!n)return"0 B";const u=["B","KB","MB","GB","TB"];let i=0,v=n;while(v>=1024&&i<u.length-1){v/=1024;i++}return`${v.toFixed(i>2?2:1)} ${u[i]}`};
const fmtSpeed=(n:number)=>`${fmtBytes(n)}/s`;
const fmtDuration=(s?:number)=>!s||s<=0?"—":s<60?`${Math.ceil(s)} mp`:s<3600?`${Math.ceil(s/60)} perc`:`${Math.floor(s/3600)} ó ${Math.ceil((s%3600)/60)} p`;
const bridgeAge=(iso:string|null|undefined)=>{if(!iso)return"Nincs még kapcsolat";const s=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/1000));return s<60?`${s} mp`:`${Math.floor(s/60)} p ${s%60} mp`};
const statusLabel=(status:number)=>({0:"Leállítva",1:"Ellenőrzésre vár",2:"Ellenőrzés",3:"Letöltésre vár",4:"Letölt",5:"Seedre vár",6:"Seedel"}[status]||`Állapot ${status}`);
const isDangerous=(name:string)=>/kapu|gate|garage|garázs|door|lock|zár/i.test(name);
const statusMap=(d:TuyaDevice)=>Object.fromEntries(d.status.map(x=>[x.code,x.value]));
const tabDefs:Array<{id:Tab;label:string;short:string}>=[
  {id:"overview",label:"Áttekintés",short:"Áttekintés"},
  {id:"downloads",label:"Letöltések",short:"Letöltés"},
  {id:"smart",label:"Smart Life",short:"Smart"},
  {id:"network",label:"Hálózat",short:"Hálózat"},
  {id:"printer",label:"Nyomtató",short:"Nyomtató"},
  {id:"settings",label:"Beállítások",short:"Beállítás"},
];

function specFor(d:TuyaDevice,code:string){return[...d.functions,...d.statusSpec].find(s=>s.code===code)}
function specValues(d:TuyaDevice,code:string){const x=specFor(d,code);if(!x)return{} as Record<string,unknown>;try{return JSON.parse(x.values||"{}") as Record<string,unknown>}catch{return{} as Record<string,unknown>}}
function findFunction(d:TuyaDevice,patterns:string[],type?:string){return d.functions.find(x=>(!type||x.type.toLowerCase()===type.toLowerCase())&&patterns.some(p=>x.code.toLowerCase()===p||x.code.toLowerCase().includes(p)))}
function findStatus(d:TuyaDevice,patterns:string[]){return d.status.find(x=>patterns.some(p=>x.code.toLowerCase()===p||x.code.toLowerCase().includes(p)))}
function deviceKind(d:TuyaDevice):SmartFilter{const s=`${d.name} ${d.productName} ${d.category}`.toLowerCase();if(/feyree|portable charger|ev charger|evse|autó.*tölt|car charger/.test(s))return"charger";if(/air conditioner|klíma|climate|aircon/.test(s))return"climate";if(/temperature|humidity|hőmér|thermo|sensor/.test(s))return"sensor";if(/gate|kapu|garage|garázs|lock/.test(s))return"gate";if(/light|bulb|lamp|lámpa|rgb|cct/.test(s))return"light";if(/plug|socket|switch|outlet|konnektor/.test(s))return"switch";return"device"}
function metric(d:TuyaDevice,patterns:string[]){const p=findStatus(d,patterns);if(!p||typeof p.value!=="number")return null;const meta=specValues(d,p.code);const scale=Number(meta.scale||0);const v=p.value/Math.pow(10,scale);return{value:v,unit:String(meta.unit||""),scale}}
function batteryPercent(d:TuyaDevice){const direct=["battery_percentage","battery_percent","battery_pct","battery_value"];const p=d.status.find(x=>direct.includes(x.code.toLowerCase())&&typeof x.value==="number");if(p){const meta=specValues(d,p.code);const scale=Number(meta.scale||0);let v=Number(p.value)/Math.pow(10,scale);const max=Number(meta.max||100);if(max>100&&v>100)v=v/max*100;if(v>=0&&v<=100)return Math.round(v)}const state=findStatus(d,["battery_state"]);if(state&&typeof state.value==="string"){const map:Record<string,number>={high:100,middle:55,medium:55,low:20};return map[state.value.toLowerCase()]??null}return null}
function enumRange(d:TuyaDevice,code?:string):string[]{if(!code)return[];const m=specValues(d,code) as {range?:unknown};return Array.isArray(m.range)?m.range.map((value:unknown)=>String(value)):[]}
function labelKind(kind:SmartFilter){return kind==="climate"?"Klíma":kind==="sensor"?"Szenzor":kind==="switch"?"Kapcsoló":kind==="light"?"Világítás":kind==="gate"?"Kapu":kind==="charger"?"Autótöltő":"Eszköz"}

function actionFunction(d:TuyaDevice,patterns:string[]){
  return d.functions.find(fn=>patterns.some(p=>fn.code.toLowerCase()===p||fn.code.toLowerCase().includes(p)));
}
function actionValue(fn:TuyaSpec|undefined,preferred:string[]=[]):unknown{
  if(!fn)return true;
  const type=fn.type.toLowerCase();
  if(type==="boolean")return true;
  const meta=(()=>{try{return JSON.parse(fn.values||"{}") as Record<string,unknown>}catch{return{} as Record<string,unknown>}})();
  if(type==="enum"){
    const range=Array.isArray(meta.range)?meta.range.map(String):[];
    for(const p of preferred){const hit=range.find(v=>v.toLowerCase()===p||v.toLowerCase().includes(p));if(hit)return hit}
    return range[0]??true;
  }
  if(type==="integer"||type==="value")return Number(meta.min??1);
  return true;
}
function displayMetric(d:TuyaDevice,patterns:string[],fallbackUnit=""){
  const p=findStatus(d,patterns);if(!p)return null;
  if(typeof p.value!=="number")return{value:String(p.value),unit:fallbackUnit};
  const meta=specValues(d,p.code);const scale=Number(meta.scale||0);return{value:(Number(p.value)/Math.pow(10,scale)).toFixed(scale>0?1:0),unit:String(meta.unit||fallbackUnit)};
}
function chargerMetric(d:TuyaDevice,patterns:string[],fallbackUnit=""){return displayMetric(d,patterns,fallbackUnit)}
function numericFunctionMeta(d:TuyaDevice,fn?:TuyaSpec){if(!fn)return null;const meta=specValues(d,fn.code);return{min:Number(meta.min??0),max:Number(meta.max??100),step:Number(meta.step??1),scale:Number(meta.scale??0),unit:String(meta.unit||"")}}
function networkKind(kind:string){return kind==="gateway"?"Telekom gateway":kind==="router"?"Router":kind==="extender"?"Wi-Fi erősítő":kind==="switch"?"Switch":kind==="nas"?"NAS":kind==="computer"?"Gép":"Eszköz"}
function initialTab():Tab{const v=window.location.hash.replace(/^#/,"") as Tab;return tabDefs.some(t=>t.id===v)?v:"overview"}
async function api(path:string,init?:RequestInit){const r=await fetch(path,init);if(r.status===401)throw new Error("AUTH_REQUIRED");const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b?.error||`HTTP ${r.status}`);return b}

function Login({onDone}:{onDone:()=>void}){
  const[password,setPassword]=useState("");const[busy,setBusy]=useState(false);const[error,setError]=useState("");
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{await api("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password})});onDone()}catch(err){setError(err instanceof Error&&err.message==="too_many_attempts"?"Túl sok sikertelen próbálkozás. Próbáld később.":"Hibás jelszó.")}finally{setBusy(false)}}
  return <main className="loginShell"><section className="loginCard"><div className="brandMark">H</div><div className="eyebrow">HOME HUB</div><h1>Belépés</h1><p>NAS, hálózat és okosotthon egyetlen felületen.</p><form onSubmit={submit}><input type="password" autoFocus autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="HomeHub jelszó"/><button disabled={busy||!password}>{busy?"Belépés…":"Belépés"}</button></form>{error&&<div className="loginError">{error}</div>}</section></main>
}

function SmartDeviceCard({device,onCommand,onOpen}:{device:TuyaDevice;onCommand:(d:TuyaDevice,code:string,value:unknown)=>void;onOpen:(d:TuyaDevice)=>void}){
  const kind=deviceKind(device),sm=statusMap(device),battery=batteryPercent(device);
  const temp=(kind==="sensor"||kind==="climate"||kind==="charger")?metric(device,["temp_current","va_temperature","temperature","temp_value","temp"]):null;
  const hum=(kind==="sensor"||kind==="climate")?metric(device,["humidity_value","va_humidity","humidity","humid"]):null;
  const switchFn=(kind==="switch"||kind==="light"||kind==="climate"||kind==="charger")?findFunction(device,["switch","switch_1","switch_led","power","power_switch","charge_switch"],"Boolean"):undefined;
  const switchCode=switchFn?.code;const switchValue=switchCode?Boolean(sm[switchCode]):undefined;
  const setTempFn=kind==="climate"?findFunction(device,["temp_set","target_temp","temp_target","temp_set_f"]):undefined;
  const modeFn=kind==="climate"?findFunction(device,["mode","work_mode"],"Enum"):undefined;
  const setTempCode=setTempFn?.code,modeCode=modeFn?.code;
  const rawTarget=()=>{if(!setTempCode)return"";const v=sm[setTempCode];const m=specValues(device,setTempCode);const scale=Number(m.scale||0);return typeof v==="number"?String(v/Math.pow(10,scale)):""};
  const[target,setTarget]=useState(rawTarget);
  useEffect(()=>setTarget(rawTarget()),[device.id,setTempCode,sm[setTempCode||""]]);
  const modeRange=enumRange(device,modeCode);
  const readOnly=device.status.filter(p=>typeof p.value==="string"||typeof p.value==="number"||typeof p.value==="boolean").filter(p=>!/^switch/.test(p.code)).slice(0,3);
  const volts=kind==="charger"?chargerMetric(device,["voltage","cur_voltage","voltage_a","input_voltage"],"V"):null;
  const amps=kind==="charger"?chargerMetric(device,["current","cur_current","electric_current","charge_current","current_a"],"A"):null;
  const power=kind==="charger"?chargerMetric(device,["power","cur_power","active_power","charge_power"],"kW"):null;
  return <article className={`smartDevice ${kind} ${device.online?"online":"offline"}`}>
    <div className="deviceHead"><div><span className={`deviceDot ${device.online?"on":""}`}></span><strong title={device.name}>{device.name}</strong></div><span className="deviceKind">{labelKind(kind)}</span></div>
    <small title={device.productName||device.category}>{device.productName||device.category||"Smart Life eszköz"} · {device.online?"Online":"Offline"}</small>
    {(temp||hum||battery!==null)&&<div className="metrics">{temp&&<span>🌡 {temp.value.toFixed(temp.scale>0?1:0)}{temp.unit?` ${temp.unit}`:" °C"}</span>}{hum&&<span>💧 {hum.value.toFixed(hum.scale>0?1:0)}{hum.unit?` ${hum.unit}`:" %"}</span>}{battery!==null&&<span>🔋 {battery}%</span>}</div>}
    {kind==="charger"&&<div className="chargerSummary">{volts&&<span><b>{volts.value}</b>{volts.unit}</span>}{amps&&<span><b>{amps.value}</b>{amps.unit}</span>}{power&&<span><b>{power.value}</b>{power.unit}</span>}</div>}
    <div className="deviceControls">
      {switchCode&&kind!=="gate"&&<button className={switchValue?"power on":"power"} disabled={!device.online} onClick={()=>onCommand(device,switchCode,!switchValue)}>{switchValue?"Kikapcsolás":"Bekapcsolás"}</button>}
      {setTempCode&&kind==="climate"&&<div className="tempControl"><input aria-label="Célhőmérséklet" type="number" step="0.5" value={target} onChange={e=>setTarget(e.target.value)}/><button disabled={!device.online||!target} onClick={()=>{const m=specValues(device,setTempCode);const scale=Number(m.scale||0);onCommand(device,setTempCode,Math.round(Number(target)*Math.pow(10,scale)))}}>Beállítás</button></div>}
      {modeCode&&modeRange.length>0&&kind==="climate"&&<label className="selectControl">Mód<select value={String(sm[modeCode]??"")} disabled={!device.online} onChange={e=>onCommand(device,modeCode,e.target.value)}>{modeRange.map((m:string)=><option value={m} key={m}>{m}</option>)}</select></label>}
      {(kind==="gate"||kind==="charger")&&<button className="detailsBtn" disabled={!device.online} onClick={()=>onOpen(device)}>{kind==="gate"?"Kapu vezérlése":"Töltő részletei"}</button>}
    </div>
    {kind==="device"&&readOnly.length>0&&<div className="rawMetrics">{readOnly.map(p=><span key={p.code}>{p.code}: {String(p.value)}</span>)}</div>}
  </article>
}

function DeviceDetailDialog({device,onClose,onCommand}:{device:TuyaDevice;onClose:()=>void;onCommand:(d:TuyaDevice,code:string,value:unknown)=>void}){
  const kind=deviceKind(device),sm=statusMap(device);
  const isGate=kind==="gate",isCharger=kind==="charger";
  const gateActions=[
    {key:"start",label:"Start",patterns:["start","run","gate_start"],preferred:["start","open"]},
    {key:"pedestrian",label:"Személybejáró",patterns:["pedestrian","person","small_door","side_door","wicket"],preferred:["pedestrian","person","open"]},
    {key:"stop",label:"Stop",patterns:["stop","pause","gate_stop"],preferred:["stop"]},
    {key:"open",label:"Nyitás",patterns:["gate_open","door_open","open"],preferred:["open"]},
    {key:"close",label:"Zárás",patterns:["gate_close","door_close","close"],preferred:["close"]},
    {key:"light",label:"Világítás",patterns:["light","lamp","switch_led","light_switch"],preferred:["on","open"]},
  ];
  const gateState=findStatus(device,["gate_state","door_state","open_close_state","work_state","status"]);
  const warning=findStatus(device,["warning","alarm","fault","alert"]);
  const chargerSwitch=findFunction(device,["charge_switch","switch","power","start_charge"],"Boolean");
  const currentFn=actionFunction(device,["set_current","current_set","charge_current_set","charge_current","rated_current","current_limit"]);
  const delayFn=actionFunction(device,["delay_time","set_delaytime","delay_charge","delay"]);
  const chargeTimeFn=actionFunction(device,["set_charge_time","charge_time_set","charge_time","duration"]);
  const[current,setCurrent]=useState(()=>currentFn&&sm[currentFn.code]!==undefined?String(sm[currentFn.code]):"");const[delay,setDelay]=useState(()=>delayFn&&sm[delayFn.code]!==undefined?String(sm[delayFn.code]):"");const[chargeTime,setChargeTime]=useState(()=>chargeTimeFn&&sm[chargeTimeFn.code]!==undefined?String(sm[chargeTimeFn.code]):"");
  const currentMeta=numericFunctionMeta(device,currentFn),delayMeta=numericFunctionMeta(device,delayFn),chargeMeta=numericFunctionMeta(device,chargeTimeFn);
  const metrics=[
    ["Hőmérséklet",chargerMetric(device,["temperature","temp","charger_temp"],"°C")],
    ["Feszültség",chargerMetric(device,["voltage","cur_voltage","voltage_a","input_voltage"],"V")],
    ["Áramerősség",chargerMetric(device,["current","cur_current","electric_current","current_a"],"A")],
    ["Teljesítmény",chargerMetric(device,["power","cur_power","active_power","charge_power"],"kW")],
    ["Energia",chargerMetric(device,["energy","add_ele","total_energy","electricity","charge_energy"],"kWh")],
    ["CP",chargerMetric(device,["cp_state","cp_status","cp"],"")],
  ] as Array<[string,{value:string;unit:string}|null]>;
  function sendNumeric(fn:TuyaSpec|undefined,raw:string,meta:ReturnType<typeof numericFunctionMeta>){if(!fn||!raw||!meta)return;const value=Math.round(Number(raw)*Math.pow(10,meta.scale));onCommand(device,fn.code,value)}
  return <div className="modalBack" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className={`modal deviceDetail ${isGate?"gateDetail":"chargerDetail"}`}><div className="detailHead"><div><span className="deviceKind">{labelKind(kind)}</span><h2>{device.name}</h2><p>{device.productName||device.category} · {device.online?"Online":"Offline"}</p></div><button className="closeBtn" onClick={onClose}>×</button></div>
    {isGate&&<><div className="gateHero"><div className="gateGlyph">▰▰▰</div><div><strong>Kapuvezérlés</strong><span>{gateState?`Állapot: ${String(gateState.value)}`:"Állapot: nincs adat"}</span></div></div><div className="gateActionGrid">{gateActions.map(a=>{const fn=actionFunction(device,a.patterns);return <button key={a.key} disabled={!device.online||!fn} onClick={()=>{if(!fn)return;if(a.key!=="light"&&!window.confirm(`${device.name}: ${a.label} végrehajtása?`))return;onCommand(device,fn.code,a.key==="light"&&fn.type.toLowerCase()==="boolean"?!Boolean(sm[fn.code]):actionValue(fn,a.preferred))}}><span>{a.key==="start"?"▶":a.key==="stop"?"■":a.key==="open"?"⌂":a.key==="close"?"🔒":a.key==="light"?"💡":"●"}</span>{a.label}<small>{fn?fn.code:"nem elérhető"}</small></button>})}</div><div className="gateStatusGrid"><div><span>Kapu állapota</span><strong>{gateState?String(gateState.value):"Ismeretlen"}</strong></div><div><span>Figyelmeztetés</span><strong>{warning?String(warning.value):"Nincs"}</strong></div></div></>}
    {isCharger&&<><div className="chargerHero"><div className="chargerMetrics">{metrics.map(([label,m])=><div key={label}><span>{label}</span><strong>{m?`${m.value}${m.unit?` ${m.unit}`:""}`:"—"}</strong></div>)}</div></div><div className="chargerActions">{chargerSwitch&&<button className={Boolean(sm[chargerSwitch.code])?"danger":"primary"} onClick={()=>onCommand(device,chargerSwitch.code,!Boolean(sm[chargerSwitch.code]))}>{Boolean(sm[chargerSwitch.code])?"Töltés leállítása":"Töltés indítása"}</button>}<SettingControl device={device} fn={currentFn} label="Max. áramerősség" value={current} setValue={setCurrent} meta={currentMeta} suffix="A" onSave={()=>sendNumeric(currentFn,current,currentMeta)} onCommand={onCommand}/><SettingControl device={device} fn={delayFn} label="Késleltetés" value={delay} setValue={setDelay} meta={delayMeta} suffix="h" onSave={()=>sendNumeric(delayFn,delay,delayMeta)} onCommand={onCommand}/><SettingControl device={device} fn={chargeTimeFn} label="Töltési idő" value={chargeTime} setValue={setChargeTime} meta={chargeMeta} suffix="h" onSave={()=>sendNumeric(chargeTimeFn,chargeTime,chargeMeta)} onCommand={onCommand}/></div></>}
  </section></div>
}

function SettingControl({device,fn,label,value,setValue,meta,suffix,onSave,onCommand}:{device:TuyaDevice;fn:TuyaSpec|undefined;label:string;value:string;setValue:(v:string)=>void;meta:ReturnType<typeof numericFunctionMeta>;suffix:string;onSave:()=>void;onCommand:(d:TuyaDevice,code:string,value:unknown)=>void}){
  const options=fn?.type.toLowerCase()==="enum"?enumRange(device,fn.code):[];
  if(options.length>0)return <div className="settingRow"><div><strong>{label}</strong><small>A töltő által engedélyezett értékek.</small></div><div className="settingInput"><select value={value||options[0]} onChange={e=>{setValue(e.target.value);onCommand(device,fn!.code,e.target.value)}}>{options.map(v=><option value={v} key={v}>{v}{suffix}</option>)}</select></div></div>;
  return <SettingRow label={label} value={value} setValue={setValue} meta={meta} suffix={suffix} onSave={onSave}/>;
}

function SettingRow({label,value,setValue,meta,suffix,onSave}:{label:string;value:string;setValue:(v:string)=>void;meta:ReturnType<typeof numericFunctionMeta>;suffix:string;onSave:()=>void}){
  return <div className="settingRow"><div><strong>{label}</strong><small>{meta?`${meta.min/Math.pow(10,meta.scale)}–${meta.max/Math.pow(10,meta.scale)} ${meta.unit||suffix}`:"A Tuya eszköz nem publikálja ezt a beállítást."}</small></div><div className="settingInput"><input disabled={!meta} type="number" step={meta?meta.step/Math.pow(10,meta.scale):1} min={meta?meta.min/Math.pow(10,meta.scale):undefined} max={meta?meta.max/Math.pow(10,meta.scale):undefined} value={value} onChange={e=>setValue(e.target.value)} placeholder={meta?String(meta.min/Math.pow(10,meta.scale)):"—"}/><span>{suffix}</span><button disabled={!meta||!value} onClick={onSave}>Beállítás</button></div></div>
}

function DeleteDialog({torrent,onClose,onDelete}:{torrent:Torrent;onClose:()=>void;onDelete:(deleteData:boolean)=>void}){
  return <div className="modalBack" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal"><span className="dangerMark">!</span><h2>Torrent törlése</h2><p><strong>{torrent.name}</strong></p><p>A WD My Cloudra már átmásolt példányhoz egyik művelet sem nyúl.</p><div className="modalActions"><button className="secondary" onClick={()=>onDelete(false)}>Csak torrent eltávolítása</button><button className="danger" onClick={()=>onDelete(true)}>Torrent + KD20 fájlok törlése</button><button className="ghost" onClick={onClose}>Mégse</button></div></section></div>
}

function NetworkDeviceCard({n}:{n:NetworkStatus}){
  return <article className={`networkDevice ${n.online?"online":"offline"}`}><div className="deviceHead"><div><span className={`deviceDot ${n.online?"on":""}`}></span><strong>{n.name}</strong></div><span className="deviceKind">{networkKind(n.kind)}</span></div><small>{n.ip||"IP keresése…"}{n.mac?` · ${n.mac}`:""}</small><div className="networkMeta"><span>{n.online?(n.latencyMs>0?`${n.latencyMs.toFixed(1)} ms`:"Jelen van"):"Nem elérhető"}</span>{n.adminUrl&&n.ip&&<a className={n.adminOnline===false?"mutedLink":""} href={n.adminUrl} target="_blank" rel="noreferrer">Admin{n.adminOnline===false?" (nem válaszol)":""}</a>}</div><em>{n.note}</em></article>
}

function TopoNode({title,subtitle,status,kind="node"}:{title:string;subtitle?:string;status?:NetworkStatus;kind?:string}){
  const known=Boolean(status);const on=status?.online;
  return <div className={`topoNode kind-${kind} ${known?(on?"online":"offline"):"passive"}`}><div className="topoNodeTitle"><span className={`deviceDot ${on?"on":""}`}></span><strong>{title}</strong></div>{subtitle&&<small>{subtitle}</small>}{status&&<span className="topoState">{status.online?(status.ip||"Online"):(status.ip?"Nem válaszol":"IP keresése…")}</span>}</div>
}

const observedArcherClients=[
  {name:"ESP_C2CD65",band:"2.4 GHz"},{name:"ESP_C37477",band:"2.4 GHz"},{name:"lwip0",band:"2.4 GHz"},{name:"Unknown",band:"2.4 GHz"},{name:"xiaomi-vacuum-b112_mibtAAB5",band:"2.4 GHz"},
  {name:"Unknown",band:"5 GHz"},{name:"Edina-A34-eszkoze",band:"5 GHz"},{name:"iPhone",band:"5 GHz"},{name:"iPhone",band:"5 GHz"},{name:"lwip0",band:"5 GHz"},{name:"RE220",band:"5 GHz",node:true},{name:"RE315 #1",band:"5 GHz",node:true},{name:"RE315 #2",band:"5 GHz",node:true},{name:"Watch",band:"5 GHz"},{name:"wlan0",band:"5 GHz"},{name:"wlan0",band:"5 GHz"},{name:"wlan0",band:"5 GHz"},{name:"wlan0",band:"5 GHz"},{name:"Technicolor CH USA",band:"vezetékes",node:true}
];
const observedRe315Clients=[{name:"lwip0",band:"2.4 GHz"},{name:"Watch",band:"2.4 GHz"},{name:"wlan0",band:"2.4 GHz"},{name:"wlan0",band:"2.4 GHz"},{name:"wlan0",band:"2.4 GHz"},{name:"wlan0",band:"2.4 GHz"},{name:"ANONYMOUS",band:"5 GHz"},{name:"Edina-A34-eszkoze",band:"5 GHz"}];

function WifiClientSnapshot(){
  return <section className="wifiClientsPanel"><div className="wifiClientsHead"><div><h3>Wi-Fi kliensek</h3><p>A TP-Link Tetherből felvett legutóbbi klienslista. A következő lépésben MAC/IP alapján automatikusan frissíthető.</p></div><span className="snapshotBadge">Pillanatkép</span></div><div className="wifiClientColumns"><div className="wifiClientGroup"><div className="wifiGroupTitle"><strong>Archer C6 · krankovics</strong><span>19 kliens</span></div><div className="clientChips">{observedArcherClients.map((c,i)=><span className={c.node?"clientChip node":"clientChip"} key={`${c.name}-${i}`}><b>{c.name}</b><small>{c.band}</small></span>)}</div></div><div className="wifiClientGroup"><div className="wifiGroupTitle"><strong>RE315 #1 · …:93:86</strong><span>8 kliens</span></div><div className="clientChips">{observedRe315Clients.map((c,i)=><span className="clientChip" key={`${c.name}-${i}`}><b>{c.name}</b><small>{c.band}</small></span>)}</div></div></div></section>
}

function NetworkTopology({network}:{network:NetworkStatus[]}){
  const byId=Object.fromEntries(network.map(n=>[n.id,n]));
  return <div className="topologyWrap">
    <div className="topologyLegend"><span><i className="legendDot online"></i> élő</span><span><i className="legendDot"></i> nem elérhető</span><span><i className="legendDot passive"></i> passzív / nem menedzselhető</span></div>
    <div className="topology topologyV11">
      <div className="topoRoot"><TopoNode title="Technicolor FGA2233" subtitle="Fő router · 192.168.1.1" status={byId["technicolor-fga2233"]} kind="gateway"/></div>
      <div className="topologySections">
        <section className="topoLane wifiLane"><header><span className="laneBadge wifi">Wi-Fi</span><strong>krankovics2</strong></header><div className="wifiDirect"><TopoNode title="Krankovics-MBP" subtitle="2.4 GHz · 192.168.1.114" status={byId["krankovics-mbp"]} kind="computer"/></div></section>
        <section className="topoLane ethernet ethernetV11"><header><span className="laneBadge ethernet">Ethernet</span><strong>Vezetékes hálózat</strong></header><div className="portsV11">
          <div className="portV11"><div className="portLabel">Port 1</div><TopoNode title="DESKTOP-E6K3SEK" subtitle="192.168.1.25" status={byId["desktop-e6k3sek"]} kind="computer"/></div>
          <div className="portV11 port2"><div className="portLabel">Port 2</div><TopoNode title="TL-SG108E" subtitle="Menedzselhető switch · 192.168.1.49" status={byId["tl-sg108e"]} kind="network-switch"/><div className="port2Tree"><div className="treeBranch"><TopoNode title="DorkaPC" subtitle="192.168.1.210" status={byId["dorkapc"]} kind="computer"/></div><div className="treeBranch chainBranch"><TopoNode title="D-Link GO-SW-5G" subtitle="Passzív gigabit switch" kind="network-switch"/><span className="chainArrow">↓</span><TopoNode title="TP-Link LiteWave LS105G" subtitle="Passzív gigabit switch" kind="network-switch"/><span className="chainArrow">↓</span><TopoNode title="davidgaming" subtitle="192.168.1.138" status={byId["davidgaming"]} kind="computer"/></div><div className="treeBranch meshBranchV11"><TopoNode title="Archer C6" subtitle="Mesh főpont · 192.168.1.129" status={byId["archer-c6"]} kind="router"/><div className="ssidLabel">Wi-Fi / mesh: <strong>krankovics</strong></div><div className="meshNodesV11"><TopoNode title="RE220" status={byId["re220"]} kind="extender"/><TopoNode title="RE315 #1" subtitle="MAC …:93:86 · 8 ismert kliens" status={byId["re315-1"]} kind="extender"/><TopoNode title="RE315 #2" status={byId["re315-2"]} kind="extender"/></div></div></div></div>
          <div className="portV11"><div className="portLabel">Port 3</div><TopoNode title="KD20 / oldnas" subtitle="Torrent NAS · 192.168.1.12" status={byId["kd20"]} kind="nas"/></div>
          <div className="portV11"><div className="portLabel">Port 4</div><TopoNode title="WD My Cloud" subtitle="Médiatár · 192.168.1.180" status={byId["wd-my-cloud"]} kind="nas"/></div>
        </div></section>
      </div>
    </div>
    <WifiClientSnapshot/>
  </div>
}

function App(){
  const[auth,setAuth]=useState<"checking"|"yes"|"no">("checking"),[state,setState]=useState<State|null>(null),[magnet,setMagnet]=useState(""),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[deleteTarget,setDeleteTarget]=useState<Torrent|null>(null),[detailTarget,setDetailTarget]=useState<TuyaDevice|null>(null),[tab,setTab]=useState<Tab>(initialTab),[smartFilter,setSmartFilter]=useState<SmartFilter>("all");
  async function checkAuth(){const r=await fetch("/api/auth/status");const j=await r.json();setAuth(j.authenticated?"yes":"no")}
  async function load(){try{setState(await api("/api/state"));setAuth("yes")}catch(err){if(err instanceof Error&&err.message==="AUTH_REQUIRED")setAuth("no")}}
  useEffect(()=>{checkAuth();if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"}).then(r=>r.update()).catch(()=>{})},[]);
  useEffect(()=>{if(auth!=="yes")return;load();const id=setInterval(load,3000);return()=>clearInterval(id)},[auth]);
  useEffect(()=>{const onHash=()=>setTab(initialTab());window.addEventListener("hashchange",onHash);return()=>window.removeEventListener("hashchange",onHash)},[]);
  const torrents=state?.snapshot?.kd20.torrents||[],printer=state?.snapshot?.printer,network=state?.snapshot?.network||[],smart:SmartHome=state?.smartHome??{configured:false,online:false,lastUpdatedAt:null,devices:[],scenes:[]};
  const totalDl=useMemo(()=>torrents.reduce((a,t)=>a+t.rateDownload,0),[torrents]),totalUl=useMemo(()=>torrents.reduce((a,t)=>a+t.rateUpload,0),[torrents]),wdUsed=state?.snapshot?.wd.totalBytes?1-state.snapshot.wd.freeBytes/state.snapshot.wd.totalBytes:0;
  const smartVisible=smart.devices.filter(d=>smartFilter==="all"||deviceKind(d)===smartFilter);
  const onlineSmart=smart.devices.filter(d=>d.online).length;
  const runningTorrents=torrents.filter(t=>t.status===4).length;
  function chooseTab(next:Tab){setTab(next);window.history.replaceState(null,"",`#${next}`);window.scrollTo({top:0,behavior:"smooth"})}
  function flash(m:string){setNotice(m);window.setTimeout(()=>setNotice(""),4000)}
  async function addMagnet(e:React.FormEvent){e.preventDefault();if(!magnet.trim())return;setBusy(true);try{await api("/api/torrents/magnet",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({magnet})});setMagnet("");flash("Magnet link elküldve a KD20-nak.")}catch(err){flash(`Hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}finally{setBusy(false);load()}}
  async function addFile(file?:File){if(!file)return;const fd=new FormData();fd.append("torrent",file);setBusy(true);try{await api("/api/torrents/file",{method:"POST",body:fd});flash(".torrent fájl elküldve a KD20-nak.")}catch(err){flash(`Hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}finally{setBusy(false);load()}}
  async function copy(t:Torrent){try{await api(`/api/torrents/${t.id}/copy`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});flash("Másolási feladat elküldve.")}catch(err){flash(`Hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}load()}
  async function retryCopy(hash:string){try{await api(`/api/copies/${encodeURIComponent(hash)}/retry`,{method:"POST"});flash("Másolás újrapróbálása elküldve.")}catch(err){flash(`Hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}load()}
  async function removeTorrent(deleteData:boolean){if(!deleteTarget)return;const t=deleteTarget;setDeleteTarget(null);try{await api(`/api/torrents/${t.id}`,{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({deleteData,confirm:true})});flash(deleteData?"Torrent és KD20 fájlok törlése elküldve. A WD másolat megmarad.":"Torrent eltávolítása elküldve. A KD20 fájlok megmaradnak.")}catch(err){flash(`Törlési hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}setTimeout(load,1000)}
  async function updateSettings(patch:Partial<State["settings"]>){if(!state)return;const next={...state.settings,...patch};try{await api("/api/settings",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(next)});load()}catch(err){flash(`Hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}}
  async function smartCommand(d:TuyaDevice,code:string,value:unknown){try{await api(`/api/smart-home/devices/${encodeURIComponent(d.id)}/command`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code,value,confirm:isDangerous(d.name)})});flash(`${d.name}: parancs elküldve`);setTimeout(load,900)}catch(err){flash(`Smart Life hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}}
  async function runScene(s:TuyaScene){const dangerous=isDangerous(s.name);if(dangerous&&!window.confirm(`${s.name}: biztosan elindítod ezt a jelenetet?`))return;try{await api(`/api/smart-home/scenes/${encodeURIComponent(s.id)}/run`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({confirm:dangerous})});flash(`${s.name}: jelenet elindítva`);setTimeout(load,700)}catch(err){flash(`Jelenet hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}}
  async function refreshSmart(){try{await api("/api/smart-home/refresh",{method:"POST"});load();flash("Smart Life frissítve")}catch(err){flash(`Tuya hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}}
  async function logout(){await fetch("/api/auth/logout",{method:"POST"});setState(null);setAuth("no")}
  if(auth==="checking")return<main className="splash"><div className="brandMark">H</div><p>HomeHub betöltése…</p></main>;
  if(auth==="no")return<Login onDone={()=>setAuth("yes")}/>;

  const summaryCards=<section className="cards four summaryCards"><button className="card summaryButton" onClick={()=>chooseTab("downloads")}><span>KD20</span><strong>{state?.bridgeOnline&&state?.snapshot?.kd20.online?"Online":"Offline"}</strong><small>{torrents.length} torrent · ↓ {fmtSpeed(totalDl)} · ↑ {fmtSpeed(totalUl)}</small></button><button className="card summaryButton" onClick={()=>chooseTab("downloads")}><span>WD My Cloud</span><strong>{state?.bridgeOnline&&state?.snapshot?.wd.online?"Online":"Offline"}</strong><small>{state?.snapshot?`${fmtBytes(state.snapshot.wd.freeBytes)} szabad · ${Math.round(wdUsed*100)}% foglalt`:"Nincs adat"}</small></button><button className="card summaryButton" onClick={()=>chooseTab("network")}><span>Hálózat</span><strong>{network.filter(n=>n.online).length}/{network.length||0} online</strong><small>krankovics2 + krankovics mesh</small></button><button className="card summaryButton" onClick={()=>chooseTab("smart")}><span>Smart Life</span><strong>{smart.configured?(smart.online?"Online":"Hiba"):"Nincs konfigurálva"}</strong><small>{onlineSmart}/{smart.devices.length} eszköz online · {smart.scenes.length} jelenet</small></button></section>;

  return <main>{notice&&<div className="toast">{notice}</div>}{deleteTarget&&<DeleteDialog torrent={deleteTarget} onClose={()=>setDeleteTarget(null)} onDelete={removeTorrent}/>} {detailTarget&&<DeviceDetailDialog device={detailTarget} onClose={()=>setDetailTarget(null)} onCommand={smartCommand}/>}<header className="hero"><div><div className="eyebrow">HOME HUB · CORE</div><h1>Otthoni vezérlőközpont</h1><p>NAS, torrent, hálózat, nyomtató és Smart Life egyetlen PWA-ban.</p></div><div className="heroActions"><div className="live"><span className={state?.bridgeOnline?"dot on":"dot"}></span>{state?.bridgeOnline?"Bridge online":`Bridge offline · ${bridgeAge(state?.bridgeLastSeenAt)}`}</div><button className="ghost" onClick={logout}>Kilépés</button></div></header>

    <nav className="tabBar" aria-label="HomeHub funkciók">{tabDefs.map(t=><button key={t.id} className={tab===t.id?"active":""} onClick={()=>chooseTab(t.id)}><span className="tabFull">{t.label}</span><span className="tabShort">{t.short}</span></button>)}</nav>

    {tab==="overview"&&<div className="tabPanel">{summaryCards}<section className="overviewGrid"><article className="panel overviewCard"><div className="sectionHead"><div><h2>Letöltések</h2><p>KD20 Transmission és WD automatikus másolás.</p></div><button className="ghost" onClick={()=>chooseTab("downloads")}>Megnyitás</button></div><div className="overviewStats"><span><b>{runningTorrents}</b> aktív letöltés</span><span><b>{torrents.filter(t=>t.percentDone>=1).length}</b> kész torrent</span><span><b>{state?.settings.autoCopyEnabled?"Be":"Ki"}</b> automatikus másolás</span></div></article><article className="panel overviewCard"><div className="sectionHead"><div><h2>Otthoni hálózat</h2><p>Két Wi-Fi és a vezetékes topológia.</p></div><button className="ghost" onClick={()=>chooseTab("network")}>Térkép</button></div><div className="ssidSummary"><span><i className="wifiIcon">⌁</i><b>krankovics2</b><small>Technicolor FGA2233</small></span><span><i className="wifiIcon">⌁</i><b>krankovics</b><small>Archer C6 + mesh</small></span></div></article><article className="panel overviewCard"><div className="sectionHead"><div><h2>Smart Life</h2><p>Élő szenzorok és kapcsolható eszközök.</p></div><button className="ghost" onClick={()=>chooseTab("smart")}>Eszközök</button></div><div className="overviewStats"><span><b>{onlineSmart}</b> online</span><span><b>{smart.devices.filter(d=>deviceKind(d)==="sensor").length}</b> szenzor</span><span><b>{smart.devices.filter(d=>deviceKind(d)==="climate").length}</b> klíma</span></div></article><article className="panel overviewCard"><div className="sectionHead"><div><h2>Nyomtató</h2><p>KD20 USB Print Server.</p></div><button className="ghost" onClick={()=>chooseTab("printer")}>Megnyitás</button></div><span className={printer?.online?"statusBadge good":"statusBadge"}>{printer?.online?"Nyomtatószolgáltatás elérhető":"Nincs észlelve"}</span></article></section></div>}

    {tab==="downloads"&&<div className="tabPanel"><section className="panel add"><div><h2>Új torrent</h2><p>Magnet link vagy .torrent fájl.</p></div><form onSubmit={addMagnet} className="magnet"><input value={magnet} onChange={e=>setMagnet(e.target.value)} placeholder="magnet:?xt=urn:btih:…"/><button disabled={busy||!state?.bridgeOnline}>Hozzáadás</button></form><label className={`filebtn ${!state?.bridgeOnline?"disabled":""}`}>.torrent fájl<input disabled={!state?.bridgeOnline} type="file" accept=".torrent,application/x-bittorrent" onChange={e=>addFile(e.target.files?.[0])}/></label></section><section className="panel"><div className="sectionHead"><div><h2>Torrentek</h2><p>Letöltés, seedelés, WD-re másolás és manuális törlés.</p></div><button className="ghost" onClick={load}>Frissítés</button></div><div className="torrentList">{torrents.length===0&&<div className="empty">Még nincs torrent, vagy a Bridge nem küldött adatot.</div>}{torrents.map(t=>{const cp=t.hashString?state?.copies?.[t.hashString]:undefined,copying=cp&&(cp.state==="queued"||cp.state==="running"),done=cp?.state==="done",copyPct=Math.max(0,Math.min(100,Math.round((cp?.percent||0)*100)));return <article className="torrent" key={t.hashString||t.id}><div className="torrentTop"><div><strong>{t.name}</strong><span>{Math.round(t.percentDone*100)}%</span><small className="torrentStatus">{statusLabel(t.status)}</small></div><div className="copyActions">{cp?.state==="error"&&<button className="retry" onClick={()=>retryCopy(t.hashString)}>Újrapróbálás</button>}<button onClick={()=>copy(t)} disabled={t.percentDone<1||!state?.bridgeOnline||Boolean(copying)||Boolean(done)}>{done?"Átmásolva":copying?"Másolás…":"Másolás WD-re"}</button><button className="deleteBtn" onClick={()=>setDeleteTarget(t)} disabled={!state?.bridgeOnline}>Törlés</button></div></div><div className="bar"><i style={{width:`${Math.max(1,t.percentDone*100)}%`}}></i></div><small>↓ {fmtSpeed(t.rateDownload)} · ↑ {fmtSpeed(t.rateUpload)} · ID {t.id}{t.eta>0&&t.eta<31536000?` · ETA ${fmtDuration(t.eta)}`:""}</small>{cp&&<div className={`copyState ${cp.state}`}><div className="copyStateLine"><span>Másolás: {cp.state==="queued"?"sorban":cp.state==="running"?"folyamatban":cp.state==="done"?`kész → ${cp.destination}`:`hiba${cp.message?` · ${cp.message}`:""}`}</span>{cp.state==="running"&&<b>{copyPct}%</b>}</div>{cp.state==="running"&&<><div className="copyBar"><i style={{width:`${Math.max(1,copyPct)}%`}}></i></div><div className="copyMeta"><span>{fmtBytes(cp.copiedBytes||0)} / {fmtBytes(cp.totalBytes||0)}</span><span>{fmtSpeed(cp.speedBytesPerSec||0)}</span><span>~ {fmtDuration(cp.etaSeconds)}</span></div>{cp.currentFile&&<div className="copyFile">{cp.currentFile}</div>}</>}</div>}</article>})}</div></section></div>}

    {tab==="smart"&&<div className="tabPanel"><section className="panel smartPanel"><div className="sectionHead"><div><h2>Smart Life</h2><p>Tuya Central Europe Cloud · szenzorok, klíma, kapcsolók és Tap-to-Run jelenetek.</p></div><button className="ghost" onClick={refreshSmart}>Frissítés</button></div><div className="filterBar">{(["all","switch","sensor","climate","charger","light","gate","device"] as SmartFilter[]).map(f=><button key={f} className={smartFilter===f?"active":""} onClick={()=>setSmartFilter(f)}>{f==="all"?"Összes":labelKind(f)} <span>{f==="all"?smart.devices.length:smart.devices.filter(d=>deviceKind(d)===f).length}</span></button>)}</div>{!smart.configured&&<div className="empty">Renderben add meg a TUYA_ACCESS_ID, TUYA_ACCESS_SECRET és TUYA_API_ENDPOINT változókat.</div>}{smart.configured&&!smart.online&&<div className="smartError">Tuya kapcsolat: {smart.error||"nem elérhető"}</div>}{smartVisible.length>0&&<div className="smartGrid">{smartVisible.map(d=><SmartDeviceCard key={d.id} device={d} onCommand={smartCommand} onOpen={setDetailTarget}/>)}</div>}{smartVisible.length===0&&smart.devices.length>0&&<div className="empty">Ebben a kategóriában nincs eszköz.</div>}{smart.scenes.length>0&&<div className="scenes"><h3>Jelenetek</h3><div className="sceneGrid">{smart.scenes.map(s=><button className={isDangerous(s.name)?"scene danger":"scene"} key={`${s.homeId||"x"}-${s.id}`} disabled={s.enabled===false} onClick={()=>runScene(s)}>{s.name}{isDangerous(s.name)&&<small>Megerősítés szükséges</small>}</button>)}</div></div>}{smart.online&&smart.scenes.length===0&&<div className="infoLine">Nem érkezett jelenet. Ha a Smart Life-ban vannak Tap-to-Run jelenetek, ellenőrizd a Tuya projekt Scene Management jogosultságát.</div>}</section></div>}

    {tab==="network"&&<div className="tabPanel"><section className="panel networkPanel"><div className="sectionHead"><div><h2>Otthoni hálózati térkép</h2><p>A fizikai topológia, a két Wi-Fi és az élő Bridge mérések egy nézetben.</p></div></div><NetworkTopology network={network}/></section><section className="panel networkPanel"><div className="sectionHead"><div><h2>Élő eszközállapot</h2><p>Ping, ARP és admin-port ellenőrzés a WD Bridge-ről.</p></div><span className="sectionCounter">{network.filter(n=>n.online).length}/{network.length} online</span></div><div className="networkGrid">{network.map(n=><NetworkDeviceCard n={n} key={n.id}/>)}{network.length===0&&<div className="empty">A Bridge még nem küldött hálózati adatot.</div>}</div><div className="infoLine">A D-Link GO-SW-5G és a TP-Link LiteWave LS105G nem menedzselhető, ezért passzív topológiai elemként jelennek meg. Az élő állapotot a mögöttük lévő gépeken mérjük.</div></section></div>}

    {tab==="printer"&&<div className="tabPanel"><section className="panel printerPanel"><div><h2>USB nyomtatómegosztás</h2><p>A KD20 USB Print Server funkcióját használjuk.</p></div><div className="printerStatus"><span className={printer?.online?"statusBadge good":"statusBadge"}>{printer?.online?"Nyomtatószolgáltatás elérhető":"Nyomtató még nincs észlelve"}</span><small>{printer?.note||"A Bridge figyeli a nyomtatóportokat."}</small></div><div className="printerActions">{printer?.adminUrl&&<a className="actionLink" href={printer.adminUrl} target="_blank" rel="noreferrer">KD20 Printer Setting</a>}<span>USB → KD20 → Printer Setting → Enable.</span></div></section><section className="panel helpPanel"><h2>Windows hozzáadás</h2><p>A nyomtató bekapcsolása után a KD20 hálózati print serverét használhatod. A pontos driver a nyomtató típusától függ.</p><div className="stepGrid"><span><b>1</b> Nyomtató USB-n a KD20-ra</span><span><b>2</b> Printer Setting → Enable</span><span><b>3</b> Windowsban hálózati nyomtató hozzáadása</span></div></section></div>}

    {tab==="settings"&&<div className="tabPanel"><section className="panel settings settingsPanel"><div><h2>Torrent automatika</h2><p>A kész torrentet WD-re másolja, a KD20-on seedeléshez megőrzi. A beállítás a WD-n is tartósan mentődik.</p></div><label className="switch"><input type="checkbox" checked={state?.settings.autoCopyEnabled||false} onChange={e=>updateSettings({autoCopyEnabled:e.target.checked})}/><span></span> Automatikus másolás</label><label>Célmappa a WD-n<input value={state?.settings.autoCopyDestination||""} onChange={e=>setState(s=>s?({...s,settings:{...s.settings,autoCopyDestination:e.target.value}}):s)} onBlur={e=>updateSettings({autoCopyDestination:e.target.value})}/></label></section><section className="panel systemInfo"><div><span>Bridge</span><strong>{state?.bridgeOnline?"Online":"Offline"}</strong><small>Utolsó kapcsolat: {bridgeAge(state?.bridgeLastSeenAt)}</small></div><div><span>WD állapotmentés</span><strong>Aktív</strong><small>/DataVolume/homehub/server-state.json</small></div><div><span>HomeHub</span><strong>v0.11.0</strong><small>Kapu- és autótöltő vezérlés + Wi-Fi kliensnézet</small></div></section></div>}
  </main>
}

createRoot(document.getElementById("root")!).render(<App/>);
