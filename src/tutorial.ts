export type TutorialStage='ready'|'pickup'|'dropoff'|'deal'|'done'|'skipped'
export interface TutorialState {stage:TutorialStage;city?:{lat:number;lon:number};from?:{x:number;z:number};to?:{x:number;z:number}}
export const tutorialActive=(t:TutorialState)=>!['done','skipped'].includes(t.stage)
export function tutorialText(t:TutorialState){
 switch(t.stage){
  case 'ready':return 'FIRST NIGHT · Finding a short courier route. You can skip training.'
  case 'pickup':return '1 / 3 · Follow P to collect the parcel. Push the stick forward or hold GO; pull back to brake.'
  case 'dropoff':return '2 / 3 · Follow X to deliver. No timer. Try BOOST on a straight; MAG-LOCK is optional.'
  case 'deal':return '3 / 3 · Find WHITE LIE’s parked car. Tap Trade, then sell the sealed sample. Cargo attracts Heat.'
  default:return 'First night complete. Take contracts, visit gangs and build your turf.'
 }
}
