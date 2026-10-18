import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {service} from './server';
const CONFIG_KEY='resend_inbound';
function key(){
 const s=process.env.SUPABASE_SECRET_KEY;
 if(!s)throw Error('Missing server credentials');
 return createHash('sha256').update('MDS-MAIL::'+s).digest();
}
export function protectSecret(value){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
 const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return iv.toString('base64url')+'.'+cipher.getAuthTag().toString('base64url')+'.'+encrypted.toString('base64url');
}
export function revealSecret(value){
 const parts=String(value).split('.');
 if(parts.length!==3)throw Error('Invalid encrypted integration setting');
 const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(parts[0],'base64url'));
 decipher.setAuthTag(Buffer.from(parts[1],'base64url'));
 return Buffer.concat([decipher.update(Buffer.from(parts[2],'base64url')),decipher.final()]).toString('utf8');
}
export async function inboundConfiguration(){
 const viaEnv=process.env.RESEND_WEBHOOK_SECRET;
 if(viaEnv)return {signingSecret:viaEnv,source:'env'};
 const {data,error}=await service().from('mail_system_config').select('encrypted_value').eq('key',CONFIG_KEY).maybeSingle();
 if(error)throw error;
 if(!data)return null;
 return {...JSON.parse(revealSecret(data.encrypted_value)),source:'database-encrypted'};
}
export async function saveInboundConfiguration(config){
 const {error}=await service().from('mail_system_config').upsert({
   key:CONFIG_KEY,encrypted_value:protectSecret(JSON.stringify(config)),updated_at:new Date().toISOString()
 },{onConflict:'key'});
 if(error)throw error;
}
