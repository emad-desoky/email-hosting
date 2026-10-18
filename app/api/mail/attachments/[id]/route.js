import { session, service } from '../../../../../lib/server';
import { ownsMailbox, webError } from '../../../../../lib/mail-auth';
export async function GET(req,{params}) {
 try {
  const actor=await session();if(!actor)throw Error('AUTH_REQUIRED');
  const {id}=await params;
  const svc=service();
  const {data:record,error}=await svc.from('attachments')
    .select('id,object_key,filename,content_type,size_bytes,messages!inner(mailbox_id)')
    .eq('id',id).maybeSingle();
  if(error)throw error;
  if(!record)throw Error('MAIL_NOT_FOUND');
  if(!ownsMailbox(actor,record.messages.mailbox_id))throw Error('NO_ACCESS');
  const {data:box,error:boxError}=await svc.from('mailboxes')
    .select('status').eq('id',record.messages.mailbox_id).single();
  if(boxError||!box||box.status!=='active')throw Error('ACCOUNT_UNAVAILABLE');
  const {data:file,error:downloadError}=await svc.storage.from('mail-attachments').download(record.object_key);
  if(downloadError||!file)throw Error('MAIL_NOT_FOUND');
  const filename=String(record.filename).replace(/[^\p{L}\p{N} ._()-]/gu,'_').slice(0,130);
  return new Response(file.stream(),{
    status:200,
    headers:{
      'Content-Type':record.content_type||'application/octet-stream',
      'Content-Disposition':'attachment; filename="'+filename.replace(/"/g,'')+'"',
      'X-Content-Type-Options':'nosniff',
      'Cache-Control':'private, no-store'
    }
  });
 }catch(e){return webError(e,500)}
}
