/** Simulation values use metres, seconds and m/s. */
export const LANES = [-3.2, 0, 3.2] as const
export const OVERCLOCK_SPEED = 300 / 3.6
export class RunState {
  hull = 100
  heat = 0
  flow = 1
  flowTTL = 0
  overclock = 0
  limp = -1
  notoriety = 0
  damage(amount: number, armored = false) {
    this.hull = Math.max(0, this.hull - amount * (armored ? 0.5 : 1))
    this.flow = 1; this.flowTTL = 0
    if (this.hull === 0 && this.limp < 0) this.limp = 15
  }
  chain() { this.flow = Math.min(5, this.flow + 0.25); this.flowTTL = 8; this.notoriety++ }
  burn() {
    if (this.overclock > 0 || this.hull <= 25 || this.limp >= 0) return false
    this.hull -= 25; this.overclock = 15; return true
  }
  update(dt: number, cargo: number, tunnel: boolean, rival: boolean, balaclava: boolean) {
    if(this.hull<=0&&this.limp<0)this.limp=15
    this.overclock = Math.max(0, this.overclock - dt)
    this.flowTTL = Math.max(0, this.flowTTL - dt)
    if (!this.flowTTL) this.flow = 1
    const gain = cargo ? Math.min(0.08, cargo * 0.003) * (rival ? (balaclava ? 1.1 : 1.6) : 1) : 0
    const decay = tunnel ? 0.18 : cargo ? 0 : 0.025
    this.heat = Math.max(0, Math.min(5, this.heat + (gain-decay)*dt))
    if (this.limp >= 0) this.limp = Math.max(0, this.limp-dt)
  }
  repair() { this.hull = 100; this.heat = 0; this.limp = -1; this.overclock = 0; this.flow = 1 }
}
