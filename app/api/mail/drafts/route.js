import { session,service } from '../../../../lib/server';
import { getMailbox,sameOrigin,verifiedAttachmentRefs,webError,parseAddresses } from '../../../../lib/mail-auth';
export async function POST(req){
 try{
   if(!sameOrigin(req))throw Error('INVALID_ORIGIN');
   const actor=await session();if(!actor)throw Error('AUTH_REQUIRED');
   const input=await req.json(),box=await getMailbox(actor,input.mailboxId),svc=service();
   const subject=String(input.subject||'').slice(0,250),text=String(input.text||'');
   const refs=verifiedAttachmentRefs(input.attachments||[],box.id);
   const record={mailbox_id:box.id,folder:'drafts',direction:'outgoing',
     sender:String(input.senderEmail||box.sender_email||box.email).slice(0,255),
     recipients:parseAddresses(input.to),cc:parseAddresses(input.cc),bcc:parseAddresses(input.bcc),
     subject,body_text:text,size_bytes:Buffer.byteLength(text)+Buffer.byteLength(subject)+refs.reduce((n,a)=>n+a.size,0),received_at:new Date().toISOString()};
   let id=input.id;
   if(id){
     const {data:exists,error:existsError}=await svc.from('messages').select('id')
       .eq('id',id).eq('mailbox_id',box.id).eq('folder','drafts').maybeSingle();
     if(existsError)throw existsError;
     if(!exists)throw Error('MAIL_NOT_FOUND');
     const {error}=await svc.from('messages').update(record).eq('id',id).eq('mailbox_id',box.id);
     if(error)throw error;
     await svc.from('attachments').delete().eq('message_id',id);
   } else {
     const {data,error}=await svc.from('messages').insert(record).select('id').single();
     if(error)throw error;id=data.id;
   }
   if(refs.length){
     const {error}=await svc.from('attachments').insert(refs.map(a=>({
       message_id:id,object_key:a.path,filename:a.filename,content_type:a.contentType,size_bytes:a.size
     })));
     if(error)throw error;
   }
   return Response.json({id,ok:true});
 }catch(e){return webError(e,500)}
}
