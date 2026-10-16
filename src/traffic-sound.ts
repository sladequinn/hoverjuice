/** Gesture-unlocked, rate-limited synthetic horns; no downloads or looping voices. */
export class TrafficSound {
 enabled=true
 private context:AudioContext|undefined
 private next=0
 private impactNext=0
 private sirenNext=0
 constructor(){
  try{this.enabled=localStorage.getItem('hoverjuice.traffic-sound')!=='off'}catch{/* private mode */}
  const unlock=()=>{if(!this.enabled||!('AudioContext' in window))return;this.context??=new AudioContext();void this.context.resume().catch(()=>{})}
  window.addEventListener('pointerdown',unlock);window.addEventListener('keydown',unlock)
 }
 toggle(){this.enabled=!this.enabled;try{localStorage.setItem('hoverjuice.traffic-sound',this.enabled?'on':'off')}catch{/* private mode */}}
 crash(severity:number){
  const ctx=this.context;if(!this.enabled||!ctx||ctx.state!=='running'||ctx.currentTime<this.impactNext)return;const now=ctx.currentTime;this.impactNext=now+.25
  const buffer=ctx.createBuffer(1,Math.floor(ctx.sampleRate*.18),ctx.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length)
  const source=ctx.createBufferSource(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();source.buffer=buffer;filter.type='lowpass';filter.frequency.value=900;gain.gain.setValueAtTime(Math.min(.18,severity*.005),now);gain.gain.exponentialRampToValueAtTime(.001,now+.18);source.connect(filter);filter.connect(gain);gain.connect(ctx.destination);source.start();source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect()}
 }
 siren(distance:number){
  const ctx=this.context;if(!this.enabled||!ctx||ctx.state!=='running'||distance>180||ctx.currentTime<this.sirenNext)return;const now=ctx.currentTime;this.sirenNext=now+.7
  const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='triangle';osc.frequency.setValueAtTime(650,now);osc.frequency.linearRampToValueAtTime(1000,now+.3);osc.frequency.linearRampToValueAtTime(650,now+.6);gain.gain.setValueAtTime(.025*Math.max(0,1-distance/180),now);gain.gain.linearRampToValueAtTime(0,now+.65);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(now+.66);osc.onended=()=>{osc.disconnect();gain.disconnect()}
 }
 honk(distance:number,side:number,freight:boolean){
  const ctx=this.context
  if(!this.enabled||!ctx||ctx.state!=='running'||ctx.currentTime<this.next)return
  this.next=ctx.currentTime+.8
  const gain=ctx.createGain(),pan=ctx.createStereoPanner(),osc=ctx.createOscillator()
  const now=ctx.currentTime,level=.025*Math.max(0,1-distance/35);pan.pan.value=Math.max(-1,Math.min(1,side));osc.type='sawtooth';osc.frequency.value=freight?180:360
  gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(level,now+.025);gain.gain.setValueAtTime(level*.7,now+.13);gain.gain.linearRampToValueAtTime(0,now+.28)
  osc.connect(gain);gain.connect(pan);pan.connect(ctx.destination);osc.start(now);osc.stop(now+.3)
  osc.onended=()=>{osc.disconnect();gain.disconnect();pan.disconnect()}
 }
}
