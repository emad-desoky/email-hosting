import { session, service } from '../../../../lib/server';
import { isSuperAdmin, webError } from '../../../../lib/mail-auth';
export async function GET() {
 try {
  const actor = await session(); if (!actor) throw Error('AUTH_REQUIRED');
  const svc=service(), admin=isSuperAdmin(actor);
  const {data:boxes,error} = await svc.from('mailboxes').select('id,email,sender_email,display_name,status').eq('status','active').order('email');
  if(error)throw error;
  const owned = admin ? boxes : (boxes||[]).filter(x=>x.id===actor.id);
  let options=[];
  for(const box of owned) {
    const primary=box.sender_email||box.email;
    options.push({mailboxId:box.id, from:primary, label:box.display_name||box.email});
    if(admin && box.email!==primary)options.push({mailboxId:box.id,from:box.email,label:box.email});
  }
  if(admin) {
    const {data:aliases,error:aerr}=await svc.from('mail_aliases').select('mailbox_id,email');
    if(aerr)throw aerr;
    const ids=new Set(owned.map(b=>b.id));
    for(const a of aliases||[])if(ids.has(a.mailbox_id))options.push({mailboxId:a.mailbox_id,from:a.email,label:a.email});
  }
  const unique = Array.from(new Map(options.map(o=>[o.mailboxId+'|'+o.from.toLowerCase(),o])).values());
  return Response.json({admin,identities:unique}, {headers:{'Cache-Control':'no-store'}});
 } catch(e){return webError(e,500)}
}
