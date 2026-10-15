import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret=process.env.SUPABASE_SECRET_KEY;
export function configured(){return Boolean(url&&publishable&&secret);}
export function service(){if(!configured())throw Error('Missing Supabase server configuration');return createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})}
export async function session(){const jar=await cookies();const token=jar.get('mds_access')?.value;if(!token)return null;const client=service();const {data,error}=await client.auth.getUser(token);if(error||!data?.user)return null;
const {data:mailbox}=await client.from('mailboxes').select('*').eq('auth_user_id',data.user.id).eq('status','active').maybeSingle();return mailbox||null;}
export function authorized(mailbox,requested){return mailbox?.role==='admin'||mailbox?.id===requested;}
export function cleanAddress(address){const s=String(address||'').toLowerCase().trim();if(!/^[a-z0-9._%+-]+@mds-healthcare\.com$/.test(s))throw Error('Invalid MDS email address');return s;}
export function respond(error,status=400){return Response.json({error:String(error?.message||error)},{status});}
