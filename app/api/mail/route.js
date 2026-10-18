import {session,service,respond} from '../../../lib/server';
import {getMailbox,webError,sameOrigin} from '../../../lib/mail-auth';

const folders=['inbox','sent','drafts','archive','spam','trash'];
const visibleFolders=[...folders,'all','starred','unread'];
const response=data=>Response.json(data,{headers:{'Cache-Control':'private, no-store'}});

export async function GET(req){
  try{
    const actor=await session();
    if(!actor)throw Error('AUTH_REQUIRED');
    const url=new URL(req.url);
    const box=await getMailbox(actor,url.searchParams.get('mailbox'));
    const svc=service();
    const mode=url.searchParams.get('mode');

    if(mode==='notifications'){const {data,error}=await svc.from('messages').select('id,sender,subject,ingested_at,read_at').eq('mailbox_id',box.id).eq('direction','incoming').eq('folder','inbox').order('ingested_at',{ascending:false}).limit(20);if(error)throw error;return response({messages:data||[]});}
    if(mode==='counts'){
      const {data,error}=await svc.from('messages')
        .select('folder,read_at,starred').eq('mailbox_id',box.id).limit(5000);
      if(error)throw error;
      const counts={unread:0,starred:0,all:0};
      for(const item of data||[]){
        counts[item.folder]=(counts[item.folder]||0)+1;
        if(item.starred)counts.starred+=1;
        if(item.folder==='inbox'&&!item.read_at)counts.unread+=1;
        if(['inbox','sent','archive','drafts'].includes(item.folder))counts.all+=1;
      }
      return response({counts});
    }

    if(mode==='detail'){
      const id=url.searchParams.get('id')||'';
      if(!/^[0-9a-f-]{36}$/i.test(id))return respond('Choose a message first.');
      const {data,error}=await svc.from('messages')
        .select('id,sender,recipients,cc,bcc,subject,body_text,body_html,folder,direction,received_at,read_at,starred,size_bytes,remote_id,attachments(id,object_key,filename,content_type,size_bytes)')
        .eq('mailbox_id',box.id).eq('id',id).maybeSingle();
      if(error)throw error;
      if(!data)throw Error('MAIL_NOT_FOUND');
      return response({message:data});
    }

    const folder=url.searchParams.get('folder')||'inbox';
    if(!visibleFolders.includes(folder))return respond('Please choose a valid folder.');
    const rawSize=Number(url.searchParams.get('pageSize')||20);
    const pageSize=[10,20,40].includes(rawSize)?rawSize:20;
    const page=Math.max(0,Math.min(100000,Number.parseInt(url.searchParams.get('page')||'0',10)||0));
    let query=svc.from('messages')
      .select('id,sender,recipients,cc,bcc,subject,body_text,folder,direction,received_at,read_at,starred,size_bytes,remote_id,attachments(id,object_key,filename,content_type,size_bytes)',{count:'exact'})
      .eq('mailbox_id',box.id);

    if(folders.includes(folder))query=query.eq('folder',folder);
    else if(folder==='starred')query=query.eq('starred',true).neq('folder','trash');
    else if(folder==='unread')query=query.eq('folder','inbox').is('read_at',null);
    else query=query.in('folder',['inbox','sent','archive','drafts']);

    const rawSearch=(url.searchParams.get('q')||'').trim().slice(0,80);
    if(rawSearch){
      const safe=rawSearch.replace(/[,()%\\]/g,'');
      if(safe)query=query.or('subject.ilike.%'+safe+'%,sender.ilike.%'+safe+'%,body_text.ilike.%'+safe+'%');
    }

    const first=page*pageSize;
    const {data,error,count}=await query
      .order('received_at',{ascending:false})
      .order('id',{ascending:false})
      .range(first,first+pageSize-1);
    if(error)throw error;
    const total=Number(count||0);
    return response({messages:data||[],page,pageSize,total,totalPages:Math.max(1,Math.ceil(total/pageSize)),hasMore:first+pageSize<total});
  }catch(e){return webError(e,500)}
}

export async function PATCH(req){
  try{
    if(!sameOrigin(req))throw Error('INVALID_ORIGIN');
    const actor=await session();
    if(!actor)throw Error('AUTH_REQUIRED');
    const input=await req.json();
    const ids=[...new Set([...(Array.isArray(input.ids)?input.ids:[]),...(input.id?[input.id]:[])])].slice(0,100);
    const box=await getMailbox(actor,input.mailboxId);
    if(!ids.length)return respond('Please select at least one message.');
    const changes={};
    if(input.folder!==undefined){
      if(!folders.includes(input.folder))return respond('Please choose a valid folder.');
      changes.folder=input.folder;
    }
    if(input.read!==undefined)changes.read_at=input.read?new Date().toISOString():null;
    if(input.starred!==undefined)changes.starred=Boolean(input.starred);
    if(!Object.keys(changes).length)return respond('Nothing to update.');
    const {error}=await service().from('messages').update(changes)
      .eq('mailbox_id',box.id).in('id',ids);
    if(error)throw error;
    return response({ok:true});
  }catch(e){return webError(e,500)}
}
