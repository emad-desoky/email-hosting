import {resolveMx,resolveTxt} from 'node:dns/promises';
import {Resend} from 'resend';
import {session} from '../../../../../lib/server';
import {isSuperAdmin,webError,sameOrigin} from '../../../../../lib/mail-auth';
import {inboundConfiguration,saveInboundConfiguration} from '../../../../../lib/mail-secret';
const url='https://email-hosting-sigma.vercel.app/api/mail/receive';
async function requireAdmin(){
 const actor=await session();
 if(!actor)throw Error('AUTH_REQUIRED');
 if(!isSuperAdmin(actor))throw Error('NO_ACCESS');
 return actor;
}
export async function GET(){
 try{
  await requireAdmin();
  const [config,mx,dmarc]=await Promise.all([
   inboundConfiguration(),
   resolveMx('mds-healthcare.com').catch(()=>[]),
   resolveTxt('_dmarc.mds-healthcare.com').catch(()=>[])
  ]);
  return Response.json({
   webhookReady:Boolean(config),
   endpoint:url,
   incomingMx:mx.map(x=>({host:x.exchange,priority:x.priority})),
   dmarcPresent:dmarc.flat().some(x=>x.toLowerCase().startsWith('v=dmarc1'))
  },{headers:{'Cache-Control':'no-store'}});
 }catch(e){return webError(e,500)}
}
export async function POST(req){
 try{
  if(!sameOrigin(req))throw Error('INVALID_ORIGIN');
  const actor=await requireAdmin();
  let configured=await inboundConfiguration();
  if(configured)return Response.json({webhookReady:true,alreadyConfigured:true,endpoint:url});
  if(!process.env.RESEND_API_KEY)
    return Response.json({error:'Resend is not connected. Please contact your administrator.'},{status:503});
  const resend=new Resend(process.env.RESEND_API_KEY);
  const out=await resend.webhooks.create({endpoint:url,events:['email.received']});
  if(out.error||!out.data?.signing_secret){
    console.error('Could not create receiving webhook',out.error);
    return Response.json({error:'We could not connect incoming mail yet. Please try again later.'},{status:502});
  }
  await saveInboundConfiguration({
    signingSecret:out.data.signing_secret,webhookId:out.data.id,endpoint:url
  });
  return Response.json({webhookReady:true,endpoint:url,requiresMxReview:true});
 }catch(e){return webError(e,500)}
}
