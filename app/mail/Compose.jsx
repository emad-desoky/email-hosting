'use client';
import {useMemo,useRef,useState} from 'react';
import {createClient} from '@supabase/supabase-js';
import {Paperclip,Send,Save,Trash2,X,Eye,FileImage,FileText,LoaderCircle,CheckCircle2} from 'lucide-react';

const split=input=>String(input||'').split(',').map(s=>s.trim()).filter(Boolean);
const valid=email=>/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
async function request(path,body){
 const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();
 if(!response.ok)throw Error(data.error||'Please try again.');
 return data;
}
export default function Compose({identity,initial,finish,alert}){
 const [to,setTo]=useState((initial?.recipients||[]).join(', '));
 const [cc,setCc]=useState((initial?.cc||[]).join(', '));
 const [bcc,setBcc]=useState((initial?.bcc||[]).join(', '));
 const [subject,setSubject]=useState(initial?.subject||'');
 const [body,setBody]=useState(initial?.body_text||'');
 const [files,setFiles]=useState((initial?.attachments||[]).map(a=>({
    path:a.object_key,filename:a.filename,contentType:a.content_type,size:a.size_bytes
 })));
 const [working,setWorking]=useState(false),[uploading,setUploading]=useState(false);
 const [preview,setPreview]=useState(true),[error,setError]=useState('');
 const inputRef=useRef(null);
 const totalSize=useMemo(()=>files.reduce((n,f)=>n+Number(f.size||0),0),[files]);
 const mailboxId=identity?.mailboxId;
 async function addFiles(e){
   const selected=Array.from(e.target.files||[]);
   e.target.value='';
   if(!selected.length)return;
   if(files.length+selected.length>5){setError('You can attach up to five files per message.');return}
   setUploading(true);setError('');
   try {
     const supabase=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{
       auth:{persistSession:false,autoRefreshToken:false}
     });
     let uploaded=[],bytes=totalSize;
     for(const file of selected){
       if(file.size>10*1024*1024||file.size===0)throw Error('Each file must be smaller than 10 MB.');
       bytes+=file.size;
       if(bytes>20*1024*1024)throw Error('Attachments must be 20 MB or less in total.');
       const ticket=await request('/api/mail/uploads',{mailboxId,filename:file.name,size:file.size,contentType:file.type||'application/octet-stream'});
       const {error:uploadError}=await supabase.storage.from('mail-attachments')
          .uploadToSignedUrl(ticket.path,ticket.token,file,{contentType:ticket.contentType});
       if(uploadError){console.error('File upload:',uploadError);throw Error('Could not upload '+file.name+'. Please try again.')}
       const ref={path:ticket.path,filename:ticket.filename,contentType:ticket.contentType,size:ticket.size};
       uploaded.push(ref);
       setFiles(previous=>[...previous,ref]);
     }
     if(uploaded.length)alert(uploaded.length+(uploaded.length>1?' files attached.':' file attached.'),'success');
   }catch(ex){setError(ex.message||'Could not attach this file.');}
   finally{setUploading(false)}
 }
 function checkAddresses(){
   if(!split(to).length){setError('Enter at least one recipient email address.');return false}
   if(!split(to).every(valid)){setError('Please check the To address. Use name@example.com.');return false}
   if(!split(cc).every(valid)){setError('Please check the CC address or leave it empty.');return false}
   if(!split(bcc).every(valid)){setError('Please check the BCC address or leave it empty.');return false}
   if(!body.trim()){setError('Write a message before sending.');return false}
   return true;
 }
 async function send(e){
   e.preventDefault(); if(working||uploading||!checkAddresses())return;
   setWorking(true);setError('');
   try{
     const data=await request('/api/mail/send',{
       mailboxId,senderEmail:identity.from,to:split(to),cc:split(cc),bcc:split(bcc),
       subject,text:body,attachments:files,draftId:initial?.folder==='drafts'?initial?.id:null
     });
     finish('sent',data.warning||'Your email has been sent.');
   }catch(ex){setError(ex.message||'We could not send your message. Please try again.')}
   finally{setWorking(false)}
 }
 async function save(){
   if(working||uploading)return;
   setWorking(true);setError('');
   try {
     await request('/api/mail/drafts',{id:initial?.folder==='drafts'?initial.id:null,mailboxId,
       senderEmail:identity.from,to,cc,bcc,subject,text:body,attachments:files});
     finish('drafts','Your draft has been saved.');
   }catch(e){setError(e.message||'Could not save your draft.')}
   finally{setWorking(false)}
 }
 const htmlBody=body.split('\n').map((line,i)=><span key={i}>{line}<br/></span>);
 return <div className="compose-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)save()}}>
   <section className="compose-card compose-large" role="dialog" aria-modal="true" aria-label="Compose email">
     <div className="compose-heading"><span><Send size={17}/> New message</span>
       <div className="compose-heading-actions">
          <button className={'icon-btn '+(preview?'selected':'')} title="Toggle live preview" onClick={()=>setPreview(v=>!v)}><Eye size={19}/></button>
          <button className="icon-btn" aria-label="Save and close" title="Save and close" onClick={save} disabled={working||uploading}><X size={19}/></button>
       </div>
     </div>
     <div className={'compose-grid '+(!preview?'no-preview':'')}>
       <form id="mds-compose" className="compose-form" onSubmit={send}>
         <label>From <input readOnly value={identity?.from||''} aria-label="From address"/></label>
         <label>To <input value={to} onChange={e=>setTo(e.target.value)} autoFocus placeholder="person@example.com" aria-label="To"/></label>
         <label>CC <input value={cc} onChange={e=>setCc(e.target.value)} placeholder="Optional" aria-label="CC"/></label>
         <label>BCC <input value={bcc} onChange={e=>setBcc(e.target.value)} placeholder="Optional" aria-label="BCC"/></label>
         <input className="subject-input" value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subject" aria-label="Subject"/>
         <textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Write your message..." aria-label="Message body"/>
         {files.length>0&&<div className="picked-files">
           {files.map((file,i)=><div className="picked-file" key={file.path}>
             {file.contentType.startsWith('image/')?<FileImage size={15}/>:<FileText size={15}/>}
             <span title={file.filename}>{file.filename}</span>
             <small>{(file.size/1024/1024).toFixed(2)} MB</small>
             <button type="button" aria-label={'Remove '+file.filename} title="Remove file" onClick={()=>setFiles(list=>list.filter((_,j)=>j!==i))}><X size={15}/></button>
           </div>)}
         </div>}
         {error&&<div className="compose-warning" role="alert">{error}</div>}
         <div className="compose-footer">
           <div>
             <button type="submit" className="primary-button" disabled={working||uploading}><Send size={16}/>{working?'Sending...':'Send'}</button>
             <button type="button" className="icon-btn" title="Save to drafts" aria-label="Save draft" onClick={save} disabled={working||uploading}><Save size={21}/></button>
             <button type="button" className="icon-btn" title="Attach files or images" aria-label="Attach files or images" disabled={working||uploading} onClick={()=>inputRef.current?.click()}><Paperclip size={21}/></button>
             <input ref={inputRef} type="file" multiple hidden onChange={addFiles} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"/>
             {uploading&&<span className="uploading"><LoaderCircle size={16} className="spin"/> Uploading...</span>}
           </div>
           <button type="button" className="icon-btn" aria-label="Discard message" title="Discard message" onClick={()=>finish('discard')} disabled={working||uploading}><Trash2 size={20}/></button>
         </div>
       </form>
       {preview&&<aside className="live-compose-preview">
         <div className="preview-small-label">LIVE MESSAGE PREVIEW</div>
         <h3>{subject||'Your message subject'}</h3>
         <div className="preview-small-meta"><strong>From</strong> {identity?.from}</div>
         <div className="preview-small-meta"><strong>To</strong> {to||'Add recipients'}</div>
         {cc&&<div className="preview-small-meta"><strong>CC</strong> {cc}</div>}
         <hr/>
         <div className="preview-text">{body?htmlBody:<span className="muted">Your message will appear here as you type...</span>}</div>
         {files.length>0&&<div className="preview-file-meta"><Paperclip size={15}/> {files.length} attachment{files.length>1?'s':''}</div>}
       </aside>}
     </div>
   </section>
 </div>
}
