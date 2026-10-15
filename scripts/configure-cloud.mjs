// Render deployment config from non-secret GitHub environment variables.
import {readFileSync,writeFileSync} from 'node:fs'
const required=['CF_WORKER_NAME','CF_DATABASE_ID','CF_DATABASE_NAME','APP_ORIGIN','GITHUB_CLIENT_ID','APP_CONTACT']
for(const key of required)if(!process.env[key])throw new Error(`Missing ${key}`)
if(process.env.PROPERTIES_ENABLED==='true'&&!process.env.PROPERTY_SOURCE_URL?.startsWith('https://'))throw new Error('Enabled properties require an HTTPS PROPERTY_SOURCE_URL')
if(process.env.CREWS_ENABLED==='true'&&(process.env.MULTIPLAYER_ENABLED!=='true'||process.env.PROPERTIES_ENABLED!=='true'))throw new Error('Enabled crews require multiplayer and properties')
const origin=new URL(process.env.APP_ORIGIN)
if(origin.protocol!=='https:'||origin.origin!==process.env.APP_ORIGIN)throw new Error('APP_ORIGIN must be an exact HTTPS origin')
if(!/^[a-z0-9-]{1,63}$/.test(process.env.CF_WORKER_NAME))throw new Error('Invalid Worker name')
if(!/^[a-f0-9-]{36}$/i.test(process.env.CF_DATABASE_ID))throw new Error('Invalid D1 database ID')
let config=readFileSync('wrangler.example.toml','utf8')
const values={CREWS_ENABLED:process.env.CREWS_ENABLED==='true'?'true':'false',name:process.env.CF_WORKER_NAME,database_id:process.env.CF_DATABASE_ID,database_name:process.env.CF_DATABASE_NAME,APP_ORIGIN:origin.origin,ALLOWED_ORIGIN:origin.origin,GITHUB_CLIENT_ID:process.env.GITHUB_CLIENT_ID,APP_CONTACT:process.env.APP_CONTACT,BACKEND_ENABLED:'true',PROPERTIES_ENABLED:process.env.PROPERTIES_ENABLED==='true'?'true':'false',PROPERTY_SOURCE_URL:process.env.PROPERTY_SOURCE_URL??'',MULTIPLAYER_ENABLED:process.env.MULTIPLAYER_ENABLED==='true'?'true':'false'}
// "name" also appears inside the DO binding; replace only the first occurrence.
for(const [key,value]of Object.entries(values))config=config.replace(new RegExp(`^${key} = .*`,'m'),()=>`${key} = ${JSON.stringify(value)}`)
writeFileSync('wrangler.toml',config)
