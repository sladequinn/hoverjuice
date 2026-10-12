import {parseRadioConfig,scannerLine,STATIONS,type RadioConfig} from './radio-config'
export class Radio {
 readonly audio=new Audio()
 station='off'
 playing=false
 volume=.45
 status='Radio off'
 config:RadioConfig={}
 private track=0
 private clock:ReturnType<typeof setInterval>|undefined
 private sequence=0
 private generation=0
 private retry=0
 private getContext:()=>{heat:number;speed:number;gang:string}
 constructor(context:()=>{heat:number;speed:number;gang:string}){
  this.getContext=context;this.audio.preload='none'
  try{const v=Number(localStorage.getItem('hoverjuice.radio.volume')??.45);if(Number.isFinite(v))this.volume=Math.max(0,Math.min(1,v))}catch{/* private browser */}
  this.audio.volume=this.volume
  this.audio.addEventListener('ended',()=>{if(this.playing)void this.next()})
  this.audio.addEventListener('error',()=>{if(this.playing&&this.station!=='police'){this.status='Stream unavailable · try Next';this.playing=false}})
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&this.playing)this.pause()})
 }
 async load(){
  const base=(import.meta.env.VITE_API_BASE as string|undefined)?.replace(/\/$/,'')
  try{
   const res=await fetch(base?`${base}/api/radio`:`${import.meta.env.BASE_URL}radio.json`,{signal:AbortSignal.timeout(8000)})
   if(!res.ok)throw Error('Config unavailable')
   this.config=parseRadioConfig(await res.json())
  }catch{this.status='Station config unavailable · scanner available'}
 }
 async select(id:string){
  if(!STATIONS.some(s=>s.id===id)&&id!=='off')return
  this.pause();this.audio.removeAttribute('src');this.audio.load();this.station=id;this.track=0;this.retry=0
  if(id==='off'){this.status='Radio off';return}
  await this.play()
 }
 async play(){
  if(this.station==='off')return
  const token=++this.generation
  if(this.station==='police'){
   this.playing=true;this.dispatch()
   clearInterval(this.clock);this.clock=setInterval(()=>{if(this.playing)this.dispatch()},14000)
   return
  }
  const tracks=this.config[this.station]??[]
  if(!tracks.length){this.status='No broadcast configured';this.playing=false;return}
  const track=tracks[this.track%tracks.length]
  if(this.audio.src!==track.url){this.audio.src=track.url;this.audio.load()}
  this.status=`Tuning · ${track.title}`
  try{await this.audio.play();if(token!==this.generation)return;this.playing=true;this.status=track.title}
  catch{if(token===this.generation){this.playing=false;this.status='Playback blocked or unavailable · tap Play to retry'}}
 }
 pause(){this.generation++;this.playing=false;this.audio.pause();clearInterval(this.clock);this.clock=undefined;if('speechSynthesis' in window)window.speechSynthesis.cancel();this.status=this.station==='off'?'Radio off':'Paused'}
 async next(){
  if(this.station==='police'){if(this.playing)this.dispatch();return}
  // Prevent tight ended loops from malformed zero-duration media.
  if(Date.now()-this.retry<1000){this.pause();this.status='Broadcast ended · tap Next';return}
  this.retry=Date.now();this.track++;await this.play()
 }
 setVolume(value:number){if(!Number.isFinite(value))return;this.volume=Math.max(0,Math.min(1,value));this.audio.volume=this.volume;try{localStorage.setItem('hoverjuice.radio.volume',String(this.volume))}catch{/* private browser */}}
 private dispatch(){
  const c=this.getContext();this.status=scannerLine(c.heat,c.speed,c.gang,this.sequence++)
  if('speechSynthesis' in window){window.speechSynthesis.cancel();const line=new SpeechSynthesisUtterance(this.status);line.rate=1.08;line.pitch=.75;line.volume=this.volume;window.speechSynthesis.speak(line)}
 }
}
