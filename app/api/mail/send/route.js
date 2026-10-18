import { Resend } from 'resend';
import { session, service } from '../../../../lib/server';
import { getMailbox, sameOrigin, parseAddresses, addressesValid, verifiedAttachmentRefs, MAX_COMBINED, webError } from '../../../../lib/mail-auth';

export async function POST(req) {
  try {
    if (!sameOrigin(req)) throw Error('INVALID_ORIGIN');
    const actor=await session();
    if(!actor)throw Error('AUTH_REQUIRED');
    if(!process.env.RESEND_API_KEY)throw Error('DELIVERY_FAILED');

    const input=await req.json();
    const box=await getMailbox(actor,input.mailboxId);
    const to=parseAddresses(input.to), cc=parseAddresses(input.cc), bcc=parseAddresses(input.bcc);
    if(!to.length)throw Error('NO_RECIPIENT');
    if(to.length+cc.length+bcc.length>50)throw Error('TOO_MANY_RECIPIENTS');
    if(!addressesValid(to))throw Error('INVALID_TO');
    if(!addressesValid(cc))throw Error('INVALID_CC');
    if(!addressesValid(bcc))throw Error('INVALID_BCC');
    const subject=String(input.subject||'').trim().slice(0,250);
    const text=String(input.text||''), html=String(input.html||'');
    if(!text.trim()&&!html.trim())throw Error('NO_CONTENT');
    const requestedFrom=String(input.senderEmail||box.sender_email||box.email).toLowerCase().trim();
    const svc=service();
    let senderAllowed=requestedFrom===box.email||requestedFrom===box.sender_email;
    if(!senderAllowed) {
      const {data:alias,error:ae}=await svc.from('mail_aliases')
        .select('id').eq('mailbox_id',box.id).eq('email',requestedFrom).maybeSingle();
      if(ae)throw ae;
      senderAllowed=Boolean(alias);
    }
    if(!senderAllowed)throw Error('NO_ACCESS');
    const refs=verifiedAttachmentRefs(input.attachments||[],box.id);
    const assets=[];let attachedBytes=0;
    for(const ref of refs) {
      const file=await svc.storage.from('mail-attachments').download(ref.path);
      if(file.error||!file.data)throw Error('FILE_INVALID');
      const content=Buffer.from(await file.data.arrayBuffer());
      if(content.length!==ref.size)throw Error('FILE_INVALID');
      attachedBytes+=content.length;
      if(attachedBytes>MAX_COMBINED)throw Error('FILE_TOO_LARGE');
      assets.push({...ref,content});
    }
    const approxBytes=Buffer.byteLength(text,'utf8')+Buffer.byteLength(html,'utf8')+
      Buffer.byteLength(subject,'utf8')+attachedBytes;
    if(box.used_bytes+approxBytes>box.quota_bytes)
      return Response.json({error:'This mailbox has reached its storage limit. Free some space before sending.'},{status:413});
    const payload={
      from: requestedFrom,to,subject,
      ...(cc.length?{cc}:{}),...(bcc.length?{bcc}:{}),
      ...(text?{text}:{}),...(html?{html}:{}),
      ...(input.inReplyTo?{headers:{'In-Reply-To':String(input.inReplyTo).slice(0,250)}}:{})
    };
    if(assets.length)payload.attachments=assets.map(a=>({filename:a.filename,content:a.content,contentType:a.contentType}));
    const sent=await new Resend(process.env.RESEND_API_KEY).emails.send(payload);
    if(sent.error){console.error('Resend delivery rejected',sent.error);throw Error('DELIVERY_FAILED');}
    const {data:message,error:storeError}=await svc.from('messages').insert({
      mailbox_id:box.id,remote_id:sent.data?.id||null,direction:'outgoing',folder:'sent',
      sender:requestedFrom,recipients:to,cc,bcc,subject,body_text:text||null,body_html:html||null,
      size_bytes:approxBytes,read_at:new Date().toISOString(),in_reply_to:input.inReplyTo||null
    }).select('id').single();
    if(storeError||!message){
      console.error('Sent email storage failed',storeError);
      await svc.from('audit_events').insert({actor_id:actor.id,mailbox_id:box.id,action:'mail.send_archive_failed',details:{remote_id:sent.data?.id||null}});
      return Response.json({ok:true,id:sent.data?.id,warning:'Message sent, but its copy could not be saved to Sent.'},{status:202});
    }
    if(assets.length){
      const rows=assets.map(a=>({message_id:message.id,object_key:a.path,filename:a.filename,content_type:a.contentType,size_bytes:a.size}));
      const {error:attachError}=await svc.from('attachments').insert(rows);
      if(attachError)console.error('Sent attachment metadata error',attachError);
    }
    if(input.draftId){
      const {data:oldDraft}=await svc.from('messages').select('id').eq('id',input.draftId).eq('mailbox_id',box.id).eq('folder','drafts').maybeSingle();
      if(oldDraft)await svc.from('messages').delete().eq('id',oldDraft.id).eq('mailbox_id',box.id).eq('folder','drafts');
    }
    return Response.json({ok:true,id:sent.data?.id||null},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return webError(e,500);}
}
