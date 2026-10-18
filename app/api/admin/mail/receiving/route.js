import { resolveMx, resolveTxt } from 'node:dns/promises';
import { Resend } from 'resend';
import { session } from '../../../../../lib/server';
import { isSuperAdmin, sameOrigin, webError } from '../../../../../lib/mail-auth';
import { inboundConfiguration, saveInboundConfiguration } from '../../../../../lib/mail-secret';

export const dynamic = 'force-dynamic';
const domainName = 'mds-healthcare.com';
const webhookEndpoint = 'https://email-hosting-sigma.vercel.app/api/mail/receive';

async function requireAdmin() {
  const actor = await session();
  if(!actor) throw Error('AUTH_REQUIRED');
  if(!isSuperAdmin(actor)) throw Error('NO_ACCESS');
}
function providerErrorMessage(e) {
  const status = Number(e?.statusCode||e?.status||0);
  const description=String(e?.message||'');
  if([401,403].includes(status)||/permission|unauthorized|forbidden|restricted|sending_access/i.test(description)) {
    return 'The Resend API key cannot manage domains or webhooks. Use a Resend Full Access API key in this Vercel project.';
  }
  if(status===429) return 'Resend is limiting requests. Please wait a moment and try again.';
  return 'We could not check Resend right now. Try again, or check the Resend dashboard.';
}
function issue(message,status=502) {
  return Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
}
function unpack(response) {
  if(response.error) {
    const error=Object.assign(new Error(response.error.message||'Resend request failed'),{
      statusCode: response.error.statusCode,
      name:response.error.name
    });
    throw error;
  }
  return response.data;
}
function listData(data){return Array.isArray(data?.data)?data.data:[];}
async function findDomain(resend) {
  const info=unpack(await resend.domains.list({limit:100}));
  const domain=listData(info).find(item=>item.name?.toLowerCase()===domainName);
  if(!domain) throw Error('DOMAIN_NOT_FOUND');
  return unpack(await resend.domains.get(domain.id));
}
function requiredInboundMx(domain){
 return (domain?.records||[])
  .filter(r=>{
    if(String(r.type||'').toUpperCase()!=='MX')return false;
    const name=String(r.name||'').toLowerCase().replace(/\.$/,'');
    const label=String(r.record||'').toLowerCase();
    return label.includes('receiv')||['@','',domainName].includes(name);
  })
  .map(r=>({
    name:r.name||'@',
    value:String(r.value||'').toLowerCase().replace(/\.$/,''),
    priority:Number(r.priority||10),
    status:r.status||'unknown'
  }));
}
async function readStatus(){
 const [config,mx,dmarc]=await Promise.all([
  inboundConfiguration(),
  resolveMx(domainName).catch(()=>[]),
  resolveTxt('_dmarc.'+domainName).catch(()=>[])
 ]);
 const currentMX=mx.map(m=>({host:m.exchange.toLowerCase().replace(/\.$/,''),priority:m.priority}));
 const state={
  webhookReady:Boolean(config?.signingSecret),
  endpoint:webhookEndpoint,
  currentMx:currentMX,
  dmarcPresent:dmarc.flat().some(v=>String(v).toLowerCase().startsWith('v=dmarc1')),
  resendReceiving:'unknown',
  resendSending:'unknown',
  domainStatus:'unknown',
  requiredMx:[],
  providerError:null,
  allReady:false
 };
 if(!process.env.RESEND_API_KEY){
  state.providerError='No Resend API key is configured for this project.';
  return state;
 }
 try {
  const resend=new Resend(process.env.RESEND_API_KEY);
  const domain=await findDomain(resend);
  state.domainStatus=domain.status||'unknown';
  state.resendReceiving=domain.capabilities?.receiving||'unknown';
  state.resendSending=domain.capabilities?.sending||'unknown';
  state.requiredMx=requiredInboundMx(domain);
  const expected=state.requiredMx;
  state.dnsReady=expected.length>0?expected.every(r=>currentMX.some(m=>m.host===r.value)):false;
  if(config?.webhookId){
    const webhook=await resend.webhooks.get(config.webhookId);
    if(webhook.error)state.webhookReady=false;
    else state.webhookReady=webhook.data?.status==='enabled' &&
      webhook.data?.endpoint===webhookEndpoint &&
      (webhook.data?.events||[]).includes('email.received');
  }
  state.allReady=state.webhookReady&&state.resendReceiving==='enabled'&&state.dnsReady;
 }catch(e){
  console.error('MDS receiving status lookup failed:',e);
  state.providerError=e.message==='DOMAIN_NOT_FOUND'
   ? 'This Resend API key is not connected to mds-healthcare.com.'
   : providerErrorMessage(e);
 }
 return state;
}
export async function GET(){
 try {await requireAdmin();return Response.json(await readStatus(),{headers:{'Cache-Control':'no-store'}})}
 catch(e){return webError(e,500)}
}
export async function POST(req) {
 try {
  if(!sameOrigin(req))throw Error('INVALID_ORIGIN');
  await requireAdmin();
  if(!process.env.RESEND_API_KEY)return issue('Add a Resend Full Access API key to this Vercel project.',503);
  const resend=new Resend(process.env.RESEND_API_KEY);
  let domain,webhooks;
  try {
   [domain,webhooks]=await Promise.all([
    findDomain(resend),
    resend.webhooks.list({limit:100}).then(unpack)
   ]);
  }catch(e){
   console.error('Resend configuration permissions/check failed',e);
   return issue(e.message==='DOMAIN_NOT_FOUND'
    ? 'The connected Resend account does not contain mds-healthcare.com.'
    : providerErrorMessage(e));
  }
  const hooks=listData(webhooks);
  let target=hooks.find(w=>w.endpoint===webhookEndpoint&&(w.events||[]).includes('email.received'));
  let detail;
  if(target){
   try {
    detail=unpack(await resend.webhooks.get(target.id));
    if(detail.status!=='enabled')unpack(await resend.webhooks.update(target.id,{status:'enabled'}));
   }catch(e){console.error('Webhook recovery failed',e);return issue(providerErrorMessage(e))}
  } else {
   try {
    detail=unpack(await resend.webhooks.create({
      endpoint:webhookEndpoint,events:['email.received']
    }));
   }catch(e){console.error('Resend webhook creation failed',e);return issue(providerErrorMessage(e))}
  }
  if(!detail?.signing_secret||!detail?.id)return issue('The webhook was created, but Resend did not return its signing secret. Open Resend → Webhooks to retrieve it.');
  try {
   await saveInboundConfiguration({
    signingSecret:detail.signing_secret,webhookId:detail.id,endpoint:webhookEndpoint
   });
  }catch(e){
   console.error('Failed to store webhook secret',e);
   return issue('We could not securely save the webhook. Please contact your administrator.');
  }
  if(domain.capabilities?.receiving!=='enabled'){
   try{
    unpack(await resend.domains.update({
      id:domain.id,capabilities:{receiving:'enabled'}
    }));
   }catch(e){
    console.error('Resend domain receive-capability update failed',e);
    return Response.json({
      webhookReady:true,
      warning:'Webhook connected, but Resend could not enable receiving for the domain. '+providerErrorMessage(e),
      needsMxReview:true
    },{status:207});
   }
  }
  const status=await readStatus();
  return Response.json({
   ok:true,webhookReady:status.webhookReady,
   resendReceiving:status.resendReceiving,
   dnsReady:status.dnsReady||false,
   needsMxReview:!status.dnsReady,
   message:status.allReady?'Incoming email is now configured.':'Webhook connected. Check the required MX records before incoming email will be delivered.'
  },{headers:{'Cache-Control':'no-store'}});
 }catch(e){return webError(e,500)}
}
