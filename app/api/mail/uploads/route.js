import { randomUUID } from 'node:crypto';
import { session, service } from '../../../../lib/server';
import { getMailbox, cleanFilename, sameOrigin, MAX_ATTACHMENT, webError } from '../../../../lib/mail-auth';
export async function POST(req) {
 try {
   if(!sameOrigin(req))throw Error('INVALID_ORIGIN');
   const actor=await session();if(!actor)throw Error('AUTH_REQUIRED');
   const input=await req.json();
   const box=await getMailbox(actor,input.mailboxId);
   const size=Number(input.size);
   if(!Number.isSafeInteger(size)||size<=0||size>MAX_ATTACHMENT)throw Error('FILE_TOO_LARGE');
   if(box.used_bytes + size > box.quota_bytes) return Response.json({error:'This mailbox has reached its storage limit.'},{status:413});
   const filename=cleanFilename(input.filename);
   const contentType=String(input.contentType||'application/octet-stream').slice(0,120);
   const path='mailboxes/'+box.id+'/pending/'+randomUUID()+'/'+filename;
   const {data,error}=await service().storage.from('mail-attachments').createSignedUploadUrl(path);
   if(error)throw Error('FILE_UPLOAD_FAILED');
   return Response.json({path:data.path||path,token:data.token,filename,contentType,size},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return webError(e,500)}
}
