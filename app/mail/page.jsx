'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import Compose from './Compose';
import {
 Inbox,Send,PenLine,Menu,Search,Star,Archive,Trash2,NotebookPen,ShieldAlert,
 RefreshCw,Settings,LogOut,ChevronLeft,ChevronRight,Sun,Moon,Bell,Reply,Forward,
 CheckCheck,MailOpen,X,Users,Check,Mail,Printer,Paperclip,Save,AlertCircle,Eye,LoaderCircle
} from 'lucide-react';

const FOLDERS=[['inbox',Inbox,'Inbox'],['starred',Star,'Starred'],['sent',Send,'Sent'],
 ['drafts',NotebookPen,'Drafts'],['all',Mail,'All mail'],['archive',Archive,'Archive'],
 ['spam',ShieldAlert,'Spam'],['trash',Trash2,'Trash']];
const date=v=>new Date(v).toLocaleDateString([],{month:'short',day:'numeric'});
async function api(path,opts={}){
 let res;
 try {res=await fetch(path,{cache:'no-store',credentials:'same-origin',...opts})}
 catch{throw Error('Unable to connect. Check your internet connection and try again.')}
 if(res.status===401){location.assign('/login');throw Error('Please sign in again.')}
 let body;try{body=await res.json()}catch{throw Error('The mail service is temporarily unavailable. Please try again.')}
 if(!res.ok)throw Error(body.error && body.error.length<180 && !body.error.includes('stack')?body.error:'Something went wrong. Please try again.');
 return body;
}
function Icon({icon:Component,title,onClick,active=false,disabled=false}){
 return <button type="button" className={'icon-btn '+(active?'selected':'')} title={title} aria-label={title} disabled={disabled} onClick={onClick}><Component size={19}/></button>
}
function Empty({title,compose}){return <div className="empty-state"><div className="empty-illustration"><Mail size={29}/></div><h3>Nothing in {title.toLowerCase()}</h3><p>Messages will appear here when they are available.</p><button className="outline-btn" onClick={compose}><PenLine size={17}/> Compose</button></div>}

export default function MailPage(){
 const [user,setUser]=useState(null),[identities,setIdentities]=useState([]),[identity,setIdentity]=useState(null);
 const [folder,setFolder]=useState('inbox'),[list,setList]=useState([]),[counts,setCounts]=useState({});
 const [selected,setSelected]=useState(null),[checked,setChecked]=useState([]),[compose,setCompose]=useState(null);
 const [term,setTerm]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(0),[hasMore,setHasMore]=useState(false);
 const [theme,setTheme]=useState('dark'),[mobile,setMobile]=useState(false),[settings,setSettings]=useState(false);
 const [notificationPanel,setNotificationPanel]=useState(false),[preferences,setPreferences]=useState({notifications:false}),[preferenceBusy,setPreferenceBusy]=useState(false);
 const [notice,setNotice]=useState(null),[loading,setLoading]=useState(true);
 const [receiving,setReceiving]=useState(null),[receivingBusy,setReceivingBusy]=useState(false);
 const lastUnread=useRef(new Map()),queryRef=useRef(null),toastTimer=useRef(null);
 const boxId=identity?.mailboxId,userIsAdmin=user?.role==='admin'&&user.email==='mds2026@mds-healthcare.com';
 const message=list.find(m=>m.id===selected),unread=Number(counts.unread||0);
 const tell=(message,kind='success')=>{setNotice({message,kind});clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setNotice(null),5000)};
 const load=useCallback(async(showToast=false)=>{
  if(!boxId)return;
  try{
   const qs=new URLSearchParams({mailbox:boxId,folder,page:String(page)});
   if(term)qs.set('q',term);
   const [m,c]=await Promise.all([api('/api/mail?'+qs),api('/api/mail?mode=counts&mailbox='+boxId)]);
   setList(m.messages||[]);setHasMore(Boolean(m.hasMore));setCounts(c.counts||{});
   const count=Number(c.counts?.unread||0),before=lastUnread.current.get(boxId);
   if(before!==undefined && count>before && preferences.notifications){
    tell(count-before===1?'You have a new email.':'You have '+(count-before)+' new emails.');
    if(typeof Notification!=='undefined'&&Notification.permission==='granted')
       new Notification('MDS Mail',{body:'New mail received in your inbox.'});
   }
   lastUnread.current.set(boxId,count);
  }catch(e){if(showToast)tell(e.message,'error')}
  finally{setLoading(false)}
 },[boxId,folder,term,page,preferences.notifications]);

 useEffect(()=>{
  if(typeof window!=='undefined')setTheme(localStorage.getItem('mds-mail-theme')||'dark');
  Promise.all([api('/api/me'),api('/api/mail/identities')]).then(([m,ids])=>{
    setUser(m.user);setPreferences(m.user.preferences||{notifications:false});
    setIdentities(ids.identities||[]);
    const initial=(ids.identities||[]).find(x=>x.mailboxId===m.user.id&&x.from===(m.user.sender_email||m.user.email))||
       (ids.identities||[]).find(x=>x.mailboxId===m.user.id);
    if(initial)setIdentity(initial);
    else tell('Your mailbox is not yet configured. Please contact your administrator.','error');
  }).catch(e=>tell(e.message,'error'));
  return()=>clearTimeout(toastTimer.current)
 },[]);
 useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('mds-mail-theme',theme)},[theme]);
 useEffect(()=>{if(settings&&userIsAdmin){api('/api/admin/mail/receiving').then(setReceiving).catch(()=>setReceiving(null))}},[settings,userIsAdmin]);
 useEffect(()=>{if(!boxId)return;load(true);const timer=setInterval(()=>{if(!document.hidden)load(false)},18000);return()=>clearInterval(timer)},[load,boxId]);
 useEffect(()=>{
   const key=e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();queryRef.current?.focus()}
    if(e.key==='Escape'){setCompose(null);setSelected(null);setMobile(false);setSettings(false)}
    if(e.key.toLowerCase()==='c'&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)&&!compose){openCompose()}
   };
   window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)
 },[identity,compose]);

 function folderTo(f){setFolder(f);setSelected(null);setPage(0);setQuery('');setTerm('');setMobile(false);setChecked([])}
 function switchTo(value){
  const next=identities.find(i=>i.mailboxId+'|'+i.from===value);
  if(next){setIdentity(next);setSelected(null);setChecked([]);setPage(0);setList([])}
 }
 function openCompose(mode='new',mail=null){
  if(!identity)return tell('Your mailbox is loading. Please try again.','error');
  if(mode==='draft')setCompose(mail);
  else if(mail){
   const label=mode==='reply'?'Re: ':'Fwd: ';
   const recipient=mode==='reply'?mail.sender:'';
   setCompose({recipients:recipient?[recipient]:[],cc:[],bcc:[],subject:label+(mail.subject||''),
     body_text:'\n\n----- Original message -----\nFrom: '+mail.sender+'\n\n'+(mail.body_text||'')});
  }else setCompose({});
  setSelected(null);setMobile(false);
 }
 async function modify(ids,change){
   if(!ids?.length)return;
   try{
    await api('/api/mail',{method:'PATCH',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({mailboxId:boxId,ids,...change})});
    setChecked([]);
    if(change.folder&&selected&&ids.includes(selected))setSelected(null);
    await load();
   }catch(e){tell(e.message,'error')}
 }
 async function openMessage(msg){
   if(msg.folder==='drafts'){openCompose('draft',msg);return}
   setSelected(msg.id);
   if(!msg.read_at)await modify([msg.id],{read:true});
 }
 async function enableReceiving(){
  setReceivingBusy(true);
  try{
   const out=await api('/api/admin/mail/receiving',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   const status=await api('/api/admin/mail/receiving');setReceiving(status);
   tell(out.alreadyConfigured?'Incoming processing is already enabled.':'Incoming webhook connected. Check the domain DNS next.');
  }catch(e){tell(e.message,'error')}
  finally{setReceivingBusy(false)}
 }
 async function toggleNotifs(){
  if(preferenceBusy)return;
  const enable=!Boolean(preferences.notifications);
  setPreferenceBusy(true);
  try{
   let permission='';
   if(enable&&typeof Notification!=='undefined'&&Notification.permission==='default')
     permission=await Notification.requestPermission();
   else if(enable&&typeof Notification!=='undefined')permission=Notification.permission;
   const out=await api('/api/me/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({notifications:enable})});
   setPreferences(out.preferences);
   if(!enable)tell('Email notifications are now turned off.');
   else if(permission==='denied')tell('In-app alerts are on. Allow notifications in your browser settings to get desktop alerts.');
   else tell('Email notifications enabled.');
  }catch(e){tell(e.message,'error')}finally{setPreferenceBusy(false)}
 }
 const currentFolder=FOLDERS.find(x=>x[0]===folder)?.[2]||'Unread';
 const finishCompose=(kind,info)=>{
   setCompose(null);
   if(kind!=='discard'){if(info)tell(info); if(kind==='sent')folderTo('sent');else if(kind==='drafts')folderTo('drafts');}
   else tell('Message discarded.');
   load();
 };
 const signout=()=>fetch('/api/auth/logout',{method:'POST'}).finally(()=>location.assign('/login'));
 const previewHTML=message?.body_html?
  '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data:; style-src &#39;unsafe-inline&#39;; font-src data:;">'
   +'<style>body{font:14px/1.75 system-ui,Arial;color:#17212d;overflow-wrap:anywhere}img{max-width:100%}</style>'+message.body_html:'';

 return <div className="app-shell">
  <aside className={'left-rail '+(mobile?'mobile-open':'')}>
    <div className="brand-wrap"><img src="/mds-logo.png" className="brand-logo" alt="Medical Digital Solutions" /></div>
    <div className="rail-separator"/>
    <button className="compose-cta" onClick={()=>openCompose()}><PenLine size={20}/> Compose <span className="compose-plus">+</span></button>
    <div className="nav-label">YOUR WORKSPACE</div>
    <nav className="folder-nav">{FOLDERS.map(([name,C,title])=><button key={name} className={'folder-item '+(folder===name?'active':'')} onClick={()=>folderTo(name)}>
      <C size={19}/><span>{title}</span>{name==='inbox'&&unread>0&&<em>{unread}</em>}
    </button>)}</nav>
    <div className="rail-divider"/>
    {userIsAdmin&&<Link href="/admin" className="folder-item admin-link"><Users size={19}/><span>Admin console</span></Link>}
    <button className="folder-item" onClick={()=>{setSettings(true);setMobile(false)}}><Settings size={19}/><span>Settings</span></button>
    <div className="rail-bottom"><div className="storage-head"><span>Storage</span><span>{(Number(user?.used_bytes||0)/1048576).toFixed(1)} MB / {(Number(user?.quota_bytes||0)/1073741824).toFixed(1)} GB</span></div>
    <div className="storage-track"><span style={{width:Math.min(100,100*Number(user?.used_bytes||0)/Math.max(1,Number(user?.quota_bytes||1)))+'%'}}/></div>
    <div className="rail-account"><div className="avatar">{(user?.display_name||'M')[0]}</div><div><strong>{user?.display_name||'MDS Mail'}</strong><small>{user?.email}</small></div>
    <Icon icon={LogOut} title="Sign out" onClick={signout}/></div></div>
  </aside>
  {mobile&&<button className="nav-scrim" aria-label="Close menu" onClick={()=>setMobile(false)}/>}
  <section className="workspace">
   <header className="topbar"><div className="top-title"><div className="eyebrow">MEDICAL DIGITAL SOLUTIONS · BUSINESS MAIL</div>
    <h1>Your <span className="title-gradient">workspace.</span></h1><p>Stay connected, with clarity.</p></div>
    <div className="top-actions"><div className="searchbox"><Search size={19}/><form onSubmit={e=>{e.preventDefault();setTerm(query.trim());setPage(0)}}>
      <input ref={queryRef} placeholder="Search mail..." aria-label="Search mail" value={query} onChange={e=>setQuery(e.target.value)}/></form><kbd>⌘K</kbd></div>
      <Icon icon={theme==='dark'?Sun:Moon} title="Change appearance" onClick={()=>setTheme(theme==='dark'?'light':'dark')}/>
      <Icon icon={Bell} title="Notifications" active={preferences.notifications} onClick={()=>setNotificationPanel(v=>!v)}/>
      <div className="profile-initial">{(user?.display_name||'M')[0]}</div>
    </div>
   </header>
   <div className="mailbox-chooser"><span>{userIsAdmin?'Send and read as':'Signed in as'}</span>
   {userIsAdmin?<select aria-label="Select mail account" value={identity?identity.mailboxId+'|'+identity.from:''} onChange={e=>switchTo(e.target.value)}>
     {identities.map(i=><option key={i.mailboxId+'|'+i.from} value={i.mailboxId+'|'+i.from}>{i.from}</option>)}
    </select>:<span className="account-readonly">{identity?.from||user?.email||'Loading...'}</span>}
    <span className="identity-badge">PRIVATE WORKSPACE</span>
   </div>
   <div className="workboard">
    <div className="messages-panel">
     <div className="panel-heading"><div><span className="section-kicker">YOUR MESSAGES</span><h2>{currentFolder} <span className="heading-count">{folder==='inbox'?unread:list.length}</span></h2></div>
       <div className="heading-actions"><Icon icon={RefreshCw} title="Refresh inbox" onClick={()=>load(true)}/></div></div>
     <div className="mail-filters"><button className={'filter-chip '+(folder==='inbox'?'active':'')} onClick={()=>folderTo('inbox')}>All</button>
       <button className={'filter-chip '+(folder==='unread'?'active':'')} onClick={()=>folderTo('unread')}>Unread</button>
       <button className={'filter-chip '+(folder==='starred'?'active':'')} onClick={()=>folderTo('starred')}>Starred</button>
       <span className="row-count">{list.length} messages</span></div>
     {checked.length>0&&<div className="bulkbar"><span>{checked.length} selected</span>
       <Icon icon={MailOpen} title="Mark as read" onClick={()=>modify(checked,{read:true})}/>
       <Icon icon={CheckCheck} title="Mark unread" onClick={()=>modify(checked,{read:false})}/>
       <Icon icon={Archive} title="Archive" onClick={()=>modify(checked,{folder:'archive'})}/>
       <Icon icon={Trash2} title="Move to Trash" onClick={()=>modify(checked,{folder:'trash'})}/>
       <Icon icon={X} title="Cancel selection" onClick={()=>setChecked([])}/></div>}
     <div className="messages-scroll">
       {!loading&&list.length===0?<Empty title={currentFolder} compose={()=>openCompose()}/>:list.map(m=><div key={m.id} className={'message-item '+(selected===m.id?'chosen ':'')+(!m.read_at?'unseen':'')}>
         <label className="check-area"><input type="checkbox" aria-label={'Select '+m.subject} checked={checked.includes(m.id)} onChange={()=>setChecked(s=>s.includes(m.id)?s.filter(id=>id!==m.id):[...s,m.id])}/></label>
         <button className="message-open" onClick={()=>openMessage(m)}><div className="message-line"><span className="sender-avatar">{(m.sender||'M')[0].toUpperCase()}</span><strong>{m.direction==='outgoing'?m.recipients?.[0]:m.sender}</strong><time>{date(m.received_at)}</time></div>
          <div className="subject-line">{m.subject||'(No subject)'}{m.attachments?.length>0&&<Paperclip size={14}/>}</div>
          <p>{(m.body_text||'HTML message').replace(/\s+/g,' ').slice(0,100)}</p></button>
         <button className={'star-button '+(m.starred?'is-starred':'')} aria-label={m.starred?'Remove star':'Star'} onClick={()=>modify([m.id],{starred:!m.starred})}><Star size={18} fill={m.starred?'currentColor':'none'}/></button>
       </div>)}
       {loading&&list.length===0&&<div className="empty-state"><LoaderCircle className="spin" size={28}/><p>Loading your mail...</p></div>}
     </div>
     <div className="messages-bottom"><span>{list.length} messages</span><div><Icon icon={ChevronLeft} title="Previous page" disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}/>
       <Icon icon={ChevronRight} title="Next page" disabled={!hasMore} onClick={()=>setPage(p=>p+1)}/></div></div>
    </div>
    <section className={'preview-panel '+(message?'preview-open':'')}>
     <div className="preview-header"><span className="section-kicker">MESSAGE PREVIEW</span>{message&&<div className="preview-actions"><Icon icon={Printer} title="Print" onClick={()=>window.print()}/><Icon icon={X} title="Close preview" onClick={()=>setSelected(null)}/></div>}</div>
     {message?<article className="preview-content">
       <div className="preview-subject"><span className="eyebrow">CONVERSATION</span><h2>{message.subject||'(No subject)'}</h2><div className="preview-meta">{new Date(message.received_at).toLocaleString()}</div></div>
       <div className="sender-card"><div className="sender-avatar large">{message.sender?.[0]?.toUpperCase()||'M'}</div><div><strong>{message.sender}</strong><small>To: {message.recipients?.join(', ')}</small>
         {message.cc?.length>0&&<small>CC: {message.cc.join(', ')}</small>}</div></div>
       <div className="mail-body">{message.body_text?<div className="plain-email">{message.body_text}</div>:
        message.body_html?<iframe title="Email HTML content" className="html-frame" sandbox="" referrerPolicy="no-referrer" srcDoc={previewHTML}/>:
        <p className="muted">This email has no message body.</p>}</div>
       {message.attachments?.length>0&&<div className="attachment-bar"><strong>Attachments</strong><div className="attachment-downloads">{message.attachments.map(a=><a key={a.id} className="attachment-pill" href={'/api/mail/attachments/'+a.id}><Paperclip size={16}/>{a.filename}<small>{(a.size_bytes/1048576).toFixed(2)} MB</small></a>)}</div></div>}
       <div className="preview-footer"><button className="primary-button" onClick={()=>openCompose('reply',message)}><Reply size={17}/> Reply</button>
        <button className="outline-btn" onClick={()=>openCompose('forward',message)}><Forward size={17}/> Forward</button>
        <button className="outline-btn" onClick={()=>modify([message.id],{folder:'archive'})}><Archive size={17}/> Archive</button>
        <button className="outline-btn" onClick={()=>modify([message.id],{read:!message.read_at})}>{message.read_at?<Mail size={17}/>:<MailOpen size={17}/>} {message.read_at?'Mark unread':'Mark read'}</button>
        <Icon icon={Trash2} title="Move to Trash" onClick={()=>modify([message.id],{folder:'trash'})}/>
       </div>
     </article>:<div className="preview-empty"><div className="preview-art"><Mail size={56}/></div><span className="preview-empty-eyebrow">YOUR READING SPACE</span><h3>Make room for clarity.</h3><p>Select a message to preview it here, or compose a new one.</p>
       <button className="outline-btn" onClick={()=>openCompose()}><PenLine size={17}/> Write a message</button></div>}
    </section>
   </div>
  </section>
  <nav className="mobile-bottom" aria-label="Mobile navigation"><button className={folder==='inbox'?'active':''} onClick={()=>folderTo('inbox')}><Inbox size={22}/><span>Inbox</span></button>
    <button className={folder==='sent'?'active':''} onClick={()=>folderTo('sent')}><Send size={22}/><span>Sent</span></button>
    <button onClick={()=>openCompose()}><PenLine size={22}/><span>Compose</span></button>
    <button onClick={()=>setMobile(v=>!v)}><Menu size={22}/><span>More</span></button>
  </nav>
  {compose&&<Compose key={compose.id||'new'} initial={compose} identity={identity} finish={finishCompose} alert={tell}/>}
  {settings&&<div className="settings-shade" onMouseDown={e=>{if(e.target===e.currentTarget)setSettings(false)}}><div className="settings-card" role="dialog" aria-modal="true" aria-label="Workspace settings">
    <div className="settings-head"><h2>Workspace settings</h2><Icon icon={X} title="Close" onClick={()=>setSettings(false)}/></div>
    <div className="setting-row"><div><strong>Appearance</strong><p>Switch between light and dark mode.</p></div>
      <button className="outline-btn" onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={16}/>:<Moon size={16}/>} {theme==='dark'?'Light mode':'Dark mode'}</button></div>
    <div className="setting-row"><div><strong>New email notifications</strong><p>{preferences.notifications?'Enabled: you will be notified about new messages.':'Disabled: no new-mail alerts will appear.'}</p></div>
      <button className={'outline-btn '+(preferences.notifications?'on':'')} onClick={toggleNotifs} disabled={preferenceBusy}>
       <Bell size={16}/>{preferenceBusy?'Saving...':preferences.notifications?'Disable':'Enable'}</button></div>
    <div className="setting-row"><div><strong>Signed-in account</strong><p>{user?.email}</p></div><Check size={20}/></div>
    {userIsAdmin&&<div className="setting-row inbound-status"><div><strong>Incoming mail connection</strong><p>{receiving?.webhookReady?'Receiving webhook connected.':'Receiving webhook is not connected.'}</p><p>Incoming email also requires the correct DNS mail routing.</p>{receiving?.incomingMx?.length>0&&<p>Current mail hosts: {receiving.incomingMx.map(x=>x.host).join(', ')}</p>}<p className="muted">Do not replace an existing mail provider's MX records without planning the switch.</p></div>{!receiving?.webhookReady?<button type="button" className="outline-btn" onClick={enableReceiving} disabled={receivingBusy}>{receivingBusy?'Connecting...':'Enable receiving'}</button>:<Check size={20}/>}</div>}
  </div></div>}
  {notificationPanel&&<div className="notification-popover"><div className="notification-top"><strong>Mail notifications</strong><Icon icon={X} title="Close" onClick={()=>setNotificationPanel(false)}/></div>
   <div className="notification-content"><Bell size={21}/><p>{preferences.notifications?'Alerts are enabled for new messages.':'Notifications are currently turned off.'}</p></div>
   <button className="outline-btn" onClick={toggleNotifs} disabled={preferenceBusy}>{preferences.notifications?'Turn off notifications':'Enable notifications'}</button></div>}
  {notice&&<div role={notice.kind==='error'?'alert':'status'} className={'toast '+(notice.kind==='error'?'toast-error':'')}>
    {notice.kind==='error'?<AlertCircle size={18}/>:<Check size={18}/>}<span>{notice.message}</span>
    <button title="Dismiss" aria-label="Dismiss" onClick={()=>setNotice(null)}><X size={15}/></button></div>}
 </div>
}
