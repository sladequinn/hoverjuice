/** Gesture-unlocked, rate-limited synthetic horns; no downloads or looping voices. */
export class TrafficSound {
 enabled=true
 private context:AudioContext|undefined
 private next=0
 constructor(){
  try{this.enabled=localStorage.getItem('hoverjuice.traffic-sound')!=='off'}catch{/* private mode */}
  const unlock=()=>{if(!this.enabled||!('AudioContext' in window))return;this.context??=new AudioContext();void this.context.resume().catch(()=>{})}
  window.addEventListener('pointerdown',unlock);window.addEventListener('keydown',unlock)
 }
 toggle(){this.enabled=!this.enabled;try{localStorage.setItem('hoverjuice.traffic-sound',this.enabled?'on':'off')}catch{/* private mode */}}
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
