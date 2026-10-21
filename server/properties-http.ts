import {authenticate,type AuthEnv} from './auth'
import {HttpError,limit,readJson,sameOrigin} from './security'
import {validGeo,watchingCells} from '../shared/multiplayer'
import {propertyId} from '../shared/properties'
import {areaProperties,portfolio,propertyView,purchaseProperty,quoteProperty,refreshProperty,resolveProperty,type RegistryEnv} from './property-registry'
export interface PropertiesEnv extends AuthEnv,RegistryEnv {BACKEND_ENABLED?:string;PROPERTIES_ENABLED?:string;CELLS:DurableObjectNamespace}
export async function propertiesHttp(request:Request,env:PropertiesEnv,ctx?:ExecutionContext){
 const url=new URL(request.url),path=url.pathname
 if(path==='/api/properties/status'&&request.method==='GET')return Response.json({enabled:env.BACKEND_ENABLED==='true'&&env.PROPERTIES_ENABLED==='true'})
 if(env.BACKEND_ENABLED!=='true'||env.PROPERTIES_ENABLED!=='true')throw new HttpError(503,'Global properties are not enabled on this host')
 if(url.origin!==env.APP_ORIGIN||!env.APP_ORIGIN.startsWith('https://'))throw new HttpError(403,'Wrong game origin')
 if(request.method!=='GET')sameOrigin(request,env.APP_ORIGIN)
 const player=await authenticate(request,env.DB);await limit(env.DB,`properties:${player}`,180)
 const cursor=url.searchParams.get('cursor')??'';if(cursor&&!propertyId(cursor))throw new HttpError(400,'Invalid cursor')
 if(path==='/api/properties/portfolio'&&request.method==='GET')return Response.json(await portfolio(env.DB,player,cursor))
 if(path==='/api/properties/area'&&request.method==='GET'){
  const point={lat:Number(url.searchParams.get('lat')),lon:Number(url.searchParams.get('lon'))};if(!url.searchParams.has('lat')||!url.searchParams.has('lon')||!validGeo(point))throw new HttpError(400,'Invalid location')
  return Response.json(await areaProperties(env.DB,point,cursor))
 }
 if(path==='/api/properties/inspect'&&request.method==='POST'){
  await limit(env.DB,`property-inspect:${player}`,12)
  const body=await readJson(request)
  if(!body||Object.keys(body).sort().join(',')!=='lat,lon'||!validGeo(body))throw new HttpError(400,'Select a real-world building')
  const property=await resolveProperty(env,body),quote=await quoteProperty(env.DB,player,property)
  return Response.json({property,quote,playerId:player})
 }
 if(path==='/api/properties/item'&&request.method==='GET'){
  const id=url.searchParams.get('id');if(!propertyId(id))throw new HttpError(400,'Invalid property ID')
  return Response.json({property:await propertyView(env.DB,id),playerId:player})
 }
 if(path==='/api/properties/quote'&&request.method==='POST'){
  await limit(env.DB,`property-inspect:${player}`,12)
  const body=await readJson(request);if(!propertyId(body?.id)||Object.keys(body).length!==1)throw new HttpError(400,'Invalid property ID')
  const property=await refreshProperty(env,body.id);return Response.json({property,quote:await quoteProperty(env.DB,player,property),playerId:player})
 }
 if(path==='/api/properties/purchase'&&request.method==='POST'){
  await limit(env.DB,`property-buy:${player}`,20)
  const receipt=await purchaseProperty(env.DB,player,await readJson(request)),property=await propertyView(env.DB,receipt.propertyId)
  // Best-effort immediate invalidation; authoritative polling repairs missed deliveries/restarts.
  if(env.CELLS){const notify=Promise.allSettled(watchingCells(property).map(cell=>env.CELLS!.get(env.CELLS!.idFromName(cell)).fetch('https://cell/property',{method:'POST',body:JSON.stringify({id:property.id,lat:property.lat,lon:property.lon,revision:property.revision})}))).then(()=>{});if(ctx)ctx.waitUntil(notify);else await notify}
  return Response.json({receipt,property})
 }
 throw new HttpError(404,'Not found')
}
