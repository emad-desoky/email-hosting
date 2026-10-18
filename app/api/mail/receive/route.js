import { randomUUID } from 'node:crypto';
import { Webhook } from 'svix';
import { Resend } from 'resend';
import { service } from '../../../../lib/server';
import { inboundConfiguration } from '../../../../lib/mail-secret';

function rawAddress(value) {
  const v=String(value||'');
  return (v.match(/<([^<>]+@[^<>]+)>/)?.[1]||v).trim().toLowerCase();
}
export async function POST(req) {
  let config;
  try{config=await inboundConfiguration()}catch(e){console.error('Could not load inbound configuration',e);return Response.json({error:'Receiving unavailable'},{status:503})}
  const secret=config?.signingSecret;
  if(!secret || !process.env.RESEND_API_KEY) {
    console.error('Inbound email is not configured (webhook signing secret missing).');
    return Response.json({error:'Receiving is not configured'},{status:503});
  }
  const raw=await req.text();
  const headers={
    'svix-id':req.headers.get('svix-id'),
    'svix-timestamp':req.headers.get('svix-timestamp'),
    'svix-signature':req.headers.get('svix-signature')
  };
  if(!headers['svix-id']||!headers['svix-signature']||!headers['svix-timestamp'])
    return Response.json({error:'Missing signature'},{status:401});
  let event;
  try{event=new Webhook(secret).verify(raw,headers)}
  catch{return Response.json({error:'Invalid signature'},{status:401})}
  if(event.type!=='email.received')return Response.json({ok:true,skipped:true});
  const remoteId=event.data?.email_id;
  if(!remoteId)return Response.json({error:'Missing incoming message reference'},{status:400});
  try {
    const svc=service(),resend=new Resend(process.env.RESEND_API_KEY);
    const received=await resend.emails.receiving.get(remoteId);
    if(received.error||!received.data)throw Error('Could not retrieve the received message');
    const mail=received.data;
    const to=[...(mail.to||[]),...(mail.cc||[]),...(mail.bcc||[])].map(rawAddress).filter(Boolean);
    if(!to.length)return Response.json({ok:true,skipped:true});
    const {data:direct,error:directError}=await svc.from('mailboxes')
      .select('id,email,status').in('email',to);
    if(directError)throw directError;
    const {data:aliases,error:aliasError}=await svc.from('mail_aliases')
      .select('email,mailbox_id').in('email',to);
    if(aliasError)throw aliasError;
    const aliasIds=[...new Set((aliases||[]).map(a=>a.mailbox_id))];
    let aliasBoxes=[];
    if(aliasIds.length) {
      const q=await svc.from('mailboxes').select('id,email,status').in('id',aliasIds);
      if(q.error)throw q.error; aliasBoxes=q.data||[];
    }
    const boxes=[...(direct||[]),...aliasBoxes]
      .filter((b,i,array)=>b.status==='active'&&array.findIndex(x=>x.id===b.id)===i);
    if(!boxes.length)return Response.json({ok:true,skipped:true});
    let inboundFiles=[];
    try {
      const listing=await resend.emails.receiving.attachments.list({emailId:remoteId});
      const a=listing.data;
      const list=Array.isArray(a)?a:Array.isArray(a?.data)?a.data:[];
      inboundFiles=list.slice(0,5);
    }catch(e){console.error('Inbound attachment listing error',e)}
    for(const box of boxes){
      const {data:existing,error:lookupError}=await svc.from('messages').select('id').eq('mailbox_id',box.id).eq('remote_id',remoteId).maybeSingle();
      if(lookupError)throw lookupError;
      if(existing)continue;
      const body=String(mail.text||''),html=String(mail.html||'');
      const size=Buffer.byteLength(body)+Buffer.byteLength(html)+Buffer.byteLength(String(mail.subject||''));
      const record={
        mailbox_id:box.id,remote_id:remoteId,direction:'incoming',folder:'inbox',
        sender:String(mail.from||''),recipients:Array.isArray(mail.to)?mail.to:[],
        cc:Array.isArray(mail.cc)?mail.cc:[],bcc:Array.isArray(mail.bcc)?mail.bcc:[],
        subject:String(mail.subject||''),body_text:body||null,body_html:html||null,
        size_bytes:size,received_at:mail.created_at||new Date().toISOString()
      };
      const saved=await svc.from('messages').insert(record).select('id').single();
      if(saved.error)throw saved.error;
      for(const item of inboundFiles){
        try {
          const fileUrl=String(item.download_url||'');
          if(!fileUrl.startsWith('https://'))continue;
          const response=await fetch(fileUrl,{signal:AbortSignal.timeout(20000)});
          if(!response.ok)throw Error('Attachment fetch failed');
          const buf=Buffer.from(await response.arrayBuffer());
          if(buf.length>10*1024*1024)continue;
          const name=String(item.filename||'attachment').replace(/[^\p{L}\p{N} ._()-]/gu,'_').slice(0,120);
          const path='mailboxes/'+box.id+'/received/'+randomUUID()+'/'+name;
          const uploaded=await svc.storage.from('mail-attachments').upload(path,buf,{contentType:item.content_type||'application/octet-stream',upsert:false});
          if(uploaded.error)throw uploaded.error;
          const meta=await svc.from('attachments').insert({message_id:saved.data.id,object_key:path,filename:name,content_type:item.content_type||'application/octet-stream',size_bytes:buf.length});
          if(meta.error)throw meta.error;
        }catch(e){console.error('One incoming attachment could not be archived',e)}
      }
    }
    return Response.json({ok:true});
  }catch(e){
    console.error('Inbound mail webhook processing failed',e);
    return Response.json({error:'Temporary processing failure'},{status:503});
  }
}
