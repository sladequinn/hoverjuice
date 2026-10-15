export interface PropertyView {id:string;name:string;lat:number;lon:number;priceMinor:number;ownerId:string|null;ownerName:string|null;status:'active'|'review'|'retired';revision:number;area:number;levels:number;sourceVersion:number;acquiredAt:number|null}
export interface PropertyQuote {id:string;playerId:string;propertyId:string;priceMinor:number;revision:number;expiresAt:number}
export interface PurchaseReceipt {playerId:string;requestId:string;quoteId:string;propertyId:string;priceMinor:number;balance:number;walletVersion:number;createdAt:number}
export const propertyId=(id:unknown):id is string=>typeof id==='string'&&/^osm:(way|relation):[1-9][0-9]{0,15}$/.test(id)
export const requestId=(id:unknown):id is string=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
export const hg=(minor:number)=>`${(minor/100).toLocaleString('en-US',{maximumFractionDigits:2})} HG`
