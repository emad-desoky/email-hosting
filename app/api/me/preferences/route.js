import { session, service } from '../../../../lib/server';
import { sameOrigin, webError } from '../../../../lib/mail-auth';
export async function PATCH(req) {
 try {
   if(!sameOrigin(req))throw Error('INVALID_ORIGIN');
   const actor=await session();if(!actor)throw Error('AUTH_REQUIRED');
   const input=await req.json();
   if(typeof input.notifications !== 'boolean')return Response.json({error:'Choose whether you want notifications enabled.'},{status:400});
   const next={...(actor.preferences||{}),notifications:input.notifications};
   const {data,error}=await service().from('mailboxes').update({preferences:next}).eq('id',actor.id).eq('auth_user_id',actor.auth_user_id).select('preferences').single();
   if(error)throw error;
   return Response.json({preferences:data.preferences});
 }catch(e){return webError(e,500)}
}
