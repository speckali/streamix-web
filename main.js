var APP_VERSION='0.3.3 · 11/11 01h25';
var IS_TIZEN=!!(window.tizen&&window.tizen.application);
// ==PURE==
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function mkErr(code,extra){var e=new Error(code);e.code=code;e.extra=extra;return e;}
function viaRelayWith(relay,u){
  if(!relay) return u;
  var enc=encodeURIComponent(u);
  if(relay.indexOf('{url}')>-1) return relay.replace('{url}',enc);
  if(relay.indexOf('?')<0) return relay+'?url='+enc;
  if(/[?&]$/.test(relay)) return relay+'url='+enc;
  if(/=$/.test(relay)) return relay+enc;
  return relay+'&url='+enc;
}
function classify(it){
  var u=(it.u||'').toLowerCase(), g=it.g||'';
  if(u.indexOf('/movie/')>-1) return 'vod';
  if(u.indexOf('/series/')>-1) return 'series';
  if(/^(films?|movies?|vod|cin[eé]ma)\b/i.test(g)) return 'vod';
  if(/^s[eé]ries?\b/i.test(g)) return 'series';
  if(/\.(mp4|mkv|avi|mov)(\?|$)/i.test(u)) return 'vod';
  return 'live';
}
function parseM3U(text){
  if(!text||(text.indexOf('#EXTM3U')<0&&text.indexOf('#EXTINF')<0)) throw mkErr('m3u');
  var lines=text.split(/\r?\n/),out=[],cur=null,i,ln,m,re=/([\w-]+)="([^"]*)"/g,key,lq,ci;
  for(i=0;i<lines.length;i++){
    ln=lines[i].trim();
    if(!ln) continue;
    if(ln.indexOf('#EXTINF')===0){
      cur={n:'',l:'',g:'',tn:''};
      re.lastIndex=0;
      while((m=re.exec(ln))){
        key=m[1].toLowerCase();
        if(key==='tvg-logo') cur.l=m[2];
        else if(key==='group-title') cur.g=m[2];
        else if(key==='tvg-name'&&!cur.tn) cur.tn=m[2];
      }
      lq=ln.lastIndexOf('"');
      ci=ln.indexOf(',',lq>=0?lq:0);
      cur.n=ci>=0?ln.slice(ci+1).trim():'';
      if(!cur.n) cur.n=cur.tn||'Sans nom';
    } else if(ln.charAt(0)==='#'){
      if(cur&&ln.indexOf('#EXTGRP:')===0&&!cur.g) cur.g=ln.slice(8).trim();
    } else {
      if(!cur) cur={n:ln,l:'',g:''};
      cur.u=ln;
      cur.t=classify(cur);
      out.push(cur);
      cur=null;
    }
  }
  return out;
}
function buildCats(items){
  var map={},order=[],i,c;
  for(i=0;i<items.length;i++){
    c=items[i].c;
    if(!map[c]){map[c]={id:c,name:c,count:0};order.push(map[c]);}
    map[c].count++;
  }
  return order;
}
function normServer(s){
  s=(s||'').trim();
  if(!s) return '';
  if(!/^https?:\/\//i.test(s)) s='http://'+s;
  s=s.replace(/\/(player_api|get|xmltv|panel_api)\.php.*$/i,'');
  return s.replace(/\/+$/,'');
}
function hostOf(u){var m=/^https?:\/\/([^\/?#]+)/i.exec(u||'');return m?m[1]:(u||'');}
// ==/PURE==

(function(){
'use strict';

// ---------- outils ----------
var $=function(id){return document.getElementById(id);};
var S={playlists:[],settings:{relay:'',relayStreams:false,liveFmt:'m3u8'},cur:null,data:null,cache:{},kind:'live',catId:'all',query:'',view:null,items:[],rendered:0,favs:[],favSet:{},screen:'home',from:'home',loading:false,tok:0,avail:{live:1,vod:1,series:1}};
var KB={open:false,buf:'',shift:false,cb:null,title:'',shortcuts:[]};
var MD={open:false,btns:[]};
var P={open:false,hls:null,item:null,list:null,idx:0,retry:0,running:false,ctlT:null,stallT:null,prevFocus:null,url:''};
var toastT=null;

function lsGet(k,d){try{var v=window.localStorage.getItem(k);return v?JSON.parse(v):d;}catch(e){return d;}}
function lsSet(k,v){try{window.localStorage.setItem(k,JSON.stringify(v));return true;}catch(e){return false;}}
function toast(m){var t=$('toast');t.textContent=m;t.style.display='block';clearTimeout(toastT);toastT=setTimeout(function(){t.style.display='none';},3800);}
function saveSettings(){if(!lsSet('streamix.settings',S.settings)) toast('Stockage local indisponible : les réglages seront perdus à la fermeture.');}
function savePlaylists(){if(!lsSet('streamix.playlists',S.playlists)) toast('Stockage local indisponible : les playlists seront perdues à la fermeture.');}
function saveFavs(){if(S.cur&&!lsSet('streamix.fav.'+S.cur.id,S.favs)) toast('Stockage local indisponible : les favoris seront perdus à la fermeture.');}
function newId(){return 'p'+Date.now().toString(36)+Math.floor(Math.random()*1e6).toString(36);}

function fmtDate(ts){var d=new Date(ts*1000);function z(n){return (n<10?'0':'')+n;}return z(d.getDate())+'/'+z(d.getMonth()+1)+'/'+d.getFullYear();}
function accountLine(i){
  if(!i) return '';
  var t=i.exp?'expire le '+fmtDate(i.exp)+(function(){var j=Math.ceil((i.exp*1000-Date.now())/86400000);return j>=0?' ('+j+' j restants)':'';})():'sans date d\'expiration';
  if(i.maxc) t+=' - '+(i.actc!==''?i.actc+'/':'')+i.maxc+' écran(s)';
  return t;
}
function viaRelay(u){return viaRelayWith(S.settings.relay,u);}
var MIXED_MSG="Adresse en http appelée depuis une page https : le navigateur bloque ce contenu mixte. Hébergez cette page en http, ou renseignez une URL de relais en https dans Réglages.";
function errMsg(e){
  switch(e&&e.code){
    case 'mixed': return MIXED_MSG;
    case 'timeout': return 'Le serveur met trop de temps à répondre.';
    case 'http':
      if(/^(401|403|421|423|429|451|461)$/.test(String(e.extra))) return 'Codes NON ACTIFS : le serveur refuse ces identifiants (erreur '+e.extra+'). L\'abonnement est probablement expiré, suspendu ou déjà utilisé sur un autre appareil. Vérifiez auprès de votre fournisseur.';
      if(String(e.extra)==='404') return 'Serveur introuvable (erreur 404) : vérifiez l\'adresse et le port, ou le fournisseur est en panne.';
      return 'Le serveur a répondu avec l\'erreur '+e.extra+'.';
    case 'json': return 'Réponse inattendue du serveur (ce n\'est pas une réponse Xtream valide).';
    case 'm3u': return 'Le contenu reçu ne ressemble pas à une playlist M3U.';
    case 'auth': return 'Codes NON ACTIFS : nom d\'utilisateur ou mot de passe refusé par le serveur.';
    case 'expired': return 'Codes NON ACTIFS : l\'abonnement est '+(String(e.extra).toLowerCase()==='expired'?'expiré':'en état « '+e.extra+' »')+'.';
    case 'empty': return 'La playlist ne contient aucune entrée lisible.';
    default: return 'Connexion impossible : réseau coupé, adresse erronée ou blocage CORS du navigateur. Si l\'adresse est correcte, renseignez une URL de relais dans Réglages.';
  }
}
// version web en https (TV VIDAA...) : les listes d'un serveur http passent par le relais STREAMIX
var AUTO_RELAY_BASE='https://havfeafimghxgzfuiyqq.supabase.co/functions/v1/iptv-relay',AUTO_RELAY=AUTO_RELAY_BASE+'?url=';
function needAutoRelay(u){return !S.settings.relay&&location.protocol==='https:'&&/^http:/i.test(u);}
// version web en https : on parle au serveur IPTV en https (meme port, puis port standard), le relais en dernier recours
function upParts(u){var m=String(u).match(/^http:\/\/([^\/:?#]+)(:\d+)?([\/?#].*)?$/i);return m?{host:m[1].toLowerCase(),port:m[2]||'',rest:m[3]||'/'}:null;}
function upGet(){var m=lsGet('streamix.upg',{});return m&&typeof m==='object'?m:{};}
function upSet(host,mode){var m=upGet();if(m[host]!==mode){m[host]=mode;lsSet('streamix.upg',m);}}
function needUp(u){return !S.settings.relay&&location.protocol==='https:'&&/^http:/i.test(u);}
function upVariants(u){
  var p=upParts(u);if(!p) return [];
  var a=[{url:'https://'+p.host+p.port+p.rest,host:p.host,mode:'p'}];
  if(p.port) a.push({url:'https://'+p.host+p.rest,host:p.host,mode:'n'});
  var k=upGet()[p.host];if(k==='n') a.reverse();
  return a;
}
function upStream(u){
  if(!needUp(u)) return u;
  var p=upParts(u);if(!p) return u;
  var k=upGet()[p.host];
  if(k==='x') return u;
  return 'https://'+p.host+(k==='n'?'':p.port)+p.rest;
}
function fetchText(u,timeout){
  if(!needUp(u)) return fetchText0(u,timeout);
  var vs=upVariants(u),i=0;
  function next(){
    if(i>=vs.length){var pp=upParts(u);if(pp) upSet(pp.host,'x');return fetchText0(u,timeout);}
    var v=vs[i++];
    return fetchText0(v.url,i===1?timeout:Math.min(timeout||60000,20000)).then(function(t){upSet(v.host,v.mode);return t;},function(e){
      if(e&&e.code==='http'&&/^(401|403|404)$/.test(String(e.extra))){upSet(v.host,v.mode);throw e;}
      return next();
    });
  }
  return next();
}
function fetchText0(u,timeout){
  var auto=needAutoRelay(u),target=auto?AUTO_RELAY_BASE:viaRelay(u),fopt={cache:'no-store',credentials:'omit'};
  if(auto){try{fopt.headers={'x-target':btoa(unescape(encodeURIComponent(u)))};}catch(e){target=viaRelayWith(AUTO_RELAY,u);}}
  if(location.protocol==='https:'&&/^http:/i.test(target)) return Promise.reject(mkErr('mixed'));
  return new Promise(function(res,rej){
    var t=setTimeout(function(){rej(mkErr('timeout'));},timeout||60000);
    var tries=0;
    function go(){
      tries++;
      return fetch(target,fopt).then(function(r){
        if(r.status===421&&tries<3) return new Promise(function(ok){setTimeout(ok,400*tries);}).then(go);
        if(!r.ok) throw mkErr('http',r.status);
        return r.text();
      });
    }
    go().then(function(txt){clearTimeout(t);res(txt);}).catch(function(e){clearTimeout(t);rej(e&&e.code?e:mkErr('network'));});
  });
}
function fetchJSON(u,timeout){
  return fetchText(u,timeout).then(function(t){try{return JSON.parse(t);}catch(e){throw mkErr('json');}});
}

// ---------- focus et navigation ----------
function focusables(root){
  var l=root.querySelectorAll('[data-f]'),out=[],i;
  for(i=0;i<l.length;i++) if(l[i].offsetWidth>0&&l[i].offsetHeight>0) out.push(l[i]);
  return out;
}
function ensureVisible(el){
  var p=el.parentNode;
  while(p&&p!==document.body){if(p.classList&&p.classList.contains('scr')) break;p=p.parentNode;}
  if(!p||p===document.body) return;
  var r=el.getBoundingClientRect(),pr=p.getBoundingClientRect();
  if(r.top<pr.top+8) p.scrollTop-=(pr.top+8-r.top);
  else if(r.bottom>pr.bottom-8) p.scrollTop+=(r.bottom-(pr.bottom-8));
}
function setFocus(el){
  if(!el) return;
  if(!el.hasAttribute('tabindex')) el.setAttribute('tabindex','-1');
  try{el.focus();}catch(e){}
  ensureVisible(el);
}
function focusIn(root,sel){
  var el=sel?root.querySelector(sel):null;
  if(!el||!el.offsetWidth){var a=focusables(root);el=a[0];}
  if(el) setFocus(el);
}
function activeRoot(){
  if(KB.open) return $('kb');
  if(MD.open) return $('modal');
  if(FI.open&&!P.open) return $('fiche');
  if(GD.open&&!P.open) return $('guide');
  if(S.loading) return null;
  if(P.open) return $('player');
  return $('s-'+S.screen);
}
function move(dir){
  var root=activeRoot();
  if(!root) return false;
  var list=focusables(root),cur=document.activeElement;
  if(!cur||!root.contains(cur)||!cur.hasAttribute('data-f')){
    if(list.length){setFocus(list[0]);return true;}
    return false;
  }
  var cr=cur.getBoundingClientRect(),cx=cr.left+cr.width/2,cy=cr.top+cr.height/2,best=null,bs=1e12,i,c,r,dx,dy,pri,sec,sc;
  for(i=0;i<list.length;i++){
    c=list[i];
    if(c===cur) continue;
    r=c.getBoundingClientRect();
    dx=r.left+r.width/2-cx;dy=r.top+r.height/2-cy;
    var gx=Math.max(0,r.left-cr.right,cr.left-r.right),gy=Math.max(0,r.top-cr.bottom,cr.top-r.bottom);
    if(dir==='left'){if(dx>-2) continue;pri=Math.max(0,cr.left-r.right);sec=gy;}
    else if(dir==='right'){if(dx<2) continue;pri=Math.max(0,r.left-cr.right);sec=gy;}
    else if(dir==='up'){if(dy>-2) continue;pri=Math.max(0,cr.top-r.bottom);sec=gx;}
    else {if(dy<2) continue;pri=Math.max(0,r.top-cr.bottom);sec=gx;}
    sc=pri+sec*2.5+(dir==='up'||dir==='down'?Math.abs(dx):Math.abs(dy))*0.05;
    if(sc<bs){bs=sc;best=c;}
  }
  if(best){setFocus(best);return true;}
  if(dir==='up'||dir==='down'){
    var sc2=root.querySelectorAll('.scr'),j;
    for(j=0;j<sc2.length;j++){
      if(sc2[j].scrollHeight>sc2[j].clientHeight+4){sc2[j].scrollTop+=(dir==='down'?1:-1)*Math.round(sc2[j].clientHeight*0.4);return true;}
    }
  }
  return false;
}
function keyName(e){
  var c=e.keyCode,k=e.key;
  if(c===37||k==='ArrowLeft'||k==='Left') return 'left';
  if(c===38||k==='ArrowUp'||k==='Up') return 'up';
  if(c===39||k==='ArrowRight'||k==='Right') return 'right';
  if(c===40||k==='ArrowDown'||k==='Down') return 'down';
  if(c===13||k==='Enter'||k==='Accept') return 'ok';
  if(c===8||c===27||c===10009||c===461||k==='Escape'||k==='Backspace'||k==='GoBack'||k==='BrowserBack'||k==='XF86Back') return 'back';
  if(c===179||k==='MediaPlayPause'||c===32) return 'playpause';
  if(c===415||k==='MediaPlay') return 'play';
  if(c===19||k==='MediaPause') return 'pause';
  if(c===413||k==='MediaStop') return 'stop';
  if(c===412||k==='MediaRewind') return 'rew';
  if(c===417||k==='MediaFastForward') return 'ff';
  if(c===427||c===33||k==='ChannelUp'||k==='PageUp') return 'chup';
  if(c===428||c===34||k==='ChannelDown'||k==='PageDown') return 'chdn';
  if(c===403||k==='ColorF0Red') return 'red';
  if(c===405||k==='ColorF2Yellow') return 'yellow';
  if(c===457||k==='Info') return 'info';
  return '';
}
// ---------- navigateur (TV VIDAA) : la touche Retour ne doit pas quitter la page ----------
var BK={last:0,leaving:false};
if(!IS_TIZEN&&window.history&&window.history.pushState){
  try{window.history.pushState({sx:1},'');}catch(e){}
  window.addEventListener('popstate',function(){
    if(BK.leaving) return;
    var keyJustDone=Date.now()-BK.last<400;
    try{window.history.pushState({sx:1},'');}catch(e){}
    if(keyJustDone) return;
    if(S.loading){cancelLoading();return;}
    if(P.open&&!KB.open&&!MD.open){playerKey('back');return;}
    if(GD.open&&!KB.open&&!MD.open){guideKey('back');return;}
    goBack();
  });
}
document.addEventListener('keydown',function(e){
  if(KB.open){
    if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key&&e.key.length===1){kbAdd(e.key);e.preventDefault();return;}
    if(e.keyCode===8||e.key==='Backspace'){e.preventDefault();if(KB.buf.length) kbDel(); else kbClose(false);return;}
  }
  var k=keyName(e);
  if(!k) return;
  e.preventDefault();
  if(k==='back') BK.last=Date.now();
  if(S.loading){if(k==='back') cancelLoading();return;}
  if(P.open&&!KB.open&&!MD.open){playerKey(k);return;}
  if(GD.open&&!KB.open&&!MD.open){guideKey(k);return;}
  if(k==='left'||k==='right'||k==='up'||k==='down'){move(k);return;}
  if(k==='ok'){var el=document.activeElement;if(el&&el.hasAttribute('data-f')) el.click();return;}
  if(k==='back'){goBack();return;}
  if((k==='red'||k==='yellow'||k==='info')&&S.screen==='browse'&&!KB.open&&!MD.open){
    var f=document.activeElement;
    if(f&&f.classList.contains('card')){var it=S.items[+f.getAttribute('data-arg')];if(it) toggleFav(it,+f.getAttribute('data-arg'));}
    else if(f&&f.classList.contains('cat')&&!S.view&&S.kind!=='fav'){
      var cid=f.getAttribute('data-arg');
      if(cid&&cid!=='all'&&cid!=='__recent'&&cid!=='__hidden'){
        var hk=hiddenCats(S.kind),nm=(f.querySelector('span')||{}).textContent||'';
        if(hk[cid]){delete hk[cid];toast('« '+nm+' » réaffichée.');}
        else{hk[cid]=1;toast('« '+nm+' » masquée. Tu la retrouves dans « Catégories masquées » en bas de la liste.');}
        lsSet(hideKey(S.kind),hk);
        var st1=$('cats').scrollTop;renderCats();$('cats').scrollTop=st1;
        var nx=document.querySelector('#cats [data-arg="'+cid.replace(/"/g,'\\"')+'"]')||document.querySelector('#cats .cat.on')||document.querySelector('#cats .cat');
        if(nx) setFocus(nx);
        if(S.catId==='all') renderGrid();
      }
    }
  }
});
document.addEventListener('focusin',function(e){
  var t=e.target;
  if(t&&t.classList&&t.classList.contains('card')&&S.screen==='browse'){
    if(+t.getAttribute('data-arg')>=S.rendered-14&&S.rendered<S.items.length) appendChunk();
  }
});
document.addEventListener('error',function(e){var t=e.target;if(t&&t.tagName==='IMG') t.style.display='none';},true);
// ---------- navigation au pointeur (navigateur VIDAA, souris) ----------
// survol = selection ; pointeur pres du bord d'une liste = defilement automatique
if(!IS_TIZEN){
  document.addEventListener('mouseover',function(e){
    var t=e.target;while(t&&t!==document&&!(t.hasAttribute&&t.hasAttribute('data-f'))) t=t.parentNode;
    if(!t||t===document||t===document.activeElement) return;
    try{t.focus({preventScroll:true});}catch(x){try{t.focus();}catch(y){}}
  });
  var ES={el:null,dy:0,t:null};
  document.addEventListener('mousemove',function(e){
    var el=document.elementFromPoint(e.clientX,e.clientY),sc=null,cs;
    while(el&&el!==document.body&&el!==document.documentElement){
      cs=window.getComputedStyle(el);
      if((cs.overflowY==='auto'||cs.overflowY==='scroll')&&el.scrollHeight>el.clientHeight+4){sc=el;break;}
      el=el.parentNode;
    }
    ES.el=sc;ES.dy=0;
    if(sc){
      var r=sc.getBoundingClientRect(),z=Math.max(50,r.height*0.14);
      if(e.clientY>r.bottom-z) ES.dy=Math.round(6+(e.clientY-(r.bottom-z))/z*30);
      else if(e.clientY<r.top+z) ES.dy=-Math.round(6+((r.top+z)-e.clientY)/z*30);
    }
    if(ES.dy&&!ES.t) ES.t=setInterval(function(){
      if(!ES.el||!ES.dy){clearInterval(ES.t);ES.t=null;return;}
      ES.el.scrollTop+=ES.dy;
      if(ES.el.id==='gridwrap'&&ES.el.scrollTop+ES.el.clientHeight>ES.el.scrollHeight-400&&S.rendered<S.items.length) appendChunk();
    },40);
  });
  document.addEventListener('mouseleave',function(){ES.dy=0;});
  document.addEventListener('wheel',function(){var g=$('gridwrap');if(g&&g.scrollTop+g.clientHeight>g.scrollHeight-400&&S.rendered<S.items.length) appendChunk();},{passive:true});
}
document.addEventListener('click',function(e){
  var el=e.target;
  while(el&&el!==document&&!(el.getAttribute&&el.getAttribute('data-act'))) el=el.parentNode;
  if(!el||el===document) return;
  act(el.getAttribute('data-act'),el.getAttribute('data-arg'),el);
});

// ---------- ecrans ----------
function show(name){
  var s=document.querySelectorAll('.screen'),i;
  for(i=0;i<s.length;i++) s[i].classList.remove('on');
  $('s-'+name).classList.add('on');
  S.screen=name;
}
function loadingOn(t){S.loading=true;$('lt').textContent=t||'Chargement...';$('loading').style.display='block';}
function loadingOff(){S.loading=false;$('loading').style.display='none';}
function setLoadingText(t){$('lt').textContent=t;}
function cancelLoading(){S.tok++;loadingOff();toast('Chargement annulé.');if(S.boot){S.boot=false;S.cur=null;S.data=null;showHub();}}

function modal(title,text,btns){
  MD.open=true;MD.btns=btns;
  $('mt').textContent=title;$('mm').textContent=text;
  var h='',i;
  for(i=0;i<btns.length;i++) h+='<div class="btn'+(btns[i].primary?' primary':'')+'" data-f data-act="modal" data-arg="'+i+'">'+esc(btns[i].label)+'</div>';
  $('mb').innerHTML=h;
  $('modal').style.display='block';
  focusIn($('modal'));
}
function modalClose(){MD.open=false;$('modal').style.display='none';$('modal').classList.remove('seethru','qcompact');document.body.classList.remove('menuopen');}
function info(title,text){modal(title,text,[{label:'OK',primary:true}]);}

function exitApp(){
  try{if(P.open) teardown();}catch(e){}
  try{if(AV.on) avStop();}catch(e){}
  try{if(window.tizen&&tizen.application){tizen.application.getCurrentApplication().exit();return;}}catch(e){}
  // TV VIDAA / navigateur : on ferme la page (ou on revient a la page precedente)
  BK.leaving=true;
  try{window.close();}catch(e){}
  setTimeout(function(){try{window.history.go(-2);}catch(e){}},300);
}
function askExit(){
  modal('Quitter STREAMIX ?','L\'application sera complètement fermée (elle ne tournera plus en arrière-plan).',[{label:'Quitter',primary:true,fn:function(){exitApp();}},{label:'Annuler'}]);
}
function goBack(){
  if(KB.open){kbClose(false);return;}
  if(OD.active){closeOpt();return;}
  if(MD.open){modalClose();restoreFocus();return;}
  if(FI.open){closeFiche();return;}
  switch(S.screen){
    case 'hub': askExit();return;
    case 'profile': closeProfile();return;
    case 'hide': openSettings();return;
    case 'home': showHub();return;
    case 'add': if(!S.playlists.length) showHub(); else showHome();return;
    case 'browse': if(S.query){S.query='';S.searchAll=false;refreshBrowse();focusIn($('s-browse'),'#bsearch');return;}
      if(S.view){closeView();}else{showHub('[data-arg="'+(S.kind==='fav'?'fav':S.kind)+'"]');}return;
    case 'settings': if(S.from==='browse'&&S.cur&&S.data){show('browse');focusIn($('s-browse'),'.tab.on');}else if(S.from==='hub'){showHub();}else{showHome();}return;
    case 'diag': openSettings();return;
  }
}
var lastFocusSel=null;
function restoreFocus(){var r=activeRoot();if(r&&(!document.activeElement||!r.contains(document.activeElement))) focusIn(r,lastFocusSel);}

// ---------- accueil ----------
function showHome(sel){
  var h='<div><span class="brand">STREAMIX</span><span class="tag">'+(IS_TIZEN?'Samsung TV':'Smart TV')+'</span></div>';
  h+='<div class="h2">Mes playlists</div><div class="scr" style="flex:1;min-height:0;padding:.3rem">';
  if(!S.playlists.length) h+='<div class="empty">Aucune playlist pour le moment. Ajoutez un lien M3U ou un compte Xtream.</div>';
  S.playlists.forEach(function(p){
    h+='<div class="plrow"><div class="pl" data-f data-act="home-open" data-arg="'+esc(p.id)+'"><div class="plname">'+esc(p.name)+'</div><div class="plsub">'+(p.type==='m3u'?'Lien M3U':'Compte Xtream')+' - '+esc(hostOf(p.type==='m3u'?p.url:p.server))+(p.info&&p.info.ok===0?' - <span style="color:var(--err)">Codes non actifs</span>':(p.info?' - <span style="color:var(--ok)">Actif, '+esc(accountLine(p.info))+'</span>':''))+'</div></div><div class="btn" data-f data-act="home-del" data-arg="'+esc(p.id)+'">Supprimer</div></div>';
  });
  h+='</div><div style="padding:.5rem .3rem"><div class="btn primary" data-f data-act="home-add">Ajouter une playlist</div><div class="btn" data-f data-act="go-settings">Réglages</div></div>';
  $('s-home').innerHTML=h;
  show('home');
  focusIn($('s-home'),sel||(S.playlists.length?'.pl':'[data-act="home-add"]'));
}


// ---------- accueil (comme l'appli Android) ----------
var IC={
  power:'<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"><path d="M50 10v38"/><path d="M30 24a33 33 0 1 0 40 0"/></svg>',
  logo:'<svg viewBox="0 0 100 100"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9b4dff"/><stop offset="1" stop-color="#3f7bff"/></linearGradient></defs><path d="M18 10 L88 50 L18 90 Z" fill="url(#lg)" stroke="url(#lg)" stroke-width="8" stroke-linejoin="round"/><path d="M34 34 L62 50 L34 66 Z" fill="rgba(255,255,255,.4)"/></svg>',
  tv:'<svg viewBox="0 0 100 100" fill="none" stroke="#eeeaff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="14" width="80" height="54" rx="9"/><path d="M42 30 L62 41 L42 52 Z" fill="#eeeaff"/><path d="M50 68 V82 M30 84 H70"/></svg>',
  clap:'<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="pcb"><path d="M20 44 L29 93 Q30 96 33 96 H67 Q70 96 71 93 L80 44 Z"/></clipPath></defs><g fill="#fff6d6"><circle cx="28" cy="40" r="9"/><circle cx="40" cy="31" r="10"/><circle cx="55" cy="28" r="11"/><circle cx="69" cy="34" r="10"/><circle cx="76" cy="43" r="7"/><circle cx="47" cy="40" r="9"/><circle cx="62" cy="42" r="8"/><circle cx="35" cy="20" r="7"/><circle cx="50" cy="15" r="8"/><circle cx="64" cy="19" r="7"/></g><g fill="#ffd54a"><circle cx="31" cy="37" r="3.2"/><circle cx="44" cy="27" r="3.5"/><circle cx="58" cy="24" r="3.8"/><circle cx="71" cy="31" r="3.2"/><circle cx="52" cy="12" r="2.8"/><circle cx="37" cy="17" r="2.5"/><circle cx="66" cy="16" r="2.5"/><circle cx="49" cy="37" r="2.8"/></g><g clip-path="url(#pcb)"><rect x="10" y="40" width="80" height="60" fill="#ffffff"/><g fill="#ff4d6d"><rect x="22" y="40" width="9" height="60"/><rect x="40" y="40" width="9" height="60"/><rect x="58" y="40" width="9" height="60"/><rect x="76" y="40" width="9" height="60"/></g><path d="M10 90 H90 V100 H10 Z" fill="#000" opacity=".12"/></g><path d="M17 42 H83 Q85 42 84.5 44.5 L83.5 49 Q83 50 81 50 H19 Q17 50 16.5 49 L15.5 44.5 Q15 42 17 42 Z" fill="#ffffff"/><path d="M19 47 H81" stroke="#ff4d6d" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="66" r="4.5" fill="#fff6d6"/><circle cx="88" cy="74" r="4" fill="#fff6d6"/><circle cx="12.5" cy="65" r="1.7" fill="#ffd54a"/></svg>',
  reel:'<svg viewBox="0 0 100 100" fill="none" stroke="#eeeaff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="18" width="80" height="64" rx="10"/><path d="M10 34 H90"/><path d="M26 10 V24 M74 10 V24"/><path d="M40 46 L62 58 L40 70 Z" fill="#eeeaff"/></svg>',
  search:'<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"><circle cx="42" cy="42" r="26"/><path d="M62 62 L86 86"/></svg>',
  star:'<svg viewBox="0 0 100 100"><path fill="#fff" d="M50 6 L62 37 L95 38 L69 58 L78 91 L50 72 L22 91 L31 58 L5 38 L38 37 Z"/></svg>',
  gear:'<svg viewBox="0 0 100 100"><path fill="#fff" d="M43 4h14l3 13 9 4 11-7 10 10-7 11 4 9 13 3v14l-13 3-4 9 7 11-10 10-11-7-9 4-3 13H43l-3-13-9-4-11 7-10-10 7-11-4-9L0 57V43l13-3 4-9-7-11 10-10 11 7 9-4z"/><circle cx="50" cy="50" r="15" fill="#14186b"/></svg>',
  refresh:'<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"><path d="M80 50 A30 30 0 1 1 64 23"/><path d="M60 8 L68 24 L52 32" stroke-linejoin="round"/></svg>',
  user:'<svg viewBox="0 0 100 100" fill="#fff"><circle cx="50" cy="30" r="20"/><path d="M12 92 C14 64 32 56 50 56 C68 56 86 64 88 92 Z"/></svg>'
};
var HUB_WAVE='<svg class="wave" viewBox="0 0 1920 1080" preserveAspectRatio="none"><defs><linearGradient id="wv" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b04dff" stop-opacity="0"/><stop offset=".35" stop-color="#b04dff"/><stop offset=".7" stop-color="#ffffff"/><stop offset="1" stop-color="#36dfff"/></linearGradient></defs>'+
  '<path d="M0 230 C420 300 760 120 1150 210 S1700 300 1920 200" fill="none" stroke="url(#wv)" stroke-width="4" opacity=".9"/>'+
  '<path d="M0 250 C420 320 760 140 1150 230 S1700 320 1920 220" fill="none" stroke="url(#wv)" stroke-width="14" opacity=".2"/>'+
  '<path d="M0 1050 C380 1010 820 1080 1200 1040 S1700 1000 1920 1030" fill="none" stroke="url(#wv)" stroke-width="4" opacity=".9"/>'+
  '<path d="M0 1066 C380 1026 820 1096 1200 1056 S1700 1016 1920 1046" fill="none" stroke="url(#wv)" stroke-width="14" opacity=".2"/></svg>';
var hubClockT=null;
function hubClock(){
  var el=$('hclock');if(!el) return;
  var d=new Date(),J=['Dim.','Lun.','Mar.','Mer.','Jeu.','Ven.','Sam.'],M=['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
  function z(n){return (n<10?'0':'')+n;}
  el.innerHTML='<div class="t">'+fmtClock(nowAdj(),!!S.settings.clock12)+'</div><div class="d">'+fmtDay(d,S.settings.dateFmt||'long')+'</div><div class="d" style="font-size:.85rem;opacity:.7">v'+APP_VERSION+'</div>';
}
function hubReady(){return !!(S.cur&&S.data&&S.cur.id!=='__none');}
function hubStatus(){
  if(!licActive()) return '<span style="color:var(--err)">Abonnement STREAMIX '+esc(licLabel().toLowerCase())+' : ouvrez l\'icône profil pour voir votre adresse MAC et votre clé.</span>';
  if(!S.playlists.length) return 'Aucune playlist : ouvrez l\'icône profil en haut à droite pour en ajouter une (QR code).';
  if(hubReady()) return esc(S.cur.name)+(S.cur.info&&S.cur.info.ok?' - Codes ACTIFS, '+esc(accountLine(S.cur.info)):'');
  return '<span style="color:var(--err)">Playlist non chargée (codes non actifs ou serveur indisponible).</span>';
}
function showHub(sel){
  var h=HUB_WAVE+'<div class="glow1"></div><div class="glow2"></div><div class="hin">';
  h+='<div class="hhead"><div class="hlogo">'+IC.logo+'<div><div class="hname">STREAM<span>IX</span></div><div class="hsub">Lecteur IPTV Premium</div></div></div>';
  h+='<div class="hright"><div class="hclock" id="hclock"></div><div class="hsep"></div>';
  h+='<div class="hicon" data-f data-act="hub-refresh">'+IC.refresh+'</div><div class="hicon" data-f data-act="go-settings">'+IC.gear+'</div><div class="hicon" data-f data-act="go-profile">'+IC.user+'</div><div class="hicon" data-f data-act="app-exit" title="Quitter">'+IC.power+'</div></div></div>';
  h+='<div class="hgrid"><div class="htile hlive" data-f data-act="hub-kind" data-arg="live">'+IC.tv+'<div class="l">Télévision<br>en direct</div></div>';
  h+='<div class="htile hvod" data-f data-act="hub-kind" data-arg="vod">'+IC.clap+'<div class="l">Films</div></div>';
  h+='<div class="htile hser" data-f data-act="hub-kind" data-arg="series">'+IC.reel+'<div class="l">Séries</div></div>';
  h+='<div class="hs hfav" data-f data-act="hub-kind" data-arg="fav">'+IC.star+'Favoris</div><div class="hs hset" data-f data-act="go-settings">'+IC.gear+'Paramètres</div></div>';
  h+='<div class="hspace"></div><div class="hstat">'+hubStatus()+'</div>';
  h+='<div class="hfoot"><b>STREAMIX</b>&nbsp;&nbsp;•&nbsp;&nbsp;Lecteur multimédia uniquement : aucune chaîne, playlist ni abonnement IPTV n\'est fourni.</div></div>';
  $('s-hub').innerHTML=h;
  show('hub');
  hubClock();clearInterval(hubClockT);hubClockT=setInterval(hubClock,15000);
  focusIn($('s-hub'),sel||'[data-arg="live"]');
}
function hubNeedPlaylist(){
  if(!S.playlists.length){toast('Ajoutez d\'abord une playlist (lien M3U ou codes Xtream).');startAdd();return true;}
  if(!hubReady()){
    var last=lsGet('streamix.last',null),id=S.playlists[0].id,i;
    for(i=0;i<S.playlists.length;i++) if(S.playlists[i].id===last) id=last;
    openPlaylist(id);return true;
  }
  return false;
}
function hubOpen(kind){
  if(!licActive()){licBlocked();return;}
  if(hubNeedPlaylist()){S.pend=kind;return;}
  S.pend=null;
  enterBrowse();
  if(kind!==S.kind){S.query='';S.searchAll=false;switchKind(kind);}
  focusIn($('s-browse'),document.querySelector('#grid .card')?'#grid .card':'.tab.on');
}

// ---------- ajout de playlist ----------
var F={type:'m3u',name:'',url:'',server:'',user:'',pass:''};
function startAdd(){F={type:'m3u',name:'',url:'',server:'',user:'',pass:''};renderAdd();}
function fieldHtml(key,label,ph,mask){
  var v=F[key],txt=v?(mask?new Array(v.length+1).join('•'):v):ph;
  return '<div class="field" data-f data-act="add-field" data-arg="'+key+'"><div class="fl">'+esc(label)+'</div><div class="fv'+(v?'':' ph')+'">'+esc(txt)+'</div></div>';
}
function renderAdd(sel){
  var h='<div><span class="brand">STREAMIX</span><span class="tag">Ajouter une playlist</span></div><div class="row2" style="margin-top:1.2rem">';
  h+='<div class="btn'+(F.type==='m3u'?' on':'')+'" data-f data-act="add-type" data-arg="m3u">Lien M3U</div><div class="btn'+(F.type==='xtream'?' on':'')+'" data-f data-act="add-type" data-arg="xtream">Compte Xtream</div></div><div class="scr" style="flex:1;min-height:0;padding:.3rem">';
  h+=fieldHtml('name','Nom (facultatif)','Ma playlist',false);
  if(F.type==='m3u'){
    h+=fieldHtml('url','Lien de la playlist (http:// ou https://)','http://exemple.com/liste.m3u',false);
  } else {
    h+=fieldHtml('server','Serveur','http://serveur.exemple.com:8080',false);
    h+=fieldHtml('user','Nom d\'utilisateur','utilisateur',false);
    h+=fieldHtml('pass','Mot de passe','mot de passe',true);
  }
  h+='<div class="help">Appuyez sur OK sur un champ pour ouvrir le clavier. Les données restent uniquement dans cette TV (stockage local du navigateur).</div></div>';
  h+='<div style="padding:.5rem .3rem"><div class="btn primary" data-f data-act="add-save">Enregistrer et ouvrir</div><div class="btn" data-f data-act="add-cancel">Annuler</div></div>';
  $('s-add').innerHTML=h;
  show('add');
  focusIn($('s-add'),sel||'[data-act="add-field"]');
}
var FIELD_LABEL={name:'Nom de la playlist',url:'Lien de la playlist',server:'Serveur Xtream',user:'Nom d\'utilisateur',pass:'Mot de passe'};
function savePlaylist(){
  var p;
  if(F.type==='m3u'){
    var u=F.url.trim();
    if(!/^https?:\/\/\S+$/i.test(u)){toast('Saisissez un lien commençant par http:// ou https://');return;}
    p={id:newId(),type:'m3u',name:F.name.trim()||hostOf(u),url:u};
  } else {
    var sv=normServer(F.server);
    if(!sv||!F.user.trim()||!F.pass){toast('Renseignez le serveur, l\'utilisateur et le mot de passe.');return;}
    p={id:newId(),type:'xtream',name:F.name.trim()||('Xtream - '+hostOf(sv)),server:sv,user:F.user.trim(),pass:F.pass};
  }
  S.playlists.push(p);savePlaylists();
  openPlaylist(p.id);
}

// ---------- reglages et diagnostic ----------
function openSettings(){
  S.from=(S.screen==='browse')?'browse':(S.screen==='hub'?'hub':(S.screen==='settings'||S.screen==='diag'||S.screen==='hide'||S.screen==='profile'?S.from:'home'));
  var s=S.settings;
  var subL={off:'désactivés',auto:'automatiques',on:'activés'}[s.subMode||'off'];
  var h='<div><span class="brand">STREAMIX</span><span class="tag">Paramètres</span></div><div class="stiles">';
  h+=stile('st-parental','lock','Contrôle parental',pinSet()?'activé':'désactivé');
  h+=stile('st-clock','clock','Date et heure',(s.clock12?'12 h':'24 h'));
  h+=stile('st-subs','sub','Sous-titres',subL);
  h+=stile('st-auto','sync','Récupération automatique',s.noAuto?'OFF':'ON');
  h+=stile('st-hide','eye','Masquer des catégories');
  h+=stile('go-home','list','Playlists',S.playlists.length+' enregistrée(s)');
  h+=stile('go-profile','user','Compte utilisateur',licLabel());
  h+=stile('set-site','phone','Page téléphone (QR)',s.site?'personnalisée':'par défaut');
  h+=stile('st-speed','speed','Test de débit internet');
  h+=stile('st-cache','trash','Vider le cache');
  h+=stile('set-diag','tv','Diagnostic de la TV');
  h+=stile('st-adv','tool','Avancé',s.liveFmt==='ts'?'flux ts':'flux m3u8');
  h+='</div><div class="sfoot"><div class="btn primary" data-f data-act="set-back">Retour</div><span class="muted" style="font-size:1.1rem">STREAMIX est un lecteur : aucun contenu ni lien IPTV n\'est fourni. Utilisez uniquement des contenus auxquels vous avez légalement accès.</span></div>';
  $('s-settings').innerHTML=h;
  show('settings');
  focusIn($('s-settings'),lastFocusSel||'.stile');
  lastFocusSel=null;
}
function nativeHls(){
  try{var v=document.createElement('video');return v.canPlayType('application/vnd.apple.mpegurl')||v.canPlayType('application/x-mpegURL')||'';}catch(e){return '';}
}
function mseOk(t){
  try{var M=window.MediaSource||window.WebKitMediaSource;return !!(M&&M.isTypeSupported&&M.isTypeSupported(t));}catch(e){return false;}
}
function canPlay(t){try{return document.createElement('video').canPlayType(t)||'';}catch(e){return '';}}
function openDiag(){
  var rows=[],M=window.MediaSource||window.WebKitMediaSource,nat=nativeHls(),hlsLoaded=!!window.Hls,hlsOk=false;
  try{hlsOk=hlsLoaded&&window.Hls.isSupported();}catch(e){}
  var lsok=false;try{window.localStorage.setItem('streamix.t','1');window.localStorage.removeItem('streamix.t');lsok=true;}catch(e){}
  function r(l,v,st){rows.push('<div class="drow"><div class="dl">'+esc(l)+'</div><div class="dv '+(st?'s-'+st:'')+'">'+esc(v)+'</div></div>');}
  r('Agent utilisateur',navigator.userAgent||'inconnu','');
  r('Protocole de la page',location.protocol==='https:'?'https':(location.protocol==='http:'?'http':location.protocol),location.protocol==='https:'?'warn':'ok');
  if(location.protocol==='https:') r('Flux en http','Bloqués par le navigateur (contenu mixte) sauf via relais https','warn');
  else r('Flux en http','Autorisés depuis cette page','ok');
  r('HLS natif (balise video)',nat?('Oui ('+nat+')'):'Non',nat?'ok':'ko');
  r('MediaSource (MSE)',M?'Oui':'Non',M?'ok':'ko');
  r('hls.js',hlsLoaded?(hlsOk?'Chargé et compatible':'Chargé mais non compatible'):'Non chargé (cdnjs inaccessible ?)',hlsOk?'ok':'ko');
  var codecs=[['H.264 (MSE)','video/mp4; codecs="avc1.42E01E"'],['H.265 / HEVC (MSE)','video/mp4; codecs="hvc1.1.6.L93.B0"'],['VP9 (MSE)','video/webm; codecs="vp9"'],['AAC (MSE)','audio/mp4; codecs="mp4a.40.2"'],['AC-3 (MSE)','audio/mp4; codecs="ac-3"'],['E-AC-3 (MSE)','audio/mp4; codecs="ec-3"']];
  codecs.forEach(function(c){var ok=mseOk(c[1]);r(c[0],ok?'Oui':'Non / inconnu',ok?'ok':'warn');});
  r('MP4 natif',canPlay('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')||'Non',canPlay('video/mp4')?'ok':'ko');
  r('MPEG-TS natif (.ts brut)',canPlay('video/mp2t')||'Non',canPlay('video/mp2t')?'ok':'warn');
  r('WebM natif',canPlay('video/webm')||'Non',canPlay('video/webm')?'ok':'warn');
  r('Écran',(window.screen?screen.width+'x'+screen.height:'?')+' - fenêtre '+window.innerWidth+'x'+window.innerHeight+' - ratio '+(window.devicePixelRatio||1),'');
  r('Langue',navigator.language||'?','');
  r('Stockage local',lsok?'Disponible':'Indisponible',lsok?'ok':'ko');
  r('URL de relais',S.settings.relay?S.settings.relay:'Aucune',S.settings.relay?'ok':'');
  var v;
  if(hlsOk) v='Les flux HLS (.m3u8) devraient être lus via hls.js.';
  else if(nat) v='Les flux HLS (.m3u8) devraient être lus par le lecteur natif de la TV.';
  else v='Aucun moyen de lire le HLS dans ce navigateur : seuls les fichiers directs (mp4...) pourront fonctionner.';
  if(location.protocol==='https:') v+=' Les listes et flux en http seront bloqués : utilisez un relais https ou hébergez cette page en http.';
  var h='<div><span class="brand">STREAMIX</span><span class="tag">Diagnostic de la TV</span></div><div class="scr" style="flex:1;min-height:0;margin-top:1rem">'+rows.join('')+'<div class="verdict">'+esc(v)+'</div></div>';
  h+='<div style="padding:.5rem .3rem"><div class="btn primary" data-f data-act="diag-back">Retour</div><div class="btn" data-f data-act="diag-refresh">Actualiser</div></div>';
  $('s-diag').innerHTML=h;
  show('diag');
  focusIn($('s-diag'),'[data-act="diag-back"]');
}

// ---------- clavier a l'ecran ----------
function kbOpen(title,value,shortcuts,cb,sug){
  KB.sug=sug||null;KB.sugList=[];KB.mask=false;
  KB.open=true;KB.buf=value||'';KB.shift=false;KB.cb=cb;KB.title=title;KB.shortcuts=shortcuts||[];
  $('kb').style.display='block';
  kbRender();
  focusIn($('kb'),'.kbrow .key');
}
function kbRender(focusArg){
  var rows=['1234567890','azertyuiop','qsdfghjklm','wxcvbn.-_/',':?=&@%#+~,'],h,i,j,ch,c;
  h='<div class="kbtitle">'+esc(KB.title)+'</div><div class="kbval"><span id="kbv">'+esc(kbShown())+'</span><span class="caret"></span></div>'+(KB.sug?'<div class="kbcols"><div class="kbleft">':'');
  for(i=0;i<rows.length;i++){
    h+='<div class="kbrow">';
    for(j=0;j<rows[i].length;j++){ch=rows[i].charAt(j);c=KB.shift?ch.toUpperCase():ch;h+='<div class="key" data-f data-act="key" data-arg="'+esc(c)+'">'+esc(c)+'</div>';}
    h+='</div>';
  }
  h+='<div class="kbrow"><div class="key w" data-f data-act="kb-shift" data-arg="shift">'+(KB.shift?'MAJ activée':'Maj')+'</div><div class="key ww" data-f data-act="key" data-arg=" ">Espace</div><div class="key w" data-f data-act="kb-back">Effacer</div><div class="key w" data-f data-act="kb-clear">Tout effacer</div></div>';
  if(KB.shortcuts.length){
    h+='<div class="kbrow">';
    KB.shortcuts.forEach(function(s){h+='<div class="key w" data-f data-act="key" data-arg="'+esc(s)+'">'+esc(s)+'</div>';});
    h+='</div>';
  }
  h+='<div class="kbrow" style="margin-top:.8rem"><div class="key w" data-f data-act="kb-cancel">Annuler</div><div class="key w okk" data-f data-act="kb-ok">Valider</div></div>';
  h+='<div class="help" style="text-align:center">Retour : efface le dernier caractère (puis ferme si vide). Les touches chiffres de la télécommande fonctionnent.</div>';
  if(KB.sug) h+='</div><div class="kbright"><div class="kbsugt">Suggestions (flèche droite pour y aller)</div><div id="kbsug"></div></div></div>';
  $('kb').classList.toggle('withsug',!!KB.sug);
  $('kb').innerHTML=h;
  if(KB.sug) kbSugRender();
  if(focusArg) focusIn($('kb'),'[data-act="'+focusArg+'"]');
}
function kbShown(){return KB.mask?new Array(KB.buf.length+1).join('●'):KB.buf;}
function kbUpd(){var v=$('kbv');if(v) v.textContent=kbShown();if(KB.sug){clearTimeout(KB.sugT);KB.sugT=setTimeout(kbSugRender,150);}}
function kbSugRender(){
  var el=$('kbsug');if(!el||!KB.sug) return;
  var q=KB.buf.trim();
  if(normTxt(q).length<2){KB.sugList=[];el.innerHTML='<div class="sughint">Tape au moins 2 lettres : les suggestions s\'affichent ici.</div>';return;}
  KB.sugList=KB.sug(q);
  if(!KB.sugList.length){el.innerHTML='<div class="sughint">Aucun résultat pour « '+esc(q)+' ».</div>';return;}
  el.innerHTML=KB.sugList.map(function(it,i){var tag=it.t==='series'?'Série':(it.t==='live'?'Chaîne':'Film');
    return '<div class="sug" data-f data-act="kb-sug" data-arg="'+i+'">'+(it.l&&/^https?:/i.test(it.l)?'<img alt="" src="'+esc(it.l)+'">':'<span class="sgi"></span>')+'<span class="sgt">'+esc(it.n)+'</span><span class="sgk">'+tag+'</span></div>';}).join('');
}
function kindOf(it){return it.t==='series'?'series':(it.t==='live'?'live':'vod');}
function openFound(it){
  KB.open=false;KB.cb=null;KB.sug=null;$('kb').style.display='none';
  var k=kindOf(it);
  S.view=null;S.query='';S.searchAll=false;
  if(S.kind!==k){S.kind=k;S.catId='all';}
  refreshBrowse();
  if(it.t==='series'&&!it.u&&!it.p){openSeries(it);return;}
  if(it.t==='vod'&&it.p==='movie'){setTimeout(function(){openFilmFiche(it,null,0);},30);return;}
  var l=[it];play(it,l,0,false);
}
function startSearch(){
  if(!S.data){toast('Chargez d\'abord une playlist.');return;}
  var live=S.kind==='live';
  if(S.view){S.view=null;}
  var go=function(){
    kbOpen(live?'Rechercher une chaîne':'Rechercher un film ou une série','',[],function(v){
      S.query=v.trim();S.searchAll=!!S.query;if(!S.query){S.catId=S.catId||'all';}
      if(S.kind==='fav'&&S.query) S.kind='vod';
      refreshBrowse();
      if(S.query) $('binfo').textContent='Recherche « '+S.query+' » - '+S.items.length+' résultat'+(S.items.length>1?'s':'');
      focusIn($('s-browse'),document.querySelector('#grid .card')?'#grid .card':'#bsearch');
    },function(q){return searchItems(q,live?['live']:['vod','series'],8);});
  };
  if(!live&&S.cur&&S.cur.type==='xtream'&&(!S.data.loaded.vod||!S.data.loaded.series)){
    var tok=++S.tok;loadingOn('Préparation de la recherche (films et séries)...');
    loadKindFast(S.cur,S.data,'vod').then(function(){return loadKindFast(S.cur,S.data,'series');}).then(function(){if(tok!==S.tok) return;loadingOff();go();})
      .catch(function(){if(tok!==S.tok) return;loadingOff();go();});
    return;
  }
  go();
}
function kbAdd(s){if(KB.buf.length<500){KB.buf+=s;kbUpd();}}
function kbDel(){KB.buf=KB.buf.slice(0,-1);kbUpd();}
function kbClose(ok){
  var cb=KB.cb,v=KB.buf;
  KB.open=false;KB.cb=null;KB.sug=null;clearTimeout(KB.sugT);$('kb').style.display='none';
  if(ok&&cb) cb(v); else restoreFocus();
}

// ---------- ouverture de playlist ----------
function xBase(pl){return pl.server+'/player_api.php?username='+encodeURIComponent(pl.user)+'&password='+encodeURIComponent(pl.pass);}
function arr(j){
  if(Array.isArray(j)) return j;
  if(j&&typeof j==='object'){return Object.keys(j).map(function(k){return j[k];});}
  return [];
}
function openPlaylist(id){
  var pl=null,i;
  for(i=0;i<S.playlists.length;i++) if(S.playlists[i].id===id) pl=S.playlists[i];
  if(!pl) return;
  lsSet('streamix.last',pl.id);
  S.cur=pl;S.view=null;S.query='';S.catId='all';S.kind='live';
  S.favs=lsGet('streamix.fav.'+pl.id,[]);
  if(!Array.isArray(S.favs)) S.favs=[];
  rebuildFavSet();
  if(S.cache[pl.id]){S.data=S.cache[pl.id];var pd=S.pend;S.pend=null;showHub();if(pd) hubOpen(pd);return;}
  var tok=++S.tok;
  loadingOn(pl.type==='m3u'?'Téléchargement de la playlist...':'Connexion au serveur...');
  var p;
  if(pl.type==='m3u'){
    p=fetchText(pl.url,120000).then(function(txt){
      if(tok!==S.tok) return null;
      setLoadingText('Analyse de la playlist...');
      return new Promise(function(res,rej){setTimeout(function(){try{res(buildM3UData(parseM3U(txt)));}catch(e){rej(e);}},40);});
    });
  } else {
    p=fetchJSON(xBase(pl),30000).then(function(j){
      var ui=j&&j.user_info;
      if(ui){
        if(ui.auth===0||ui.auth==='0') throw mkErr('auth');
        if(ui.status&&String(ui.status).toLowerCase()!=='active') throw mkErr('expired',ui.status);
        var ex=+ui.exp_date||0;
        pl.info={ok:1,exp:ex,maxc:ui.max_connections||'',actc:ui.active_cons||'',at:Date.now()};
        if(ex&&ex*1000<Date.now()) throw mkErr('expired','expired');
        savePlaylists();
        toast('Codes ACTIFS - '+accountLine(pl.info));
      }
      setLoadingText('Chargement des chaînes...');
      var d={loaded:{},live:{items:[],cats:[]},vod:{items:[],cats:[]},series:{items:[],cats:[]}};
      return loadKindFast(pl,d,'live').then(function(){return d;});
    });
  }
  p.then(function(data){
    if(tok!==S.tok||!data) return;
    S.boot=false;
    loadingOff();
    S.cache[pl.id]=S.data=data;
    preloadKinds(pl,data);
    var pend=S.pend;S.pend=null;
    if(pend){showHub();hubOpen(pend);}else showHub();
  }).catch(function(e){
    if(tok!==S.tok) return;
    loadingOff();
    if(e&&(e.code==='auth'||e.code==='expired'||(e.code==='http'&&/^(401|403|421|423|429|451|461)$/.test(String(e.extra))))){pl.info={ok:0,at:Date.now()};savePlaylists();}
    S.pend=null;
    if(S.boot||S.screen==='hub'){S.boot=false;S.cur=null;S.data=null;showHub();}
    info(e&&(e.code==='auth'||e.code==='expired'||e.code==='http')?'Vérification des codes':'Impossible d\'ouvrir la playlist',errMsg(e));
  });
}
function buildM3UData(items){
  if(!items.length) throw mkErr('empty');
  var d={loaded:{live:1,vod:1,series:1},live:{items:[]},vod:{items:[]},series:{items:[]}};
  items=items.filter(function(it){return !isSep(it.n);});
  if(!items.length) throw mkErr('empty');
  items.forEach(function(it){it.c=it.g||'Sans groupe';it.k=it.t+':'+it.u;d[it.t].items.push(it);});
  ['live','vod','series'].forEach(function(k){d[k].cats=buildCats(d[k].items);});
  return d;
}
var KIND_API={live:['get_live_categories','get_live_streams'],vod:['get_vod_categories','get_vod_streams'],series:['get_series_categories','get_series']};
function isSep(name){
  var n=String(name==null?'':name).replace(/^\s+|\s+$/g,'');
  if(!n) return false;
  var c=n.charAt(0),h=n.slice(0,3);
  if(c==='\u25BC'||c==='\u25B2'||c==='\u25BA') return true;
  if(h==='---'||h==='==='||h==='***') return true;
  if(n.indexOf('\u25CF\u2605')>-1||n.indexOf('\u2605\u25CF')>-1) return true;
  return !/[0-9A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0600-\u06FF]/.test(n);
}
function loadKind(pl,d,kind){
  var a=KIND_API[kind],b=xBase(pl);
  return Promise.all([fetchJSON(b+'&action='+a[0],60000),fetchJSON(b+'&action='+a[1],120000)]).then(function(r){
    var cats=arr(r[0]).map(function(c){return {id:String(c.category_id),name:c.category_name||'Sans nom',count:0};});
    var byId={};cats.forEach(function(c){byId[c.id]=c;});
    var items=arr(r[1]).filter(function(s){return !isSep(s.name);}).map(function(s){
      var cid=String(s.category_id);
      if(byId[cid]) byId[cid].count++;
      if(kind==='live') return {k:'live:'+s.stream_id,n:s.name||'Sans nom',l:s.stream_icon||'',c:cid,t:'live',p:'live',id:s.stream_id,ad:+s.added||0};
      if(kind==='vod') return {k:'vod:'+s.stream_id,n:s.name||'Sans nom',l:s.stream_icon||'',c:cid,t:'vod',p:'movie',id:s.stream_id,ext:s.container_extension||'mp4',ad:+s.added||0};
      return {k:'series:'+s.series_id,n:s.name||'Sans nom',l:s.cover||'',c:cid,t:'series',sid:s.series_id,ad:+s.last_modified||0};
    });
    d[kind]={items:items,cats:cats.filter(function(c){return c.count>0;})};
    d.loaded[kind]=1;
  });
}
// ---------- cache du catalogue sur la TV (IndexedDB) + prechargement en arriere-plan ----------
var IDBP=null;
function idb(){
  if(IDBP) return IDBP;
  IDBP=new Promise(function(res){
    try{var r=window.indexedDB.open('streamix',1);
      r.onupgradeneeded=function(){try{r.result.createObjectStore('cat');}catch(e){}};
      r.onsuccess=function(){res(r.result);};r.onerror=function(){res(null);};r.onblocked=function(){res(null);};
    }catch(e){res(null);}
  });
  return IDBP;
}
function catGet(key){return idb().then(function(db){return new Promise(function(res){if(!db){res(null);return;}try{var q=db.transaction('cat','readonly').objectStore('cat').get(key);q.onsuccess=function(){res(q.result||null);};q.onerror=function(){res(null);};}catch(e){res(null);}});});}
function catPut(key,v){return idb().then(function(db){if(!db) return;try{db.transaction('cat','readwrite').objectStore('cat').put(v,key);}catch(e){}});}
function catClear(){return idb().then(function(db){if(!db) return;try{db.transaction('cat','readwrite').objectStore('cat').clear();}catch(e){}});}
function catDel(key){return idb().then(function(db){if(!db) return;try{db.transaction('cat','readwrite').objectStore('cat')['delete'](key);}catch(e){}});}
var CAT_MAX=24*3600*1000,CAT_REFRESH=3*3600*1000;
function loadKindFast(pl,d,kind){
  if(d.loaded[kind]) return Promise.resolve();
  d.pend=d.pend||{};
  if(d.pend[kind]) return d.pend[kind];
  var key=pl.id+'|'+kind,old=null;
  var p=catGet(key).then(function(c){
    if(c&&c.d&&c.d.items&&Date.now()-c.at<CAT_MAX){
      d[kind]=c.d;d.loaded[kind]=1;
      // liste deja sur la TV : affichage immediat, mise a jour discrete pour la prochaine fois
      if(Date.now()-c.at>CAT_REFRESH) setTimeout(function(){var t={loaded:{}};loadKind(pl,t,kind).then(function(){catPut(key,{at:Date.now(),d:t[kind]});}).catch(function(){});},45000);
      return;
    }
    old=c;
    return loadKind(pl,d,kind).then(function(){catPut(key,{at:Date.now(),d:d[kind]});});
  }).catch(function(e){
    if(old&&old.d&&old.d.items){d[kind]=old.d;d.loaded[kind]=1;return;}
    throw e;
  });
  d.pend[kind]=p;
  p.then(function(){delete d.pend[kind];},function(){delete d.pend[kind];});
  return p;
}
function preloadKinds(pl,d){
  if(!pl||pl.type!=='xtream') return;
  setTimeout(function(){
    if(S.data!==d) return;
    loadKindFast(pl,d,'vod').then(function(){if(S.data===d) return loadKindFast(pl,d,'series');}).catch(function(){});
  },2000);
}
function resolveUrl(it){
  if(it.u) return it.u;
  var pl=S.cur;
  return pl.server+'/'+it.p+'/'+encodeURIComponent(pl.user)+'/'+encodeURIComponent(pl.pass)+'/'+it.id+'.'+(it.p==='live'?(S.settings.liveFmt==='ts'?'ts':'m3u8'):(it.ext||'mp4'));
}

// ---------- navigation catalogue ----------
var TABS=[['live','Direct'],['vod','Films'],['series','Séries'],['fav','Favoris']];
var KIND_LABEL={live:'Direct',vod:'Films',series:'Séries',fav:'Favoris'};
function isEmptyMode(){return !!(S.cur&&S.cur.id==='__none');}
function enterEmptyBrowse(){
  S.cur={id:'__none',type:'m3u',name:''};S.view=null;S.query='';S.catId='all';S.favs=[];rebuildFavSet();
  S.data={loaded:{live:1,vod:1,series:1},live:{items:[],cats:[]},vod:{items:[],cats:[]},series:{items:[],cats:[]}};
  enterBrowse();
}
function enterBrowse(){
  var d=S.data,pl=S.cur,empty=isEmptyMode();
  if(empty){S.avail={live:1,vod:1,series:1};S.kind='live';}
  else if(pl.type==='m3u'){
    S.avail={live:d.live.items.length>0,vod:d.vod.items.length>0,series:d.series.items.length>0};
    S.kind=S.avail.live?'live':(S.avail.vod?'vod':(S.avail.series?'series':'fav'));
  } else {S.avail={live:1,vod:1,series:1};S.kind='live';}
  var h='<div class="brand">STREAMIX</div>';
  TABS.forEach(function(t){
    if(t[0]!=='fav'&&!S.avail[t[0]]) return;
    h+='<div class="btn tab" data-f data-act="tab" data-arg="'+t[0]+'">'+t[1]+'</div>';
  });
  h+='<div class="spacer"></div>'+(empty||S.kind!=='live'?'':'<div class="btn small" id="bguide" data-f data-act="guide">📅 Guide TV</div>')+(empty?'':'<div class="btn small" id="bsort" data-f data-act="sort">↕ '+esc(sortLabel())+'</div><div class="btn small" id="bsearch" data-f data-act="search">Rechercher</div>')+'<div class="btn small" data-f data-act="go-settings">Réglages</div>'+(empty?(S.playlists.length?'<div class="btn small" data-f data-act="go-home">Playlists</div>':'')+'<div class="btn small primary" data-f data-act="home-add" style="margin-right:0">Ajouter une playlist</div>':'<div class="btn small" data-f data-act="go-hub" style="margin-right:0">Accueil</div>');
  $('topbar').innerHTML=h;
  show('browse');
  refreshBrowse();
  focusIn($('s-browse'),empty?'[data-act="home-add"]':'#grid .card');
}
function updateTabs(){
  var t=document.querySelectorAll('#topbar .tab'),i;
  for(i=0;i<t.length;i++) t[i].classList.toggle('on',t[i].getAttribute('data-arg')===S.kind&&!S.view);
  var q=S.query;
  if(!$('bsearch')) return;
  $('bsearch').textContent='Rechercher';
}
function catHtml(id,name,n,on){return '<div class="cat'+(on?' on':'')+'" data-f data-act="cat" data-arg="'+esc(id)+'"><span>'+esc(name)+'</span><span class="n">'+n+'</span></div>';}
function renderCats(){
  var h='';
  if(S.view){
    h+='<div class="cat back" data-f data-act="view-back">Retour aux séries</div>';
    S.view.seasons.forEach(function(s,i){h+=catHtml('s'+i,'Saison '+s.n,s.items.length,i===S.view.sel);});
  } else if(S.kind!=='fav'){
    var d=S.data[S.kind],hid=hiddenCats(S.kind),lk=pinLocked();
    h+=catHtml('all','Toutes',allVisible().length,S.catId==='all');
    if(S.kind==='live'){var hl=histGet().length;if(hl) h+=catHtml('__recent','Récemment regardées',hl,S.catId==='__recent');}
    else {var vl=vhistGet(S.kind).length;if(vl) h+=catHtml('__recent','▶ Déjà vus / à reprendre',vl,S.catId==='__recent');}
    d.cats.forEach(function(c){if(hid[c.id]) return;h+=catHtml(c.id,(lk&&ADULT_RE.test(c.name||'')?'🔒 ':'')+c.name,c.count,S.catId===c.id);});
    var hl2=d.cats.filter(function(c){return hid[c.id];});
    if(hl2.length){
      h+=catHtml('__hidden',(S.showHid?'▾ ':'▸ ')+'Catégories masquées',hl2.length,false).replace('class="cat','class="cat hidtog');
      if(S.showHid) hl2.forEach(function(c){h+=catHtml(c.id,(lk&&ADULT_RE.test(c.name||'')?'🔒 ':'')+c.name,c.count,S.catId===c.id).replace('class="cat','class="cat hidc');});
    }
  }
  $('cats').innerHTML=h;
  $('cats').scrollTop=0;
  $('bbody').classList.toggle('nocats',S.kind==='fav'&&!S.view);
}
function allVisible(){
  var d=S.data[S.kind];if(!d) return [];
  var hid=hiddenCats(S.kind),lk=pinLocked(),bad={},any=false,i;
  for(i=0;i<d.cats.length;i++) if(hid[d.cats[i].id]||(lk&&ADULT_RE.test(d.cats[i].name||''))){bad[d.cats[i].id]=1;any=true;}
  var out=any?d.items.filter(function(it){return !bad[it.c];}):d.items;
  return lk?out.filter(function(it){return !ADULT_RE.test(it.n||'');}):out;
}
// ---------- recherche dans tous les films et series (ou les chaines), sans tenir compte des accents ----------
function normTxt(t){
  t=String(t||'').toLowerCase();
  try{t=t.normalize('NFD').replace(/[̀-ͯ]/g,'');}catch(e){t=t.replace(/[àâä]/g,'a').replace(/[éèêë]/g,'e').replace(/[îï]/g,'i').replace(/[ôö]/g,'o').replace(/[ûùü]/g,'u').replace(/ç/g,'c');}
  return t.replace(/œ/g,'oe').replace(/[^a-z0-9]+/g,' ').trim();
}
function itemNorm(it){if(it._q===undefined) it._q=normTxt(String(it.n||'').replace(LG_PRE,' '));return it._q;}
function visibleOf(kind){
  var d=S.data&&S.data[kind];if(!d||!d.items) return [];
  var hid=hiddenCats(kind),lk=pinLocked(),bad={},any=false,i;
  for(i=0;i<(d.cats||[]).length;i++) if(hid[d.cats[i].id]||(lk&&ADULT_RE.test(d.cats[i].name||''))){bad[d.cats[i].id]=1;any=true;}
  var out=any?d.items.filter(function(it){return !bad[it.c];}):d.items;
  return lk?out.filter(function(it){return !ADULT_RE.test(it.n||'');}):out;
}
var ROMAN={ii:2,iii:3,iv:4,v:5,vi:6,vii:7,viii:8,ix:9,x:10};
function isFrName(n){var c=lgCode(n);return /^(FR|VF|VFF|VFQ|VFI|MULTI|TRUEFRENCH)$/.test(c)||/\b(VFF|VFQ|TRUEFRENCH|MULTI ?VF)\b/i.test(n);}
function yearOf(n){var m=String(n||'').match(/\b(19[0-9]{2}|20[0-9]{2})\b/);return m?+m[1]:9999;}
function seqOf(q){var m=q.replace(/\b(19|20)[0-9]{2}\b/g,' ').match(/\b(ii|iii|iv|v|vi|vii|viii|ix|x|[2-9]|1[0-9])\b/);return m?(ROMAN[m[1]]||+m[1]):1;}
// resultats : version francaise d'abord, puis dans l'ordre de sortie (1, 2, 3... / annee)
function searchItems(q,kinds,max){
  var words=normTxt(q).split(' ').filter(function(w){return w;});if(!words.length) return [];
  var res=[],seen={};
  kinds.forEach(function(kind){
    var l=visibleOf(kind),i,it,n,j,ok,ws;
    for(i=0;i<l.length;i++){it=l[i];n=itemNorm(it);ok=true;ws=0;
      for(j=0;j<words.length;j++){var p=n.indexOf(words[j]);if(p<0){ok=false;break;}if(p>0&&n.charAt(p-1)!==' ') ws=1;}
      if(!ok) continue;
      res.push({it:it,fr:isFrName(it.n)?0:1,ws:ws,y:yearOf(it.n),sq:seqOf(n),n:n});
    }
  });
  res.sort(function(a,b){return a.fr-b.fr||a.ws-b.ws||a.y-b.y||a.sq-b.sq||(a.n<b.n?-1:a.n>b.n?1:0);});
  var out=[],k;
  for(k=0;k<res.length&&out.length<(max||400);k++){var key=res[k].it.k;if(seen[key]) continue;seen[key]=1;out.push(res[k].it);}
  return out;
}
function searchKinds(){return S.kind==='live'?['live']:['vod','series'];}
function currentList(){
  if(S.query&&S.searchAll) return searchItems(S.query,searchKinds(),400);
  var list;
  if(S.view) list=S.view.seasons[S.view.sel].items;
  else if(S.kind==='fav') list=S.favs;
  else {
    list=S.catId==='all'?allVisible():(S.catId==='__recent'?(S.kind==='live'?histGet():vhistGet(S.kind)):S.data[S.kind].items.filter(function(it){return it.c===S.catId;}));
  }
  list=applySort(list);
  if(S.query){var qn=normTxt(S.query).split(' ');list=list.filter(function(it){var n=itemNorm(it);for(var j=0;j<qn.length;j++) if(qn[j]&&n.indexOf(qn[j])<0) return false;return true;});}
  return list;
}
function refreshBrowse(){try{$('grid').className=(S.kind==='live')?'':'poster';}catch(e){}
  updateTabs();renderCats();renderGrid();
}
function renderGrid(){
  S.items=currentList();S.rendered=0;
  $('grid').innerHTML='';
  $('gridwrap').scrollTop=0;
  var where=S.view?(S.view.series.n):(KIND_LABEL[S.kind]+(S.kind!=='fav'&&S.catId!=='all'?' - '+catName(S.catId):''));
  $('binfo').textContent=where+' - '+S.items.length+' élément'+(S.items.length>1?'s':'');
  if(!S.items.length){
    if(isEmptyMode()){$('grid').innerHTML='<div class="empty">'+(S.playlists.length?'Votre playlist n\'a pas pu être chargée (codes non actifs ou serveur indisponible).<br><br>Allez sur <b>Ajouter une playlist</b> en haut à droite pour entrer de nouveaux codes, ou sur <b>Playlists</b> pour réessayer.':'Aucune playlist pour le moment.<br><br>Allez sur <b>Ajouter une playlist</b> en haut à droite pour entrer votre lien M3U ou vos codes Xtream. Vos chaînes, films et séries apparaîtront ici.')+'</div>';return;}
    $('grid').innerHTML='<div class="empty">'+(S.kind==='fav'&&!S.query?'Aucun favori. Placez-vous sur un élément et appuyez sur Rouge, Jaune ou Info (ou utilisez le bouton Favori dans le lecteur).':'Aucun résultat.')+'</div>';
    return;
  }
  appendChunk();
}
function catName(id){
  if(id==='__recent') return 'Récemment regardées';
  var c=S.data[S.kind].cats,i;
  for(i=0;i<c.length;i++) if(c[i].id===id) return c[i].name;
  return id;
}
function cardHtml(it,i){
  var ini=(it.n||'?').replace(/^[^A-Za-z0-9À-ÿ]+/,'').charAt(0).toUpperCase()||'?';
  return '<div class="card" data-f data-act="item" data-arg="'+i+'"><div class="thumb"><span class="ini">'+esc(ini)+'</span>'+(it.l&&/^https?:/i.test(it.l)?'<img class="logo" alt="" src="'+esc(it.l)+'">':'')+(S.favSet[it.k]?'<span class="star"></span>':'')+progHtml(it)+'</div><div class="nm">'+esc(it.n)+'</div></div>';
}
function progHtml(it){
  if(!it||it.t==='live'||it.t==='series') return '';
  var r=resumeInfo(it);
  if(r.pos>0&&r.dur>0) return '<span class="prog"><i style="width:'+Math.max(3,Math.min(97,Math.round(r.pos/r.dur*100)))+'%"></i></span>';
  if(r.seen) return '<span class="seen">✓ Vu</span>';
  return '';
}
function appendChunk(){
  var end=Math.min(S.items.length,S.rendered+60),h='',i;
  for(i=S.rendered;i<end;i++) h+=cardHtml(S.items[i],i);
  S.rendered=end;
  $('grid').insertAdjacentHTML('beforeend',h);
}
function refreshStars(){
  var c=document.querySelectorAll('#grid .card'),i,it,th,st;
  for(i=0;i<c.length;i++){
    it=S.items[+c[i].getAttribute('data-arg')];th=c[i].firstChild;st=th.querySelector('.star');
    if(it&&S.favSet[it.k]){if(!st){st=document.createElement('span');st.className='star';th.appendChild(st);}}
    else if(st) th.removeChild(st);
  }
}
function rebuildFavSet(){S.favSet={};S.favs.forEach(function(f){S.favSet[f.k]=1;});}
var FAV_FIELDS=['k','n','l','t','p','id','ext','u','sid','c'];
function favTarget(it){return (it&&it.sr)?it.sr:it;}
function toggleFav(it,idx){
  it=favTarget(it);
  if(!it||!S.cur||isEmptyMode()) return;
  var pos=-1,i;
  for(i=0;i<S.favs.length;i++) if(S.favs[i].k===it.k) pos=i;
  if(pos>=0){S.favs.splice(pos,1);toast('Retiré des favoris.');}
  else {var c={};FAV_FIELDS.forEach(function(f){if(it[f]!==undefined) c[f]=it[f];});S.favs.push(c);toast('Ajouté aux favoris.');}
  saveFavs();rebuildFavSet();
  if(it.t==='series') toast(S.favSet[it.k]?'Série « '+it.n+' » ajoutée aux favoris.':'Série « '+it.n+' » retirée des favoris.');
  if(S.kind==='fav'&&!S.view&&!P.open){
    renderGrid();
    var cards=document.querySelectorAll('#grid .card');
    if(cards.length) setFocus(cards[Math.min(idx||0,cards.length-1)]); else focusIn($('s-browse'),'.tab.on');
  } else refreshStars();
  updateFavBtn();
}
function switchKind(kind){
  if(S.view) S.view=null;
  S.kind=kind;S.catId='all';
  if(kind!=='fav'&&S.cur.type==='xtream'&&!S.data.loaded[kind]){
    var tok=++S.tok;
    loadingOn('Chargement : '+KIND_LABEL[kind]+'...');
    loadKindFast(S.cur,S.data,kind).then(function(){
      if(tok!==S.tok) return;
      loadingOff();refreshBrowse();focusIn($('s-browse'),'.tab.on');
    }).catch(function(e){
      if(tok!==S.tok) return;
      loadingOff();S.kind='live';refreshBrowse();
      info('Chargement impossible',errMsg(e));
    });
    return;
  }
  refreshBrowse();
}
function closeView(){
  S.view=null;refreshBrowse();
  focusIn($('s-browse'),'#grid .card');
}
function buildSeasons(it,j){
  var eps=j&&j.episodes,seasons=[];
  if(Array.isArray(eps)) eps=eps.reduce(function(o,a,i){o[i+1]=a;return o;},{});
  Object.keys(eps||{}).sort(function(a,b){return (+a)-(+b);}).forEach(function(sn){
    var list=arr(eps[sn]).map(function(ep,i){
      var en=+ep.episode_num||(i+1);
      return {k:'ep:'+ep.id,n:'S'+sn+' E'+en+(ep.title?' - '+ep.title:''),l:(ep.info&&ep.info.movie_image)||it.l,t:'vod',p:'series',id:ep.id,ext:ep.container_extension||'mp4',sr:it,sn:+sn,en:en};
    });
    if(list.length) seasons.push({n:sn,items:list});
  });
  return seasons;
}
// meme episode dans les autres versions de la serie (4K, Full HD, HD, SD...)
function epVersions(ep,cb){
  var sr=ep&&ep.sr;if(!sr||!S.data||!S.data.series||!S.cur||S.cur.type!=='xtream'){cb([]);return;}
  P.epv=P.epv||{};if(P.epv[ep.k]){cb(P.epv[ep.k]);return;}
  var base=lgBase(sr.n),pool=S.data.series.items||[],w=base.split(' ').sort(function(a,b){return b.length-a.length;})[0],cands=[],i,x;
  for(i=0;i<pool.length&&cands.length<8;i++){x=pool[i];if(x&&x.n&&x.k!==sr.k&&x.n.toLowerCase().indexOf(w)>-1&&lgBase(x.n)===base) cands.push(x);}
  var out=[{it:ep,list:P.list,idx:P.idx,sr:sr}],left=cands.length;
  if(!left){P.epv[ep.k]=out;cb(out);return;}
  S.serCache=S.serCache||{};
  cands.forEach(function(c){
    var done=function(seasons){
      (seasons||[]).forEach(function(sv){sv.items.forEach(function(e,b){if(e.sn===ep.sn&&e.en===ep.en) out.push({it:e,list:sv.items,idx:b,sr:c});});});
      if(--left===0){P.epv[ep.k]=out;cb(out);}
    };
    if(S.serCache[c.sid]){done(S.serCache[c.sid]);return;}
    fetchJSON(xBase(S.cur)+'&action=get_series_info&series_id='+encodeURIComponent(c.sid),30000)
      .then(function(j){var ss=buildSeasons(c,j);S.serCache[c.sid]=ss;done(ss);}).catch(function(){done([]);});
  });
}
function epQuickSec(){
  var ep=P.item,res=P.epv&&P.epv[ep.k];
  var B=[['4K','4K UHD'],['FHD','Full HD 1080p'],['HD','HD 720p'],['SD','SD']],cur=vqBucket(ep.sr.n),myl=lgCode(ep.sr.n);
  if(!res){
    epVersions(ep,function(){if(OD.active&&OD.title==='Qualité de l\'image'&&P.item===ep) renderOpt(0);});
    return {t:'Recherche des autres qualités de cet épisode...',opts:B.map(function(b){return {l:b[1]+(b[0]===cur?'':' …'),sel:b[0]===cur,fn:function(){toast('Recherche en cours, un instant...');}};})};
  }
  return {t:'Choisir la qualité de l\'épisode :',opts:B.map(function(b){
    var pick=null;
    res.forEach(function(v){if(vqBucket(v.sr.n)!==b[0]) return;if(!pick||(lgCode(v.sr.n)===myl&&lgCode(pick.sr.n)!==myl)) pick=v;});
    if(!pick) return {l:b[1]+' (pas dispo)',sel:false,fn:function(){toast(b[1]+' : pas de version de cet épisode dans ta playlist.');}};
    return {l:b[1],sel:b[0]===cur,fn:function(){if(pick.it!==ep) switchEp(pick);}};
  })};
}
function switchEp(v){
  var pos=vid.currentTime||0;
  OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';
  play(v.it,v.list,v.idx,P.force);
  if(pos>5){var sk=function(){try{vid.currentTime=pos;}catch(e){}vid.removeEventListener('loadedmetadata',sk);};vid.addEventListener('loadedmetadata',sk);}
  showCtl();
}
// ---------- fiche du film / de la serie avant de lancer ----------
var FI={open:false};
function fiTxt(v){if(v==null) return '';if(Array.isArray(v)) v=v.join(', ');return String(v).replace(/<[^>]*>/g,'').trim();}
function fiDur(info){
  var s=+info.duration_secs||0;
  if(!s&&info.duration){var p=String(info.duration).split(':');if(p.length===3) s=(+p[0])*3600+(+p[1])*60+(+p[2]);else if(+info.duration) s=(+info.duration)*60;}
  if(!s&&info.episode_run_time) s=(+info.episode_run_time||0)*60;
  if(!s) return '';
  var h=Math.floor(s/3600),m=Math.round(s%3600/60);return h?(h+' h '+(m<10?'0':'')+m):(m+' min');
}
function fiMeta(it,info){
  var y=fiTxt(info.releasedate||info.release_date||info.releaseDate||info.year).slice(0,4)||(yearOf(it.n)<9999?String(yearOf(it.n)):''),out=[];
  if(y) out.push(y);
  var d=fiDur(info);if(d) out.push(d);
  var r=parseFloat(info.rating||info.rating_5based*2||0);if(r>0) out.push('★ '+(Math.round(r*10)/10));
  var g=fiTxt(info.genre);if(g) out.push(g);
  return out.join('  ·  ');
}
function fiTags(n){
  var t=[];n=String(n||'');
  if(/\b(4K|UHD|2160P?)\b/i.test(n)) t.push('4K');else if(/\b(FHD|1080P?)\b/i.test(n)) t.push('Full HD');
  if(/\b(DV|DOVI|DOLBY ?VISION)\b/i.test(n)) t.push('Dolby Vision');else if(/\bHDR/i.test(n)) t.push('HDR');
  var l=lgCode(n);if(l) t.push(lgLabel(l));
  if(/\bVFF\b/i.test(n)) t.push('VFF (doublage France)');else if(/\bVFQ\b/i.test(n)) t.push('VFQ (doublage Québec)');else if(/\bVOSTFR\b/i.test(n)) t.push('VO sous-titrée');
  return t.map(function(x){return '<span class="ftag">'+esc(x)+'</span>';}).join('');
}
function fiTitle(n){return String(n||'').replace(LG_PRE,'').replace(/\s*[\[|(]\s*(MULTI|VFF|VFQ|VFI|VF|VOSTFR|VOST|VO|4K|UHD|FHD|HD|SD|HDR|DV)[^\]|)]*[\]|)]/gi,' ').replace(/\b(MULTI|VFF|VFQ|VFI|TRUEFRENCH|VOSTFR)\b/g,' ').replace(/\s{2,}/g,' ').trim()||String(n||'');}
function fiRender(){
  var it=FI.it,info=FI.info||{},img=fiTxt(info.cover_big||info.movie_image||info.cover)||it.l||'',bd=info.backdrop_path;
  if(Array.isArray(bd)) bd=bd[0];bd=fiTxt(bd);
  var plot=fiTxt(info.plot||info.description)||(FI.loading?'Chargement de la fiche...':'Pas de résumé disponible pour ce titre.');
  var dir=fiTxt(info.director),cast=fiTxt(info.cast||info.actors);
  var h='<div class="fbg"'+(bd&&/^https?:/i.test(bd)?' style="background-image:url(\''+esc(bd)+'\')"':'')+'></div><div class="fwrap">';
  h+='<div class="fpost">'+(img&&/^https?:/i.test(img)?'<img alt="" src="'+esc(img)+'">':'')+'</div><div class="finfo">';
  h+='<div class="ftitle">'+esc(fiTitle(it.n))+'</div><div class="ftags">'+fiTags(it.n)+'</div>';
  var meta=fiMeta(it,info);if(meta) h+='<div class="fmeta">'+esc(meta)+'</div>';
  h+='<div class="fplot">'+esc(plot)+'</div>';
  if(dir) h+='<div class="fline"><b>Réalisation :</b> '+esc(dir)+'</div>';
  if(cast) h+='<div class="fline fcast"><b>Avec :</b> '+esc(cast)+'</div>';
  h+='<div class="fbtns">'+FI.btns.map(function(b,i){return '<div class="btn'+(i===0?' primary':'')+'" data-f data-act="fi-btn" data-arg="'+i+'">'+esc(b.l)+'</div>';}).join('')+'</div>';
  h+='</div></div>';
  $('fiche').innerHTML=h;
}
function fiShow(it,btns){
  FI.open=true;FI.it=it;FI.btns=btns;FI.from=document.activeElement;
  $('fiche').style.display='block';fiRender();
  focusIn($('fiche'),'[data-act="fi-btn"][data-arg="0"]');
}
function fiBtns(b){FI.btns=b;var f=document.activeElement,arg=f&&f.getAttribute&&f.getAttribute('data-arg');fiRender();focusIn($('fiche'),'[data-act="fi-btn"][data-arg="'+(arg||0)+'"]');}
function closeFiche(){
  if(!FI.open) return;
  FI.open=false;S.tok++;$('fiche').style.display='none';
  if(FI.from&&document.body.contains(FI.from)) setFocus(FI.from); else restoreFocus();
}
function resumeClear(it){var m=lsGet('streamix.resume',{});if(m&&typeof m==='object'){delete m[resumeKey(it)];lsSet('streamix.resume',m);}}
function fmtMin(at){return at>=3600?Math.floor(at/3600)+' h '+(Math.floor(at%3600/60)<10?'0':'')+Math.floor(at%3600/60):Math.floor(at/60)+' min';}
function favBtn(it){return {l:S.favSet[it.k]?'★ Retirer des favoris':'☆ Ajouter aux favoris',fn:function(){toggleFav(it);fiBtnsRefresh();}};}
function openFilmFiche(it,list,idx){
  var go=function(fromStart){var l=list||[it],i=list?idx:0;if(fromStart) resumeClear(it);closeFiche();play(it,l,i,false);};
  FI.refresh=function(){
    var at=resumeGet(it),b=[];
    if(at>30){b.push({l:'▶ Reprendre à '+fmtMin(at),fn:function(){go(false);}});b.push({l:'↺ Depuis le début',fn:function(){go(true);}});}
    else b.push({l:'▶ Lire le film',fn:function(){go(false);}});
    b.push(favBtn(it));b.push({l:'Retour',fn:closeFiche});
    return b;
  };
  FI.info=null;FI.loading=true;
  fiShow(it,FI.refresh());
  if(!S.cur||S.cur.type!=='xtream'||!it.id){FI.loading=false;fiRender();return;}
  var tok=++S.tok;
  fetchJSON(xBase(S.cur)+'&action=get_vod_info&vod_id='+encodeURIComponent(it.id),15000).then(function(j){
    if(tok!==S.tok||!FI.open||FI.it!==it) return;
    FI.info=(j&&j.info)||{};FI.loading=false;fiBtns(FI.btns);
  }).catch(function(){if(tok!==S.tok||!FI.open) return;FI.loading=false;fiRender();focusIn($('fiche'),'[data-act="fi-btn"]');});
}
function fiBtnsRefresh(){if(FI.open&&FI.refresh) fiBtns(FI.refresh());}
function openSeries(it,opts){
  var tok=++S.tok;
  loadingOn('Chargement des épisodes...');
  fetchJSON(xBase(S.cur)+'&action=get_series_info&series_id='+encodeURIComponent(it.sid),60000).then(function(j){
    if(tok!==S.tok) return;
    loadingOff();
    var seasons=buildSeasons(it,j);S.serCache=S.serCache||{};S.serCache[it.sid]=seasons;
    if(!seasons.length){info('Aucun épisode','Ce programme ne contient aucun épisode lisible.');return;}
    var le=lastEpGet(it),si=0,ei=-1;
    if(le) seasons.forEach(function(sv,a){sv.items.forEach(function(e,b){if(e.k===le){si=a;ei=b;}});});
    var showEps=function(){
      S.view={series:it,seasons:seasons,sel:si};
      refreshBrowse();
      focusIn($('s-browse'),ei>=0?'#grid .card[data-arg="'+ei+'"]':'#grid .card');
    };
    var playEp=function(a,b){closeFiche();S.view={series:it,seasons:seasons,sel:a};refreshBrowse();focusIn($('s-browse'),'#grid .card[data-arg="'+b+'"]');play(seasons[a].items[b],seasons[a].items,b,false);};
    if(!opts||!opts.noFiche){
      FI.refresh=function(){
        var b=[];
        if(ei>=0){var ep=seasons[si].items[ei],at=resumeGet(ep);b.push({l:'▶ Reprendre '+ep.n.split(' - ')[0]+(at>30?' à '+fmtMin(at):''),fn:function(){playEp(si,ei);}});}
        else b.push({l:'▶ Regarder S'+seasons[0].n+' E'+(seasons[0].items[0].en||1),fn:function(){playEp(0,0);}});
        b.push({l:'Épisodes ('+seasons.length+' saison'+(seasons.length>1?'s':'')+')',fn:function(){closeFiche();showEps();}});
        b.push(favBtn(it));b.push({l:'Retour',fn:closeFiche});
        return b;
      };
      FI.info=(j&&j.info)||{};FI.loading=false;
      fiShow(it,FI.refresh());
      return;
    }
    S.view={series:it,seasons:seasons,sel:si};
    refreshBrowse();
    if(ei>=0){
      focusIn($('s-browse'),'#grid .card[data-arg="'+ei+'"]');
      var ep=seasons[si].items[ei],at=resumeGet(ep);
      toast('Reprendre : '+ep.n.split(' - ')[0]+(at>30?' à '+(at>=3600?Math.floor(at/3600)+' h '+Math.floor(at%3600/60)+' min':Math.floor(at/60)+' min'):'')+' (OK pour lancer)');
    } else focusIn($('s-browse'),'#grid .card');
  }).catch(function(e){
    if(tok!==S.tok) return;
    loadingOff();info('Impossible de charger les épisodes',errMsg(e));
  });
}
function openItem(i){
  var it=S.items[i];
  if(!it) return;
  if(it.t==='series'&&!it.u&&!it.p){openSeries(it);return;}
  if(it.t==='vod'&&it.p==='movie'){openFilmFiche(it,S.items,i);return;}
  play(it,S.items,i,false);
}

// ---------- lecteur ----------
var vid=null;
// relance toute seule la lecture si elle coupe ou reste bloquee (3 essais pendant un film, 1 au demarrage)
function autoReconnect(why){
  if(!P.open||!P.item) return false;
  var max=P.played?3:1;
  if((P.autoN||0)>=max) return false;
  P.autoN=(P.autoN||0)+1;P.autoAt=Date.now();
  toast('Reconnexion automatique... ('+P.autoN+'/'+max+')');
  P.reconn=true;
  play(P.item,P.list,P.idx,P.force);
  return true;
}
function nextEp(){
  if(!P.item||P.item.p!=='series'||!P.list) return null;
  var n=P.list[P.idx+1];
  if(n&&n.p==='series') return n;
  // fin de saison : premier episode de la saison suivante
  try{if(S.view&&P.item.sr&&S.view.series===P.item.sr){var si=-1,i;for(i=0;i<S.view.seasons.length;i++) if(S.view.seasons[i].items===P.list) si=i;
    var ns=S.view.seasons[si+1];if(si>=0&&ns&&ns.items.length) return {it:ns.items[0],list:ns.items};}}catch(e){}
  return null;
}
function playNext(){
  var n=nextEp();hideNextCard();if(!n) return;
  if(n.it){play(n.it,n.list,0,P.force);} else play(n,P.list,P.idx+1,P.force);
  showCtl();
}
function updNextBtn(){var b=$('pbnext');if(b) b.style.display=nextEp()?'inline-block':'none';var k=$('pbskip');if(k) k.style.display=(P.item&&P.item.p==='series'&&(vid.currentTime||0)<300)?'inline-block':'none';}
function showNextCard(){
  var n=nextEp();if(!n||P.nextShown) return;
  var e=n.it||n;P.nextShown=true;P.nextLeft=10;
  var c=$('pnextcard');c.innerHTML='<div class="nt">Épisode suivant</div><div class="nn">'+esc(e.n)+'</div><div class="nc" id="pnextcnt">Lecture dans 10 s</div><div class="nh">OK : lancer maintenant · Retour : annuler</div>';
  c.style.display='block';
  clearInterval(P.nextT);
  P.nextT=setInterval(function(){P.nextLeft--;var t=$('pnextcnt');if(t) t.textContent='Lecture dans '+P.nextLeft+' s';if(P.nextLeft<=0) playNext();},1000);
}
function hideNextCard(){clearInterval(P.nextT);var c=$('pnextcard');if(c) c.style.display='none';}
function watchStall(){
  clearInterval(P.watchT);P.lastT=-1;P.lastMove=Date.now();
  P.watchT=setInterval(function(){
    if(!P.open||!P.running){clearInterval(P.watchT);return;}
    var t=0;try{t=vid.currentTime||0;}catch(e){}
    var busy=vid.paused||P.ff||P.scrub!=null||$('perr').style.display==='block'||!P.played;
    if(busy||t!==P.lastT){P.lastT=t;P.lastMove=Date.now();
      if(!busy&&P.autoN&&Date.now()-P.autoAt>60000) P.autoN=0;
      return;}
    var lim=S.settings.buffer==='big'?10000:6000;
    if(Date.now()-P.lastMove>lim){P.lastMove=Date.now();autoReconnect('stall');}
  },1000);
}
function perrShow(title,msg,canForce){
  if(!canForce&&autoReconnect('error')) return;
  clearTimeout(P.stallT);
  $('pspin').style.display='none';
  $('player').classList.remove('ctl');
  $('perrt').textContent=title;$('perrm').textContent=msg;
  var h='<div class="btn primary" data-f data-act="p-retry">Réessayer</div>';
  if(canForce) h+='<div class="btn" data-f data-act="p-force">Essayer quand même</div>';
  h+='<div class="btn" data-f data-act="p-back">Retour</div>';
  $('perrb').innerHTML=h;
  $('perr').style.display='block';
  focusIn($('perr'));
}
// ---------- lecteur Samsung AVPlay pour les films / series (plusieurs langues et sous-titres dans un meme fichier) ----------
var AV={on:false,started:false,dur:NaN,cur:0,paused:true,w:0,h:0,rate:1,err:null,url:'',subOn:false,subT:null};
function avOk(){try{return !!(window.webapis&&webapis.avplay&&typeof webapis.avplay.open==='function');}catch(e){return false;}}
function avWanted(url){
  if(!avOk()||!P.item||P.forceClassic||P.noAvOnce) return false;
  if(P.item.t==='live') return S.settings.livePlayer!=='off';
  return !/\.m3u8(\?|$)/i.test(url)&&S.settings.avplay!=='off';
}
function avFire(name){var ev;try{ev=new Event(name);}catch(e){ev=document.createEvent('Event');ev.initEvent(name,false,false);}try{vid.dispatchEvent(ev);}catch(e){}}
var AV_PROPS=['currentTime','duration','paused','buffered','videoWidth','videoHeight','playbackRate','error','audioTracks','textTracks'];
function avInstall(){
  function d(k,get,set){Object.defineProperty(vid,k,{configurable:true,enumerable:true,get:get,set:set||function(){}});}
  d('currentTime',function(){return AV.cur;},function(v){avSeek(v);});
  d('duration',function(){return AV.dur;});
  d('paused',function(){return AV.paused;});
  d('buffered',function(){return {length:0,end:function(){return 0;}};});
  d('videoWidth',function(){return AV.w;});
  d('videoHeight',function(){return AV.h;});
  d('playbackRate',function(){return AV.rate;},function(v){avRate(v);});
  d('error',function(){return AV.err;});
  d('audioTracks',function(){return null;});
  d('textTracks',function(){return null;});
  vid.play=function(){avPlay();return {then:function(f){if(f) f();return this;},'catch':function(){return this;}};};
  vid.pause=function(){avPause();};
  vid.load=function(){};
}
function avUninstall(){
  AV_PROPS.forEach(function(k){try{delete vid[k];}catch(e){}});
  try{delete vid.play;delete vid.pause;delete vid.load;}catch(e){}
}
function avShow(on){
  $('player').classList.toggle('avmode',on);
  document.body.classList.toggle('avplaying',on);
  var o=$('avp');if(o) o.style.display=on?'block':'none';
  if(!on) avSubText('');
}
function avStart(url){
  var ap=webapis.avplay;
  AV.on=true;AV.started=false;AV.played=false;AV.pend=null;AV.dur=NaN;AV.cur=0;AV.paused=true;AV.w=0;AV.h=0;AV.rate=1;AV.err=null;AV.url=url;AV.subOn=false;
  avInstall();avShow(true);
  try{ap.close();}catch(e){}
  try{
    ap.open(url);
    try{ap.setDisplayRect(0,0,1920,1080);}catch(e){}
    try{ap.setTimeoutForBuffering(20);}catch(e){}
    var bb=S.settings.buffer==='big';
    try{ap.setBufferingParam('PLAYER_BUFFER_FOR_PLAY','PLAYER_BUFFER_SIZE_IN_SECOND',bb?10:4);}catch(e){}
    try{ap.setBufferingParam('PLAYER_BUFFER_FOR_RESUME','PLAYER_BUFFER_SIZE_IN_SECOND',bb?20:8);}catch(e){}
    ap.setListener({
      onbufferingstart:function(){avFire('waiting');},
      onbufferingprogress:function(){},
      onbufferingcomplete:function(){if(!AV.paused) avFire('playing');},
      oncurrentplaytime:function(ms){AV.cur=(+ms||0)/1000;avFire('timeupdate');},
      onstreamcompleted:function(){AV.paused=true;avFire('pause');avFire('ended');},
      onevent:function(){},
      onerror:function(e){avFail(e);},
      ondrmevent:function(){},
      onsubtitlechange:function(dur,text){if(AV.subOn) avSubText(text,dur);}
    });
    ap.prepareAsync(function(){
      if(!AV.on||AV.url!==url) return;
      AV.started=true;
      try{AV.dur=(+ap.getDuration()||0)/1000||NaN;}catch(e){}
      avReadSize();applyFormat();
      avPickAudio();avApplySubs();setTimeout(updTrkBtn,500);
      avFire('loadedmetadata');avFire('loadeddata');
      avPlay();
    },function(e){avFail(e);});
  }catch(e){avFail(e);}
}
function avFail(e){
  if(!AV.on) return;
  var url=AV.url,msg=String((e&&(e.name||e.message))||e||'erreur');
  if(!AV.started){
    // le lecteur Samsung refuse ce fichier : on repasse sur le lecteur classique
    avStop();
    $('pspintxt').textContent='Nouvel essai avec le lecteur classique...';
    if(P.item&&P.item.t==='live'){P.noAvOnce=true;startStream(url);P.noAvOnce=false;}
    else{nativeSrc(url);}
    return;
  }
  resumeSave();P.running=false;avStop();
  perrShow('Lecture interrompue','Le lecteur de la TV a signalé un problème ('+msg+') : flux coupé ou réseau instable. Essayez Recharger.',false);
}
function avStop(){
  if(!AV.on) return;
  AV.on=false;AV.started=false;
  try{webapis.avplay.stop();}catch(e){}
  try{webapis.avplay.close();}catch(e){}
  avUninstall();avShow(false);updTrkBtn();
}
document.addEventListener('visibilitychange',function(){
  if(document.hidden&&P.open&&P.running) resumeSave();
  if(document.hidden&&P.open&&!AV.on){try{vid.pause();}catch(e){}}
  if(!AV.on||!AV.started) return;
  try{if(document.hidden) webapis.avplay.suspend(); else webapis.avplay.restore();}catch(e){}
});
function avState(){try{return webapis.avplay.getState();}catch(e){return '';}}
function avPlay(){
  if(!AV.on) return;
  try{webapis.avplay.play();AV.paused=false;avFire('play');avFire('playing');}catch(e){}
  if(!AV.played){
    AV.played=true;
    if(AV.pend!=null){var t=AV.pend;AV.pend=null;try{webapis.avplay.seekTo(Math.floor(t*1000),function(){},function(){});}catch(e){}}
    // certaines TV ne donnent les pistes qu'une fois la lecture lancee : on refait le choix FR
    setTimeout(function(){if(AV.on){avPickAudio();updTrkBtn();}},1500);
  }
}
function avPause(){
  if(!AV.on) return;
  try{if(avState()==='PLAYING') webapis.avplay.pause();}catch(e){}
  AV.paused=true;avFire('pause');
}
function avSeek(t){
  if(!AV.on) return;
  t=Math.max(0,+t||0);if(isFinite(AV.dur)&&AV.dur>1) t=Math.min(t,AV.dur-1);
  AV.cur=t;
  if(!AV.played){AV.pend=t;avFire('timeupdate');return;}
  try{webapis.avplay.seekTo(Math.floor(t*1000),function(){avFire('timeupdate');},function(){});}catch(e){}
  avFire('timeupdate');
}
function avRate(v){
  v=+v||1;
  if(!AV.on) return;
  if(v===1||v===2||v===4){try{webapis.avplay.setSpeed(v);AV.rate=v;return;}catch(e){}}
  if(v!==1) toast('Le lecteur de la TV ne permet que les vitesses 1x, 2x et 4x pour ce film.');
}
function avTracks(type){
  var out=[];
  try{var all=webapis.avplay.getTotalTrackInfo()||[],i,t,x;
    for(i=0;i<all.length;i++){t=all[i];if(t.type!==type) continue;x={};try{x=JSON.parse(t.extra_info||'{}');}catch(e){}out.push({index:t.index,info:x});}}catch(e){}
  return out;
}
function avCurIndex(type){
  try{var c=webapis.avplay.getCurrentStreamInfo()||[],i;for(i=0;i<c.length;i++) if(c[i].type===type) return c[i].index;}catch(e){}
  return -1;
}
function avReadSize(){
  try{var c=webapis.avplay.getCurrentStreamInfo()||[],i,x;
    for(i=0;i<c.length;i++) if(c[i].type==='VIDEO'){x=JSON.parse(c[i].extra_info||'{}');AV.w=+x.Width||+x.width||0;AV.h=+x.Height||+x.height||0;}}catch(e){}
  avFire('resize');
}
// cherche la langue dans les infos de piste, quel que soit le nom du champ donne par la TV
function avLang(info){
  var k,v,best='';info=info||{};
  for(k in info){v=String(info[k]==null?'':info[k]).trim();if(/lang/i.test(k)&&v&&v!=='und'&&v!=='-1'){best=v;break;}}
  if(!best) for(k in info){v=String(info[k]==null?'':info[k]).trim().toLowerCase();if(LANGN[v.split(/[-_]/)[0]]){best=v;break;}}
  return best;
}
function avSubName(t,i){
  var lg=avLang(t.info),raw=JSON.stringify(t.info||{}).toLowerCase(),n=lg?langName(lg,'',i):'Piste '+(i+1);
  if(/forc/.test(raw)) n+=' forcés';
  else if(/sdh|hearing|malentend/.test(raw)) n+=' malentendants';
  return n;
}
function updTrkBtn(){
  var b=$('pbtracks');if(!b) return;
  if(!AV.on||!AV.started){b.textContent='Langue / ST';return;}
  var st=avSubList().filter(function(o){return o.sel;})[0];
  b.textContent=(!st||/^Désactivés/.test(st.l))?'Langue / ST':'Langue / ST : '+st.l;
}
function avChan(n){n=+n||0;return n>=8?' 7.1':n>=6?' 5.1':n===2?' stéréo':'';}
function avAudioList(){
  var tr=avTracks('AUDIO'),cur=avCurIndex('AUDIO');
  return tr.map(function(t,i){var lg=avLang(t.info);return {l:(lg?langName(lg,'',i):'Audio '+(i+1))+avChan(t.info.channels),sel:t.index===cur||(cur<0&&i===0),fn:function(){try{webapis.avplay.setSelectTrack('AUDIO',t.index);}catch(e){toast('Impossible de changer de langue sur ce film.');}}};});
}
function avSubList(){
  var tr=avTracks('TEXT'),cur=avCurIndex('TEXT');if(!tr.length) return [];
  var out=[{l:'Désactivés',sel:!AV.subOn,fn:function(){AV.subOn=false;try{webapis.avplay.setSilentSubtitle(true);}catch(e){}avSubText('');toast('Sous-titres désactivés');updTrkBtn();}}];
  tr.forEach(function(t,i){out.push({l:avSubName(t,i),sel:AV.subOn&&(t.index===cur||(cur<0&&i===0)),fn:function(){try{webapis.avplay.setSelectTrack('TEXT',t.index);webapis.avplay.setSilentSubtitle(false);AV.subOn=true;toast('Sous-titres : '+avSubName(t,i));setTimeout(updTrkBtn,300);}catch(e){toast('Impossible d\'afficher ces sous-titres.');}}});});
  return out;
}
function isLangTrack(info,lg){
  var l=String(avLang(info)||'').toLowerCase(),all=JSON.stringify(info||{}).toLowerCase();
  if(lg==='fr') return /^(fr|fre|fra)\b|^fr[-_]|fran/.test(l)||/\b(vff|vfq|vfi|vf|truefrench|french|français|francais)\b/.test(all);
  return /^(en|eng)\b|^en[-_]|angl|engl/.test(l)||/\b(english|anglais|vo)\b/.test(all);
}
function avPickAudio(){
  var lg=S.settings.audioLang||'fr';if(lg==='any') return;
  var tr=avTracks('AUDIO'),i;
  if(tr.length<2) return;
  for(i=0;i<tr.length;i++) if(isLangTrack(tr[i].info,lg)){if(avCurIndex('AUDIO')!==tr[i].index){try{webapis.avplay.setSelectTrack('AUDIO',tr[i].index);}catch(e){}}return;}
}
function avApplySubs(){
  var tr=avTracks('TEXT'),k=pickSubTrack(tr,function(t){return avLang(t.info);});
  if(k>=0){try{webapis.avplay.setSelectTrack('TEXT',tr[k].index);webapis.avplay.setSilentSubtitle(false);AV.subOn=true;}catch(e){}}
  else{AV.subOn=false;try{webapis.avplay.setSilentSubtitle(true);}catch(e){}}
}
function avSubText(text,dur){
  var el=$('avsub');if(!el) return;
  clearTimeout(AV.subT);
  el.textContent=String(text||'').replace(/<[^>]*>/g,'').replace(/\\N/g,'\n');
  el.style.display=el.textContent?'block':'none';
  if(el.textContent){var sec=+S.settings.subHide||0,ms=+dur||4000;if(sec) ms=Math.min(ms,sec*1000);AV.subT=setTimeout(function(){el.style.display='none';},ms);}
}
function avFormat(){
  var f=S.settings.vFormat||'contain',ap=webapis.avplay,W=1920,H=1080,a=(AV.w&&AV.h)?AV.w/AV.h:16/9,r=W/H,w,h,
      LB='PLAYER_DISPLAY_MODE_LETTER_BOX',FS='PLAYER_DISPLAY_MODE_FULL_SCREEN';
  function set(mode,x,y,ww,hh){try{ap.setDisplayMethod(mode);ap.setDisplayRect(Math.round(x),Math.round(y),Math.round(ww),Math.round(hh));return true;}catch(e){return false;}}
  function roi(v){try{if(typeof ap.setVideoRoi==='function'){ap.setVideoRoi(v[0],v[1],v[2],v[3]);return true;}}catch(e){}return false;}
  roi([0,0,1,1]);
  if(f==='fill'){set(FS,0,0,W,H);return;}
  if(f==='contain'){set(LB,0,0,W,H);return;}
  var ok=false;
  if(f==='cover'){
    if(Math.abs(a-r)<0.02){set(LB,0,0,W,H);return;}
    var k=a>r?r/a:a/r;
    if(roi(a>r?[(1-k)/2,0,k,1]:[0,(1-k)/2,1,k])) ok=set(FS,0,0,W,H);
    if(!ok){if(a>r){h=H;w=H*a;}else{w=W;h=W/a;}ok=set(FS,(W-w)/2,(H-h)/2,w,h);}
  } else if(f==='zoom'){
    var z=1/1.15;
    if(roi([(1-z)/2,(1-z)/2,z,z])) ok=set(LB,0,0,W,H);
    if(!ok){w=W*1.15;h=H*1.15;ok=set(LB,(W-w)/2,(H-h)/2,w,h);}
  }
  if(!ok){set(LB,0,0,W,H);
    // ce format n'est pas possible avec le lecteur Samsung : bascule automatique sur le lecteur classique
    if(P.open&&P.item&&!P.forceClassic){P.forceClassic=true;toast('Ce format passe par le lecteur classique (une seule langue possible). Reviens sur « Adapter » pour retrouver toutes les langues.');setTimeout(function(){if(OD.active) closeOpt();reloadKeepPos();},60);}
  }
}
function teardown(){
  clearInterval(P.ffT);P.ff=0;try{$('player').classList.remove('ff');}catch(e){}
  if(P.running) resumeSave();
  if(AV.on) avStop();
  P.running=false;clearTimeout(P.stallT);clearTimeout(P.ctlT);clearInterval(P.watchT);hideNextCard();
  if(P.hls){try{P.hls.destroy();}catch(e){}P.hls=null;}
  try{vid.pause();vid.removeAttribute('src');vid.load();}catch(e){}
}
function updateFavBtn(){
  if(!P.open||!P.item) return;
  var fk=favTarget(P.item).k,fb=$('pbfav');fb.textContent=S.favSet[fk]?'★':'☆';fb.classList.toggle('on',!!S.favSet[fk]);
}
function play(it,list,idx,force){
  if(!P.open) P.prevFocus=document.activeElement;
  var sameItem0=(P.item===it);
  P.open=true;P.item=it;P.list=list;P.idx=idx;P.force=!!force;P.retry=0;P.nativeTried=false;
  if(!sameItem0&&!P.reconn&&P.forceClassic){P.forceClassic=false;if(S.settings.vFormat==='zoom'||S.settings.vFormat==='cover'){S.settings.vFormat='contain';saveSettings();}}
  if(!P.reconn){P.autoN=0;}P.reconn=false;P.played=false;P.nextShown=false;P.nextCancel=false;hideNextCard();
  $('player').style.display='block';
  teardown();
  $('ptitle').textContent=it.n;
  $('perr').style.display='none';
  $('player').classList.remove('ctl');
  $('ptime').textContent='';
  $('pspintxt').textContent='Chargement du flux...';
  $('pspin').style.display='block';
  var live=(it.t==='live'),sk=document.querySelectorAll('.pseek'),i;
  $('player').classList.toggle('live',live);P.scrub=null;
  for(i=0;i<sk.length;i++) sk[i].style.display=live?'none':'inline-block';
  var fbv=$('pbfav');if(live) $('pbtns').appendChild(fbv); else $('pstarslot').appendChild(fbv);
  var pl=document.querySelectorAll('.plive');for(i=0;i<pl.length;i++) pl[i].style.display=live&&list&&list.length>1?'inline-block':'none';
  try{vid.playbackRate=1;}catch(e){}applyFormat();
  $('pphint').textContent=live?'Gauche / Droite (ou CH+ / CH-) : chaîne précédente / suivante - OK ou Bas : afficher le menu - Retour : quitter':'Barre : Gauche / Droite = -10 s / +10 s - Touches ◀◀ ▶▶ : retour / avance rapide (appuyer plusieurs fois = plus vite, OK = reprendre) - Retour : quitter';
  updateFavBtn();
  var qb=$('pbq');if(qb) qb.textContent='Qualité';updVerBtn(it);updNextBtn();$('pbtoggle').innerHTML=ICO_PAUSE;
  P.resumeDone=false;histAdd(it);vhistAdd(it);lastEpSet(it);loadEpg(it);
  var raw=upStream(resolveUrl(it)),url=(S.settings.relayStreams&&S.settings.relay)?viaRelay(raw):raw;
  P.url=url;
  if(!force&&IS_TIZEN&&location.protocol==='https:'&&/^http:/i.test(url)){
    perrShow('Contenu mixte bloqué',MIXED_MSG+' Le navigateur de la TV peut parfois l\'accepter : vous pouvez essayer quand même.',true);
    return;
  }
  startStream(url);
}
function startStream(url){
  P.running=true;watchStall();
  var isHls=url.indexOf('.m3u8')>-1;
  var mixed=location.protocol==='https:'&&/^http:/i.test(url);
  if(avWanted(url)){
    avStart(url);
  } else if(isHls){
    if(window.Hls&&window.Hls.isSupported()&&!mixed) useHls(url);
    else if(nativeHls()||mixed) nativeSrc(url);
    else {perrShow('HLS non pris en charge','Ce navigateur ne sait pas lire les flux HLS (.m3u8) : ni hls.js, ni lecture native. Ouvrez le diagnostic dans Réglages.',false);return;}
  } else {
    nativeSrc(url);
  }
  clearTimeout(P.stallT);
  P.stallT=setTimeout(function(){
    if(P.open&&P.running) perrShow('Le flux ne démarre pas','Aucune image reçue après 25 secondes : flux hors ligne, format non pris en charge ou blocage CORS. Essayez un autre flux, le relais, ou consultez le diagnostic.',false);
  },25000);
}
function tryPlay(){
  try{var pr=vid.play();if(pr&&pr.catch) pr.catch(function(){showCtl();});}catch(e){}
}
function useHls(url){
  var big=S.settings.buffer==='big',h=new window.Hls({manifestLoadingTimeOut:15000,manifestLoadingMaxRetry:1,levelLoadingMaxRetry:big?4:2,fragLoadingMaxRetry:big?6:3,maxBufferLength:big?60:30,maxMaxBufferLength:big?120:60,maxBufferSize:(big?120:60)*1000*1000,backBufferLength:30,liveSyncDurationCount:big?6:3,liveMaxLatencyDurationCount:big?12:10});
  P.hls=h;
  h.on(window.Hls.Events.MANIFEST_PARSED,function(){applyQPref();applySubs();updQBtn();voiceApply();tryPlay();});
  h.on(window.Hls.Events.AUDIO_TRACKS_UPDATED,function(){pickAudio();});
  h.on(window.Hls.Events.LEVEL_SWITCHED,function(){updQBtn();});
  h.on(window.Hls.Events.SUBTITLE_TRACKS_UPDATED,function(){applySubs();});
  h.on(window.Hls.Events.ERROR,function(ev,d){
    if(!d||!d.fatal) return;
    var T=window.Hls.ErrorTypes,code=d.response&&d.response.code;
    if(d.type===T.NETWORK_ERROR){
      if(d.details==='manifestLoadError'||d.details==='manifestLoadTimeOut'){
        var m;
        if(d.details==='manifestLoadTimeOut') m='Le serveur ne répond pas (délai dépassé).';
        else if(code===401||code===403) m='Accès refusé ('+code+') : identifiants, abonnement expiré ou limite de connexions atteinte.';
        else if(code===404) m='Flux introuvable (404) : la chaîne n\'existe plus ou l\'adresse est fausse.';
        else if(code) m='Le serveur a répondu avec l\'erreur '+code+'.';
        else m='Impossible de joindre le flux : serveur injoignable ou requête bloquée par le navigateur (CORS). Une URL de relais (Réglages) peut aider.';
        if(!code&&d.details==='manifestLoadError'&&!P.nativeTried){
          // La lecture par hls.js est bloquée (CORS) : on essaie la lecture directe du navigateur, qui n'a pas besoin de CORS.
          P.nativeTried=true;try{h.destroy();}catch(e){}P.hls=null;
          $('pspintxt').textContent='Nouvel essai en lecture directe...';
          nativeSrc(url);
          clearTimeout(P.stallT);P.stallT=setTimeout(function(){if(P.open&&P.running) perrShow('Flux injoignable',m,false);},15000);
          return;
        }
        perrShow('Flux injoignable',m,false);return;
      }
      if(P.retry<2){P.retry++;try{h.startLoad();}catch(e){}return;}
      perrShow('Flux interrompu','Le flux ne répond plus (réseau instable, flux coupé ou blocage CORS sur les segments).',false);
    } else if(d.type===T.MEDIA_ERROR){
      if(P.retry<2){P.retry++;try{h.recoverMediaError();}catch(e){}return;}
      perrShow('Vidéo non lisible','Le format vidéo ou audio de ce flux (codec) n\'est pas pris en charge par cette TV. Consultez le diagnostic dans Réglages.',false);
    } else {
      var msg=(d.details==='manifestParsingError')?'Ce n\'est pas un flux HLS valide (liste m3u8 illisible). Le serveur renvoie peut-être une page d\'erreur ou un flux .ts brut.':'Erreur de lecture inattendue ('+(d.details||'inconnue')+').';
      perrShow('Lecture impossible',msg,false);
    }
  });
  h.loadSource(url);
  h.attachMedia(vid);
}
function nativeErrMsg(code){
  var ts=/\.ts(\?|$)/i.test(P.url);
  if(code===1) return ['Lecture interrompue','La lecture a été interrompue.'];
  if(code===2) return ['Erreur réseau','Le flux est injoignable ou la requête est bloquée par le navigateur (CORS ou contenu mixte). Une URL de relais (Réglages) peut aider.'];
  if(code===3) return ['Vidéo corrompue','Le flux est corrompu ou son codec n\'est pas pris en charge par cette TV.'];
  if(ts) return ['Format .ts non lisible','Le format .ts brut n\'est pas lisible par le navigateur de cette TV. Pour les comptes Xtream, choisissez le format m3u8 dans Réglages.'];
  return ['Flux non lisible','Format non pris en charge, flux inaccessible ou bloqué (CORS / contenu mixte). Consultez le diagnostic dans Réglages.'];
}
function closePlayer(){
  teardown();
  P.open=false;
  if(GD.reopen&&!GD.open&&GD.list){GD.reopen=false;GD.open=true;$('player').style.display='none';$('perr').style.display='none';$('guide').style.display='block';gRender(false);return;}
  if(S.screen==='browse'&&S.kind==='live'&&!S.view&&S.data){try{var cs=$('cats').scrollTop;renderCats();$('cats').scrollTop=cs;}catch(e){}}
  $('player').style.display='none';$('perr').style.display='none';
  var f=P.prevFocus;
  if(f&&document.body.contains(f)) setFocus(f); else restoreFocus();
}
function showCtl(){
  if($('perr').style.display==='block') return;
  var p=$('player');
  p.classList.add('ctl');
  if(!document.activeElement||!p.contains(document.activeElement)||!document.activeElement.hasAttribute('data-f')) focusIn(p,P.item&&P.item.t!=='live'&&isFinite(vid.duration)?'#pbar':'#pbtoggle');
  clearTimeout(P.ctlT);
  P.ctlT=setTimeout(hideCtl,7000);
  timeUpd();renderEpg();
}
function hideCtl(){
  $('player').classList.remove('ctl');
  if(document.activeElement&&document.activeElement.blur) document.activeElement.blur();
}
function fmtT(s){s=Math.floor(s||0);var m=Math.floor(s/60),h=Math.floor(m/60);m=m%60;s=s%60;return (h?h+':'+(m<10?'0':''):'')+m+':'+(s<10?'0':'')+s;}
function timeUpd(){
  if(!P.open) return;
  if(P.item&&P.item.t==='live'){$('ptime').textContent='EN DIRECT';return;}
  var d=isFinite(vid.duration)?vid.duration:0,c=(P.scrub!=null)?P.scrub:(vid.currentTime||0),pc=d?Math.max(0,Math.min(100,c/d*100)):0,b=0;
  try{var br=vid.buffered;if(br&&br.length) b=br.end(br.length-1);}catch(e){}
  $('ptime').textContent=d?((P.ff?((P.ff>0?'Avance rapide x':'Retour rapide x')+Math.abs(P.ff)+'  ·  OK pour reprendre ici  ·  '):'')+'Reste '+fmtT(Math.max(0,d-c))+'  ·  fin à '+fmtClock(new Date(Date.now()+(d-c)*1000),!!S.settings.clock12)):'';
  $('pcur').textContent=fmtT(c);$('pdur').textContent=d?fmtT(d):'--:--';
  $('pplayed').style.width=pc+'%';$('pthumb').style.left=pc+'%';
  $('pbuf').style.width=(d?Math.min(100,b/d*100):0)+'%';
  $('ptip').style.left=pc+'%';$('ptip').textContent=fmtT(c);$('ptip').style.display=(P.ff||P.scrub!=null)?'block':'';
}
function scrub(step){
  var d=isFinite(vid.duration)?vid.duration:0;if(!d) return;
  if(P.scrub==null) P.scrub=vid.currentTime||0;
  P.scrubN=(P.scrubN||0)+1;
  var mult=P.scrubN>12?6:(P.scrubN>5?3:1);
  P.scrub=Math.max(0,Math.min(d-1,P.scrub+step*mult));
  timeUpd();
  clearTimeout(P.scrubT);
  P.scrubT=setTimeout(function(){if(P.scrub!=null){try{vid.currentTime=P.scrub;}catch(e){}}P.scrub=null;P.scrubN=0;timeUpd();},700);
}
function seek(d){
  if(P.item&&P.item.t==='live') return;
  if(isFinite(vid.duration)){P.scrub=null;vid.currentTime=Math.max(0,Math.min(vid.duration-1,vid.currentTime+d));}
  timeUpd();
}
function togglePlay(){
  if(vid.paused) tryPlay(); else vid.pause();
}
function zap(d){
  if(!P.item||P.item.t!=='live'||!P.list||!P.list.length) return;
  var n=(P.idx+d+P.list.length)%P.list.length;
  play(P.list[n],P.list,n,P.force);
  showCtl();
}
function playerKey(k){
  if(P.nextShown&&$('pnextcard').style.display==='block'){
    if(k==='ok'||k==='play'||k==='playpause'){playNext();return;}
    if(k==='back'||k==='stop'){P.nextCancel=true;hideNextCard();toast('Épisode suivant annulé.');return;}
  }
  var errShown=$('perr').style.display==='block',ctl=$('player').classList.contains('ctl');
  if(P.ff){
    if(k==='ok'||k==='play'||k==='playpause'||k==='pause'){ffStop(true);return;}
    if(k==='back'||k==='stop'){ffStop(false);if(k==='back') return;}
    if(k==='right'){ffSet(1);return;}
    if(k==='left'){ffSet(-1);return;}
  }
  switch(k){
    case 'back': case 'stop': closePlayer();return;
    case 'play': if(!errShown) tryPlay();return;
    case 'pause': vid.pause();return;
    case 'playpause': if(!errShown){togglePlay();showCtl();}return;
    case 'rew': ffSet(-1);return;
    case 'ff': ffSet(1);return;
    case 'chup': zap(1);return;
    case 'chdn': zap(-1);return;
    case 'red': case 'yellow': case 'info': if(P.item) toggleFav(P.item);return;
  }
  if(errShown||ctl){
    clearTimeout(P.ctlT);
    if(!errShown) P.ctlT=setTimeout(hideCtl,7000);
    var ae=document.activeElement,aid=ae&&ae.id,vodRow=P.item&&P.item.t!=='live'&&$('pseekrow').offsetHeight>0;
    if(vodRow&&k==='down'&&(aid==='pbar'||(ae&&ae.parentNode&&ae.parentNode.id==='pstarslot'))){setFocus(aid==='pbar'?$('pbtoggle'):$('pbopts'));return;}
    if(vodRow&&k==='up'&&ae&&ae.parentNode&&ae.parentNode.id==='pbtns'){setFocus(aid==='pbopts'?$('pbfav'):$('pbar'));return;}
    if(document.activeElement&&document.activeElement.id==='pbar'){
      if(k==='left'){scrub(-10);return;}
      if(k==='right'){scrub(10);return;}
      if(k==='ok'){togglePlay();return;}
    }
    if(k==='ok'){var el=document.activeElement;if(el&&el.hasAttribute('data-f')) el.click();return;}
    if(!move(k)&&!errShown&&(k==='up'||k==='down')) hideCtl();
    return;
  }
  // commandes masquees
  // 1er appui sur OK : affiche le menu (sans mettre en pause) ; 2e appui : pause
  if(k==='ok'){showCtl();return;}
  var live=P.item&&P.item.t==='live';
  if(k==='left'){if(live) zap(-1); else{seek(-10);showCtl();}return;}
  if(k==='right'){if(live) zap(1); else{seek(10);showCtl();}return;}
  if(k==='up'||k==='down'){showCtl();return;}
}
var ICO_PLAY='<svg viewBox="0 0 24 24"><path d="M7 4 L20 12 L7 20 Z" fill="#fff"/></svg>',ICO_PAUSE='<svg viewBox="0 0 24 24"><rect x="5" y="4" width="5" height="16" rx="1" fill="#fff"/><rect x="14" y="4" width="5" height="16" rx="1" fill="#fff"/></svg>';
// ---------- voix plus claires (dialogues renforces, explosions adoucies) ----------
var VC={ctx:null,src:null,chain:null,on:false};
function voiceChain(){
  var c=VC.ctx,comp=c.createDynamicsCompressor(),low=c.createBiquadFilter(),pk=c.createBiquadFilter(),pk2=c.createBiquadFilter(),hi=c.createBiquadFilter(),g=c.createGain();
  low.type='lowshelf';low.frequency.value=180;pk.type='peaking';pk.frequency.value=2500;pk.Q.value=0.8;
  pk2.type='peaking';pk2.frequency.value=1000;pk2.Q.value=1;hi.type='highshelf';hi.frequency.value=7000;
  low.connect(pk);pk.connect(pk2);pk2.connect(hi);hi.connect(comp);comp.connect(g);g.connect(c.destination);
  return {input:low,low:low,pk:pk,pk2:pk2,hi:hi,comp:comp,g:g};
}
function voiceLevel(strong){
  var k=VC.chain;if(!k) return;
  k.low.gain.value=strong?-12:-6;k.pk.gain.value=strong?12:7;k.pk2.gain.value=strong?5:3;k.hi.gain.value=strong?-4:-2;
  k.comp.threshold.value=strong?-40:-30;k.comp.knee.value=10;k.comp.ratio.value=strong?12:6;k.comp.attack.value=0.003;k.comp.release.value=0.2;
  k.g.gain.value=strong?2.2:1.6;
}
function voiceCanHere(){return !AV.on&&!!P.hls&&!!P.item&&P.item.t==='live';}
function voiceApply(){
  var want=(S.settings.voice==='on'||S.settings.voice==='strong')&&voiceCanHere();
  if(!want&&!VC.src) return;
  try{
    if(!VC.ctx){var AC=window.AudioContext||window.webkitAudioContext;if(!AC) return;VC.ctx=new AC();}
    if(!VC.src){VC.src=VC.ctx.createMediaElementSource(vid);VC.chain=voiceChain();}
    try{VC.src.disconnect();}catch(e){}
    if(want){voiceLevel(S.settings.voice==='strong');VC.src.connect(VC.chain.input);}else VC.src.connect(VC.ctx.destination);
    VC.on=want;
    if(VC.ctx.state==='suspended'&&VC.ctx.resume) VC.ctx.resume();
  }catch(e){VC.on=false;}
}
// une source sans autorisation (CORS) deviendrait muette une fois branchee au traitement : on repart d'un lecteur neuf
function voiceResetEl(){
  if(!VC.src) return;
  try{VC.src.disconnect();}catch(e){}
  VC.src=null;VC.chain=null;VC.on=false;
  var o=$('vid'),n=o.cloneNode(false);o.parentNode.replaceChild(n,o);
  initPlayer();applyFormat();
}
function nativeSrc(url){voiceResetEl();vid.src=url;tryPlay();}
function initPlayer(){
  vid=$('vid');
  vid.addEventListener('loadedmetadata',function(){
    applySubs();pickAudio();
    if(P.item&&P.item.t!=='live'&&!P.resumeDone){
      P.resumeDone=true;
      var at=resumeGet(P.item);
      if(at>30&&(!isFinite(vid.duration)||at<vid.duration-60)){
        try{vid.currentTime=at;}catch(e){}
        toast('Reprise à '+(at>=3600?Math.floor(at/3600)+' h '+Math.floor(at%3600/60)+' min':Math.floor(at/60)+' min '+(at%60)+' s')+'.');
      }
    }
  });
  var lastSave=0;
  vid.addEventListener('timeupdate',function(){var n=Date.now();if(n-lastSave>10000){lastSave=n;resumeSave();}});
  wireSubHide();
  vid.addEventListener('playing',function(){
    if(!P.running) return;
    clearTimeout(P.stallT);P.played=true;
    $('pspin').style.display='none';
    $('pbtoggle').innerHTML=ICO_PAUSE;
  });
  vid.addEventListener('waiting',function(){if(P.open&&P.running&&$('perr').style.display!=='block') $('pspin').style.display='block';});
  vid.addEventListener('pause',function(){$('pbtoggle').innerHTML=ICO_PLAY;if(P.running) resumeSave();});
  vid.addEventListener('play',function(){$('pbtoggle').innerHTML=ICO_PAUSE;});
  vid.addEventListener('resize',function(){updQBtn();});
  vid.addEventListener('loadeddata',function(){updQBtn();});
  vid.addEventListener('timeupdate',function(){if($('player').classList.contains('ctl')) timeUpd();});
  vid.addEventListener('error',function(){
    if(!P.running||P.hls||!P.open) return;
    var c=vid.error?vid.error.code:4,m=nativeErrMsg(c);
    perrShow(m[0],m[1],false);
  });
  vid.addEventListener('ended',function(){
    if(P.item&&P.item.p==='series'&&!P.nextCancel&&nextEp()) playNext();
  });
  vid.addEventListener('timeupdate',function(){
    if(!P.item||P.item.p!=='series') return;
    var d=isFinite(vid.duration)?vid.duration:0,c=vid.currentTime||0;
    if(d>120&&d-c<=20&&d-c>0&&!P.nextShown&&!P.nextCancel&&!P.ff&&P.scrub==null) showNextCard();
    var k=$('pbskip');if(k){var on=c<300;if((k.style.display!=='none')!==on) updNextBtn();}
  });
}

// ---------- actions ----------
function act(a,arg,el){
  switch(a){
    case 'home-open': openPlaylist(arg);break;
    case 'home-del':
      var pl=null;S.playlists.forEach(function(p){if(p.id===arg) pl=p;});
      if(!pl) break;
      modal('Supprimer la playlist ?','« '+pl.name+' » sera retirée de cette TV (ses favoris aussi).',[
        {label:'Supprimer',primary:true,fn:function(){
          S.playlists=S.playlists.filter(function(p){return p.id!==arg;});savePlaylists();
          try{window.localStorage.removeItem('streamix.fav.'+arg);}catch(e){}
          delete S.cache[arg];
          if(S.cur&&S.cur.id===arg){S.cur=null;S.data=null;}
          showHome('[data-act="home-add"]');
        }},
        {label:'Annuler'}]);
      break;
    case 'home-add': startAdd();break;
    case 'go-settings': openSettings();break;
    case 'app-exit': askExit();break;
    case 'hub-kind': hubOpen(arg);break;
    case 'hub-search': if(hubNeedPlaylist()) break; enterBrowse(); act('search');break;
    case 'hub-refresh':
      if(!S.playlists.length){toast('Aucune playlist à actualiser.');break;}
      if(S.cur&&S.cur.id!=='__none'){delete S.cache[S.cur.id];['live','vod','series'].forEach(function(k){catDel(S.cur.id+'|'+k);});}
      S.data=null;hubNeedPlaylist();break;
    case 'go-home': showHome();break;
    case 'go-hub': showHub();break;
    case 'go-profile': openProfile();break;
    case 'prof-close': closeProfile();break;
    case 'prof-code': askActivationCode();break;
    case 'prof-sync': toast('Synchronisation...');importAccount(false);refreshLicense();break;
    case 'st-parental': lastFocusSel='[data-act="st-parental"]';dlgParental();break;
    case 'st-hide': lastFocusSel='[data-act="st-hide"]';dlgHide();break;
    case 'st-adv': lastFocusSel='[data-act="st-adv"]';dlgAdvanced();break;
    case 'opt': var oo=OD.list[+arg];if(oo&&oo.fn){oo.fn();if(OD.active&&$('modal').style.display==='block') renderOpt(+arg);}break;
    case 'opt-close': closeOpt();break;
    case 'st-clock': lastFocusSel='[data-act="st-clock"]';dlgClock();break;
    case 'st-cache': lastFocusSel='[data-act="st-cache"]';dlgCache();break;
    case 'st-cache-old': S.cache={};catClear();if(S.cur&&S.data&&!isEmptyMode()){S.cache[S.cur.id]=null;delete S.cache[S.cur.id];}S.data=null;S.cur=null;toast('Cache vidé : la playlist sera rechargée.');break;
    case 'st-auto': lastFocusSel='[data-act="st-auto"]';dlgAuto();break;
    case 'st-hide-live': openHideCats('live');break;
    case 'st-hide-vod': openHideCats('vod');break;
    case 'st-hide-series': openHideCats('series');break;
    case 'st-subs': lastFocusSel='[data-act="st-subs"]';dlgSubs();break;
    case 'st-speed': lastFocusSel='[data-act="st-speed"]';speedTest();break;
    case 'set-site': lastFocusSel='[data-act="set-site"]';dlgSite();break;
    case 'set-site-old':
      lastFocusSel='[data-act="set-site"]';
      kbOpen('Adresse de la page téléphone (ajouter-playlist.html hébergée en ligne)',S.settings.site||'',['https://','.netlify.app/','ajouter-playlist.html'],function(v){S.settings.site=(v||'').trim();saveSettings();openSettings();});
      break;
    case 'hide-tog':
      var hk=hiddenCats(S.hideKind);if(hk[arg]) delete hk[arg]; else hk[arg]=1;lsSet(hideKey(S.hideKind),hk);
      renderHideCats('[data-act="hide-tog"][data-arg="'+arg.replace(/"/g,'\\"')+'"]');
      if(S.screen==='hide'&&S.kind===S.hideKind) {}
      break;
    case 'hide-all': lsSet(hideKey(S.hideKind),{});renderHideCats('[data-act="hide-all"]');break;
    case 'hide-back': openSettings();break;
    case 'add-type': F.type=arg;renderAdd('[data-arg="'+arg+'"]');break;
    case 'add-field':
      var key=arg;lastFocusSel='[data-arg="'+key+'"]';var sc=(key==='url'||key==='server')?['http://','https://','.com',':8080','.m3u','get.php']:[];
      kbOpen(FIELD_LABEL[key],F[key],sc,function(v){F[key]=v;renderAdd('[data-arg="'+key+'"]');});
      break;
    case 'add-save': savePlaylist();break;
    case 'add-cancel': if(!S.playlists.length) showHub(); else showHome();break;
    case 'tab':
      if(arg===S.kind&&!S.view) break;
      S.query='';S.searchAll=false;switchKind(arg);break;
    case 'cat':
      if(arg==='__hidden'){S.showHid=!S.showHid;var st0=$('cats').scrollTop;renderCats();$('cats').scrollTop=st0;focusIn($('s-browse'),'#cats [data-arg="__hidden"]');break;}
      if(!S.view&&pinLocked()&&isAdultCat(S.kind,arg)){
        askPin('Code parental',function(ok){if(ok){S.unlocked=true;var ce=document.querySelector('#cats [data-arg="'+arg.replace(/"/g,'\\"')+'"]');act('cat',arg,ce);} else focusIn($('s-browse'),'#cats .cat.on');});
        break;
      }
      if(S.view){S.view.sel=+arg.slice(1);}else S.catId=arg;
      var cs=document.querySelectorAll('#cats .cat'),i;
      for(i=0;i<cs.length;i++) cs[i].classList.toggle('on',cs[i]===el);
      renderGrid();
      focusIn($('s-browse'),'#grid .card');
      break;
    case 'view-back': closeView();break;
    case 'item': openItem(+arg);break;
    case 'search':
      lastFocusSel='#bsearch';
      startSearch();
      break;
    case 'key': kbAdd(arg);break;
    case 'fi-btn': var fb0=FI.btns&&FI.btns[+arg];if(fb0&&fb0.fn) fb0.fn();break;
    case 'kb-sug': var sit=KB.sugList[+arg];if(sit) openFound(sit);break;
    case 'kb-shift': KB.shift=!KB.shift;kbRender('kb-shift');break;
    case 'kb-back': kbDel();break;
    case 'kb-clear': KB.buf='';kbUpd();break;
    case 'kb-ok': kbClose(true);break;
    case 'kb-cancel': kbClose(false);break;
    case 'modal':
      var b=MD.btns[+arg];modalClose();
      if(b&&b.fn) b.fn(); else restoreFocus();
      break;
    case 'set-relay':
      lastFocusSel='[data-act="set-relay"]';
      kbOpen('URL de relais (laisser vide pour désactiver)',S.settings.relay,['https://','?url=','{url}'],function(v){
        v=v.trim();
        if(v&&!/^https?:\/\//i.test(v)){toast('Le relais doit commencer par http:// ou https://');openSettings();return;}
        S.settings.relay=v;saveSettings();S.cache={};openSettings();
      });
      break;
    case 'set-relaystreams': lastFocusSel='[data-act="set-relaystreams"]';S.settings.relayStreams=!S.settings.relayStreams;saveSettings();openSettings();break;
    case 'set-fmt': lastFocusSel='[data-act="set-fmt"]';S.settings.liveFmt=S.settings.liveFmt==='ts'?'m3u8':'ts';saveSettings();openSettings();break;
    case 'set-diag': lastFocusSel='[data-act="set-diag"]';openDiag();break;
    case 'set-reset':
      modal('Effacer toutes les données ?','Playlists, favoris et réglages seront supprimés de cette TV.',[
        {label:'Tout effacer',primary:true,fn:function(){
          try{
            var ks=[],n,j;
            for(j=0;j<window.localStorage.length;j++){n=window.localStorage.key(j);if(n&&n.indexOf('streamix.')===0&&n!=='streamix.dev'&&n!=='streamix.lic') ks.push(n);}
            ks.forEach(function(x){window.localStorage.removeItem(x);});
          }catch(e){}
          S.playlists=[];S.cache={};S.cur=null;S.data=null;S.favs=[];S.favSet={};
          S.settings={relay:'',relayStreams:false,liveFmt:'m3u8'};
          toast('Données effacées.');showHub();
        }},
        {label:'Annuler'}]);
      break;
    case 'set-back': goBack();break;
    case 'diag-back': openSettings();break;
    case 'diag-refresh': openDiag();break;
    case 'p-back': closePlayer();break;
    case 'p-toggle': togglePlay();break;
    case 'p-seek': seek(+arg);break;
    case 'p-fav': if(P.item) toggleFav(P.item);break;
    case 'p-tracks': if(P.item) dlgTracks();break;
    case 'p-quality': if(P.item) dlgQuality();break;
    case 'p-next': playNext();break;
    case 'p-skip': try{vid.currentTime=(vid.currentTime||0)+85;}catch(e){}toast('Intro passée (+1 min 25)');updNextBtn();break;
    case 'p-versions': if(P.item) dlgVersions();break;
    case 'p-bar': togglePlay();break;
    case 'p-opts': if(P.item) dlgPlayerOpts();break;
    case 'p-chans': dlgChannels();break;
    case 'p-guide': openGuide(true);break;
    case 'guide': openGuide(false);break;
    case 'g-prog': break;
    case 'p-ff': ffSet(+arg);break;
    case 'sort':
      var si=0,j;for(j=0;j<SORTS.length;j++) if(SORTS[j][0]===(S.settings.sort||'provider')) si=j;
      setS('sort',SORTS[(si+1)%SORTS.length][0]);
      $('bsort').textContent='↕ '+sortLabel();renderGrid();
      break;
    case 'p-reload': reloadStream();break;
    case 'p-retry': if(P.item) play(P.item,P.list,P.idx,P.force);break;
    case 'p-force': if(P.item) play(P.item,P.list,P.idx,true);break;
  }
}


// ---------- playlists du compte STREAMIX ----------
var SB_URL='https://havfeafimghxgzfuiyqq.supabase.co',SB_KEY='sb_publishable_Z17ytwlII-oogqV2azA_ww_o4Cv8uik';
function accountFromHash(){
  var h=(location.hash||'').replace(/^#/,''),o={},parts=h.split('&'),i,kv;
  for(i=0;i<parts.length;i++){kv=parts[i].split('=');if(kv[0]) o[kv[0]]=decodeURIComponent(kv[1]||'');}
  var hex=(o.mac||'').replace(/[^0-9a-fA-F]/g,'').toLowerCase();
  if(hex.length!==12||!/^\d{6}$/.test(o.key||'')) return null;
  return {mac:hex.match(/../g).join(':'),key:o.key};
}
function importAccount(quiet){
  var a=accountFromHash();
  if(a){try{window.localStorage.setItem('streamix.acct',JSON.stringify(a));}catch(e){}}
  else a=lsGet('streamix.acct',null)||devId();
  if(!a||!window.fetch) return;
  var before=S.playlists.filter(function(p){return p.acct;}).map(function(p){return p.name+'|'+(p.url||p.server+p.user);}).sort().join(',');
  fetch(SB_URL+'/rest/v1/rpc/get_playlists',{method:'POST',headers:{apikey:SB_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_mac:a.mac,p_key:a.key})})
  .then(function(r){return r.json();}).then(function(res){
    if(!res||!res.ok||!Array.isArray(res.playlists)){if(!quiet) toast('Compte STREAMIX : identifiants invalides.');return;}
    // on garde TOUTES les playlists deja enregistrees sur la TV ; le compte ne fait qu'ajouter / mettre a jour
    var keep=S.playlists.slice(),addPl=function(p){for(var k=0;k<keep.length;k++) if(keep[k].id===p.id){keep[k]=p;return;}keep.push(p);};
    res.playlists.forEach(function(pl){
      var url=String(pl.url||''),parts,p;
      if(url.indexOf('xtream://')===0){
        parts=url.slice(9).split('/');
        if(parts.length<3) return;
        p={id:'acct-'+pl.name,type:'xtream',name:pl.name,server:decodeURIComponent(parts[0]),user:decodeURIComponent(parts[1]),pass:decodeURIComponent(parts[2]),acct:true};
      } else p={id:'acct-'+pl.name,type:'m3u',name:pl.name,url:url,acct:true};
      addPl(p);
    });
    var oldInfo={};S.playlists.forEach(function(p){if(p.info) oldInfo[p.id]=p.info;});
    keep.forEach(function(p){if(!p.info&&oldInfo[p.id]) p.info=oldInfo[p.id];});
    S.playlists=keep;savePlaylists();
    var after=keep.filter(function(p){return p.acct;}).map(function(p){return p.name+'|'+(p.url||p.server+p.user);}).sort().join(',');
    if(after===before){if(!quiet&&res.playlists.length) toast('Playlists à jour.');return;}
    if(res.playlists.length) toast(res.playlists.length+' playlist(s) reçue(s) depuis votre compte STREAMIX');
    if(S.screen==='home') showHome();
    else if(S.screen==='profile') renderProfile();
    if(!hubReady()&&S.playlists.length&&(S.screen==='hub'||S.screen==='profile')){
      var nw=keep.filter(function(p){return p.acct;});
      lsSet('streamix.last',(nw[nw.length-1]||S.playlists[0]).id);
      S.boot=true;openPlaylist((nw[nw.length-1]||S.playlists[0]).id);
    } else if(S.screen==='hub') updateHubStatus();
  }).catch(function(){if(!quiet) toast('Compte STREAMIX : serveur injoignable.');});
}


// ---------- appareil et compte STREAMIX (comme l'appli Android) ----------
var PHONE_PAGE_DEFAULT='https://fascinating-malabi-b55b12.netlify.app/ajouter-playlist.html';
function hwSeed(){
  var id='';
  try{if(window.webapis&&webapis.productinfo&&webapis.productinfo.getDuid) id=webapis.productinfo.getDuid()||'';}catch(e){}
  if(!id){try{if(window.tizen&&tizen.systeminfo&&tizen.systeminfo.getCapability) id=tizen.systeminfo.getCapability('http://tizen.org/system/tizenid')||'';}catch(e){}}
  return id?String(id):'';
}
function hashBytes(str,n){
  var out=[],h1=0x811c9dc5,h2=0x01000193,i,j,c;
  for(j=0;j<n;j++){
    h1=(0x811c9dc5^(j*0x9e3779b1))>>>0;
    for(i=0;i<str.length;i++){c=str.charCodeAt(i);h1^=c;h1=Math.imul(h1,16777619)>>>0;h1^=(h1>>>13);h2=Math.imul(h2^c,2246822519)>>>0;}
    out.push(((h1^h2)>>>((j%4)*8))&255);
  }
  return out;
}
function devId(){
  var d=lsGet('streamix.dev',null);
  if(d&&/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(d.mac||'')&&/^\d{6}$/.test(d.key||'')) return d;
  var b=[],i,seed=hwSeed();
  if(seed){
    // identite stable : la meme TV garde la meme adresse MAC et la meme cle, meme apres reinstallation
    var hb=hashBytes('streamix-'+seed,9);
    b=hb.slice(0,6);b[0]=(b[0]&0xFE)|0x02;
    d={mac:b.map(function(x){return (x<16?'0':'')+x.toString(16);}).join(':'),key:String(100000+(((hb[6]<<16)|(hb[7]<<8)|hb[8])%900000))};
    lsSet('streamix.dev',d);
    return d;
  }
  for(i=0;i<6;i++) b.push(Math.floor(Math.random()*256));
  b[0]=(b[0]&0xFE)|0x02;
  d={mac:b.map(function(x){return (x<16?'0':'')+x.toString(16);}).join(':'),key:String(100000+Math.floor(Math.random()*900000))};
  lsSet('streamix.dev',d);
  return d;
}
function rpc(name,body){
  return fetch(SB_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:SB_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){if(!r.ok) throw mkErr('http',r.status);return r.json();});
}
S.lic=lsGet('streamix.lic',null);
function refreshLicense(){
  var d=devId();
  return rpc('register_device',{p_mac:d.mac,p_key:d.key}).then(function(res){
    if(res&&res.ok){S.lic={status:res.status||'',exp:res.expires_at?Date.parse(res.expires_at):0,at:Date.now()};lsSet('streamix.lic',S.lic);}
    if(S.screen==='profile') renderProfile();
    if(S.screen==='hub') updateHubStatus();
    return S.lic;
  }).catch(function(){return S.lic;});
}
function licActive(){
  var l=S.lic;if(!l||!l.status) return true;
  return (l.status==='active'||l.status==='trial')&&(!l.exp||l.exp>Date.now());
}
function licLabel(){
  var l=S.lic;
  if(!l||!l.status) return 'Non vérifié';
  if(!licActive()) return l.status==='inactive'?'Inactive':'Expirée';
  return l.status==='trial'?'Essai gratuit':'Active';
}
function licExpiry(){
  var l=S.lic;
  if(!l||!l.status) return '-';
  if(!l.exp) return l.status==='active'?'Illimitée':'-';
  return fmtDate(Math.floor(l.exp/1000));
}
function phonePageUrl(){
  var base=(S.settings.site||PHONE_PAGE_DEFAULT||'').trim();
  if(!base) return '';
  var d=devId();
  return base.replace(/#.*$/,'')+'#mac='+encodeURIComponent(d.mac)+'&key='+d.key;
}
function qrSvg(text){
  var m;try{m=window.QRMake(text);}catch(e){return '';}
  var n=m.length,q=4,s=n+q*2,p='',r,c;
  for(r=0;r<n;r++) for(c=0;c<n;c++) if(m[r][c]) p+='M'+(c+q)+' '+(r+q)+'h1v1h-1z';
  return '<svg viewBox="0 0 '+s+' '+s+'" shape-rendering="crispEdges"><rect width="'+s+'" height="'+s+'" fill="#fff"/><path d="'+p+'" fill="#000"/></svg>';
}
var profPoll=null;
function stopProfPoll(){clearInterval(profPoll);profPoll=null;}
function openProfile(){
  S.profFrom=S.screen==='profile'?S.profFrom:S.screen;
  renderProfile();
  show('profile');
  focusIn($('s-profile'),'[data-act="prof-close"]');
  refreshLicense();
  stopProfPoll();
  if(phonePageUrl()) profPoll=setInterval(function(){
    if(S.screen!=='profile'){stopProfPoll();return;}
    var was=licActive()&&S.lic&&S.lic.status==='active'&&!S.lic.exp;
    importAccount(true);
    refreshLicense().then(function(){if(!was&&licActive()&&S.lic&&S.lic.status==='active') toast('STREAMIX est activé. Merci !');});
  },6000);
}
function renderProfile(){
  var d=devId(),url=phonePageUrl(),act=licActive(),foc=document.activeElement&&document.activeElement.getAttribute('data-act');
  var h='<div class="pbox"><div class="ptitle">Compte utilisateur</div><div class="pcols"><div class="pleft">';
  h+='<div class="prow"><div class="pl1">Adresse MAC</div><div class="pv">'+esc(d.mac)+'</div></div>';
  h+='<div class="prow"><div class="pl1">Clé de l\'appareil</div><div class="pv">'+esc(d.key)+'</div></div>';
  h+='<div class="prow"><div class="pl1">Statut du compte</div><div class="pv" style="color:'+(act?'#4cff8f':'#ff6b6b')+'">'+esc(licLabel())+'</div></div>';
  h+='<div class="prow"><div class="pl1">Date d\'expiration</div><div class="pv">'+esc(licExpiry())+'</div></div>';
  h+='<div class="prow"><div class="pl1">Playlists sur cette TV</div><div class="pv">'+S.playlists.length+'</div></div>';
  h+='</div><div class="pright"><div class="pqt">Scannez le QR pour ajouter vos playlists'+(licActive()&&S.lic&&S.lic.status==='active'&&!S.lic.exp?'.':' ou activer STREAMIX.')+'</div>';
  if(url&&window.QRMake){h+='<div class="pqr">'+qrSvg(url)+'</div><div class="pqs">Sur le téléphone : ajoutez un lien M3U ou des codes Xtream, ou activez la TV (paiement ou code). Tout arrive seul sur la TV.</div>';}
  else h+='<div class="pqs" style="color:#ffc857">Page téléphone pas encore configurée.<br><br>Elle se règle dans Paramètres &gt; Adresse de la page téléphone.</div>';
  h+='</div></div><div class="pbtns"><div class="btn" data-f data-act="go-home">Mes playlists</div><div class="btn" data-f data-act="home-add">Ajouter sur la TV</div><div class="btn" data-f data-act="prof-sync">Synchroniser</div><div class="btn" data-f data-act="prof-code">Code d\'activation</div><div class="btn primary" data-f data-act="prof-close">Fermer</div></div></div>';
  $('s-profile').innerHTML=h;
  if(S.screen==='profile'&&foc) focusIn($('s-profile'),'[data-act="'+foc+'"]');
}
function closeProfile(){stopProfPoll();if(S.profFrom==='settings') openSettings(); else showHub('[data-act="go-profile"]');}
function updateHubStatus(){var e=document.querySelector('#s-hub .hstat');if(e) e.innerHTML=hubStatus();}

// ---------- parametres (comme l'appli Android) ----------
var ADULT_RE=/(^|[^a-z])(adult|adulte|adultes|xxx|porn|18\+|\+18)([^a-z]|$)|🔞/i;
function pinSet(){return !!lsGet('streamix.pin',null);}
function pinLocked(){if(S.unlocked&&S.unlockAt&&Date.now()-S.unlockAt>3600000) S.unlocked=false;return pinSet()&&!S.unlocked;}
function isAdultCat(kind,id){
  var d=S.data&&S.data[kind];if(!d||!d.cats) return false;
  for(var i=0;i<d.cats.length;i++) if(d.cats[i].id===id) return ADULT_RE.test(d.cats[i].name||'');
  return false;
}
function hideKey(kind){return 'streamix.hide.'+(S.cur?S.cur.id:'x')+'.'+kind;}
function hiddenCats(kind){var h=lsGet(hideKey(kind),{});return h&&typeof h==='object'?h:{};}
function askPin(title,cb){
  kbOpen(title,'',[],function(v){KB.mask=false;
    v=(v||'').trim();
    if(v===lsGet('streamix.pin','')){S.unlockAt=Date.now();cb(true);} else {toast('Code incorrect.');cb(false);}
  });
  KB.mask=true;kbRender();focusIn($('kb'),'.kbrow .key');
}
function parentalMenu(){
  lastFocusSel='[data-act="st-parental"]';
  if(!pinSet()){
    kbOpen('Nouveau code parental (4 chiffres)','',[],function(v){
      v=(v||'').trim();
      if(!/^\d{4}$/.test(v)){toast('Le code doit contenir 4 chiffres.');openSettings();return;}
      lsSet('streamix.pin',v);S.unlocked=false;toast('Contrôle parental activé : les catégories adultes demandent le code.');openSettings();
    });
    return;
  }
  askPin('Code parental actuel',function(ok){
    if(!ok){openSettings();return;}
    modal('Contrôle parental','Les catégories adultes sont protégées par le code.',[
      {label:'Changer le code',primary:true,fn:function(){try{localStorage.removeItem('streamix.pin');}catch(e){}parentalMenu();}},
      {label:'Désactiver',fn:function(){try{localStorage.removeItem('streamix.pin');}catch(e){}S.unlocked=true;toast('Contrôle parental désactivé.');openSettings();}},
      {label:'Annuler',fn:function(){openSettings();}}]);
  });
}
var SICON={
  tv:'<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"><rect x="10" y="16" width="80" height="54" rx="8"/><path d="M50 70 V84 M30 86 H70"/><path d="M30 50 L42 38 L52 48 L70 30"/></svg>',
  lock:'<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="8"><rect x="20" y="44" width="60" height="44" rx="8" fill="#fff"/><path d="M32 44 V32 a18 18 0 0 1 36 0 V44"/></svg>',
  clock:'<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"><circle cx="50" cy="50" r="38"/><path d="M50 26 V50 L66 60"/></svg>',
  trash:'<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="8" stroke-linejoin="round"><path d="M18 26 H82 M40 26 V16 H60 V26"/><path d="M26 26 L32 88 H68 L74 26"/></svg>',
  sync:'<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"><path d="M80 44 A30 30 0 0 0 26 30 M20 56 A30 30 0 0 0 74 70"/><path d="M80 18 V44 H54 M20 82 V56 H46" stroke-linejoin="round"/></svg>',
  eye:'<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"><path d="M8 50 C24 24 76 24 92 50 C76 76 24 76 8 50 Z"/><circle cx="50" cy="50" r="12" fill="#fff"/><path d="M16 84 L84 16"/></svg>',
  list:'<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"><path d="M34 24 H86 M34 50 H86 M34 76 H86"/><circle cx="16" cy="24" r="4" fill="#fff"/><circle cx="16" cy="50" r="4" fill="#fff"/><circle cx="16" cy="76" r="4" fill="#fff"/></svg>',
  sub:'<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"><rect x="10" y="20" width="80" height="60" rx="10"/><path d="M24 62 H46 M54 62 H76 M24 46 H60"/></svg>',
  speed:'<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"><path d="M14 72 A38 38 0 1 1 86 72"/><path d="M50 62 L70 36"/><circle cx="50" cy="64" r="6" fill="#fff"/></svg>',
  user:'<svg viewBox="0 0 100 100" fill="#fff"><circle cx="50" cy="30" r="20"/><path d="M12 92 C14 64 32 56 50 56 C68 56 86 64 88 92 Z"/></svg>',
  phone:'<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="8"><rect x="28" y="8" width="44" height="84" rx="9"/><path d="M44 78 H56" stroke-linecap="round"/></svg>',
  tool:'<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M62 14 a22 22 0 0 0 -24 30 L12 70 L30 88 L56 62 a22 22 0 0 0 30 -24 L72 52 L58 48 L54 34 Z"/></svg>'
};
function stile(act,icon,label,val){return '<div class="stile" data-f data-act="'+act+'">'+SICON[icon]+'<div class="stl">'+esc(label)+(val!==undefined?'<span class="stv">'+esc(val)+'</span>':'')+'</div></div>';}
function pickSubTrack(list,getLang){
  var mode=S.settings.subMode||'off',lg=S.settings.subLang||'fr',i,l;
  if(mode==='off'||!list||!list.length) return -1;
  for(i=0;i<list.length;i++){l=String(getLang(list[i])||'').toLowerCase();if(lg!=='any'&&(l.indexOf(lg)===0||(lg==='fr'&&/fre|fra|fran/.test(l))||(lg==='en'&&/eng|angl/.test(l)))) return i;}
  return mode==='on'||lg==='any'?0:-1;
}
var subT=null,subWired=null;
function wireSubHide(){
  var v=$('vid');if(!v||!v.textTracks) return;
  if(subWired===v.textTracks) return;
  subWired=v.textTracks;
  function onCue(ev){
    var t=ev&&ev.target;if(!t) return;
    var sec=+S.settings.subHide||0;
    if(!sec||S.settings.subMode==='off') return;
    if(!(t.mode==='showing'||(t.mode==='hidden'&&t.__byUs))) return;
    var ac=t.activeCues,key=ac&&ac.length?(ac[0].startTime+'|'+ac[0].text):'';
    if(!key||key===t.__key) return;
    t.__key=key;
    if(t.mode==='hidden'&&t.__byUs){t.__byUs=false;t.mode='showing';}
    clearTimeout(subT);
    subT=setTimeout(function(){if(t.mode==='showing'&&S.settings.subMode!=='off'){t.__byUs=true;t.mode='hidden';}},sec*1000);
  }
  function hook(t){if(t&&!t.__hooked){t.__hooked=1;t.addEventListener('cuechange',onCue);}}
  for(var i=0;i<v.textTracks.length;i++) hook(v.textTracks[i]);
  v.textTracks.addEventListener&&v.textTracks.addEventListener('addtrack',function(e){hook(e.track);applySubs();});
}
function applySubs(){
  if(AV.on){if(AV.started) avApplySubs();return;}
  wireSubHide();
  try{if(P.hls){var hi=pickSubTrack(P.hls.subtitleTracks,function(t){return t.lang||t.name;});P.hls.subtitleDisplay=hi>=0;P.hls.subtitleTrack=hi;}}catch(e){}
  try{var tt=$('vid').textTracks,ar=[],i;for(i=0;tt&&i<tt.length;i++) ar.push(tt[i]);var ti=P.hls?-2:pickSubTrack(ar,function(t){return t.language||t.label;});if(ti!==-2) for(i=0;i<ar.length;i++) ar[i].mode=i===ti?'showing':'disabled';for(i=0;i<ar.length;i++){ar[i].__byUs=false;ar[i].__key='';}}catch(e){}
}
function speedTest(){
  var url='https://speed.cloudflare.com/__down?bytes=10000000&r='+Date.now(),t0=Date.now(),tok=++S.tok;
  loadingOn('Test de débit en cours...');
  var p0=Date.now();
  fetch('https://speed.cloudflare.com/__down?bytes=1&r='+p0,{cache:'no-store'}).then(function(){
    var ping=Date.now()-p0;t0=Date.now();
    return fetch(url,{cache:'no-store'}).then(function(r){return r.arrayBuffer();}).then(function(b){
      if(tok!==S.tok) return;
      var sec=(Date.now()-t0)/1000,mbps=(b.byteLength*8/1e6)/sec;
      loadingOff();
      info('Test de débit internet','Débit : '+mbps.toFixed(1)+' Mbit/s\nLatence : '+ping+' ms\n\n'+(mbps>=25?'Excellent : 4K possible.':mbps>=10?'Bon : HD et Full HD fluides.':mbps>=5?'Moyen : HD possible, 4K déconseillée.':'Faible : risque de coupures.'));
    });
  }).catch(function(){if(tok!==S.tok) return;loadingOff();info('Test de débit internet','Test impossible : vérifiez la connexion internet de la TV.');});
}
function openHideCats(kind){
  if(!S.cur||!S.data||isEmptyMode()){toast('Chargez d\'abord une playlist.');return;}
  if(S.cur.type==='xtream'&&!S.data.loaded[kind]){
    var tok=++S.tok;loadingOn('Chargement : '+KIND_LABEL[kind]+'...');
    loadKindFast(S.cur,S.data,kind).then(function(){if(tok!==S.tok) return;loadingOff();openHideCats(kind);})
      .catch(function(e){if(tok!==S.tok) return;loadingOff();info('Chargement impossible',errMsg(e));});
    return;
  }
  S.hideKind=kind;renderHideCats();show('hide');focusIn($('s-hide'),'.srow');
}
function renderHideCats(sel){
  var kind=S.hideKind,cats=(S.data[kind]&&S.data[kind].cats)||[],hid=hiddenCats(kind);
  var h='<div><span class="brand">STREAMIX</span><span class="tag">Masquer les catégories : '+esc(KIND_LABEL[kind])+'</span></div><div class="scr" style="flex:1;min-height:0;padding:.3rem;margin-top:1.2rem">';
  if(!cats.length) h+='<div class="empty">Aucune catégorie.</div>';
  cats.forEach(function(c){h+='<div class="srow" data-f data-act="hide-tog" data-arg="'+esc(c.id)+'"><div>'+esc(c.name)+'</div><div class="sv" style="color:'+(hid[c.id]?'var(--err)':'var(--ok)')+'">'+(hid[c.id]?'Masquée':'Visible')+'</div></div>';});
  h+='</div><div style="padding:.5rem .3rem"><div class="btn primary" data-f data-act="hide-back">Retour</div><div class="btn" data-f data-act="hide-all">Tout afficher</div></div>';
  $('s-hide').innerHTML=h;
  if(sel) focusIn($('s-hide'),sel);
}


// ---------- fenetres d'options (sous-menus des parametres) ----------
var OD={active:false,list:[]};
function optDialog(title,build,onClose){OD={active:true,title:title,build:build,onClose:onClose,list:[]};renderOpt(0);}
function renderOpt(fi){
  var secs=OD.build(),h='',n=0;OD.list=[];
  secs.forEach(function(sec){
    h+='<div class="osec">'+(sec.t?'<div class="ost">'+esc(sec.t)+'</div>':'')+'<div class="orow">';
    sec.opts.forEach(function(o){OD.list.push(o);h+='<div class="btn obtn'+(o.sel?' osel':'')+(o.primary?' primary':'')+'" data-f data-act="opt" data-arg="'+n+'">'+(o.sel?'✓ ':'')+esc(o.l)+'</div>';n++;});
    h+='</div></div>';
  });
  h+='<div class="osec" style="text-align:right;margin-bottom:0"><div class="btn primary" data-f data-act="opt-close">Fermer</div></div>';
  MD.open=true;MD.btns=[];
  $('mt').textContent=OD.title;$('mm').textContent='';$('mm').style.display='none';
  $('mb').innerHTML=h;$('modal').classList.add('optm');$('modal').style.display='block';
  focusIn($('modal'),'[data-act="opt"][data-arg="'+(fi||0)+'"]');
}
function closeOpt(){
  OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';
  if(OD.onClose) OD.onClose(); else openSettings();
}
function z2(n){return (n<10?'0':'')+n;}
function nowAdj(){return new Date();}
function fmtClock(d,t12){var hh=d.getHours();return t12?((hh%12||12)+':'+z2(d.getMinutes())+(hh<12?' AM':' PM')):(z2(hh)+':'+z2(d.getMinutes()));}
function fmtDay(d,mode){
  var J=['Dim.','Lun.','Mar.','Mer.','Jeu.','Ven.','Sam.'],M=['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
  if(mode==='none') return '';
  if(mode==='short') return z2(d.getDate())+'/'+z2(d.getMonth()+1)+'/'+d.getFullYear();
  return J[d.getDay()]+' '+d.getDate()+' '+M[d.getMonth()]+' '+d.getFullYear();
}
function setS(k,v){S.settings[k]=v;saveSettings();}
function dlgClock(){
  optDialog('Date et heure',function(){
    var s=S.settings,d=nowAdj(),df=s.dateFmt||'long',off=+s.clockOff||0;
    function adj(m){return function(){setS('clockOff',off+m);};}
    var offTxt=off?((off>0?'+':'-')+Math.floor(Math.abs(off)/60)+' h '+z2(Math.abs(off)%60)+' min'):'aucun';
    return [
      {t:'Format de l\'heure',opts:[{l:'24 heures ('+fmtClock(d,false)+')',sel:!s.clock12,fn:function(){setS('clock12',false);}},{l:'12 heures ('+fmtClock(d,true)+')',sel:!!s.clock12,fn:function(){setS('clock12',true);}}]},
      {t:'Affichage de la date sur l\'accueil',opts:[{l:'Longue ('+fmtDay(d,'long')+')',sel:df==='long',fn:function(){setS('dateFmt','long');}},{l:'Courte ('+fmtDay(d,'short')+')',sel:df==='short',fn:function(){setS('dateFmt','short');}},{l:'Masquée',sel:df==='none',fn:function(){setS('dateFmt','none');}}]},
      {t:'Réglage de l\'heure (horloge de la TV)',opts:[{l:'Ouvrir les réglages de la TV',fn:function(){openTvSettings();}}]}
    ];
  });
}
function openTvSettings(){
  try{
    if(window.tizen&&tizen.application){tizen.application.launch('org.tizen.setting',function(){},function(){toast('Sur la télécommande : bouton Home > Paramètres > Général > Gestionnaire système > Heure.');});return;}
  }catch(e){}
  toast('Sur la télécommande : bouton Home > Paramètres > Général > Gestionnaire système > Heure.');
}
function dlgSubs(){
  optDialog('Sous-titres',function(){
    var s=S.settings,m=s.subMode||'off',sz=s.subSize||'m',lg=s.subLang||'fr',bg=s.subBg||'semi',col=s.subColor||'white';
    function o(k,v,l,cur){return {l:l,sel:cur===v,fn:function(){setS(k,v);applySubStyle();applySubs();}};}
    return [
      {t:'Affichage',opts:[o('subMode','off','Désactivés',m),o('subMode','auto','Automatique (langue préférée)',m),o('subMode','on','Toujours activés',m)]},
      {t:'Langue préférée',opts:[o('subLang','fr','Français',lg),o('subLang','en','Anglais',lg),o('subLang','any','Peu importe',lg)]},
      {t:'Taille du texte',opts:[o('subSize','s','Petite',sz),o('subSize','m','Moyenne',sz),o('subSize','l','Grande',sz),o('subSize','xl','Très grande',sz)]},
      {t:'Couleur',opts:[o('subColor','white','Blanc',col),o('subColor','yellow','Jaune',col)]},
      {t:'Fond',opts:[o('subBg','none','Aucun',bg),o('subBg','semi','Semi-transparent',bg),o('subBg','black','Noir',bg)]},
      {t:'Effacer le sous-titre de l\'écran après',opts:[o('subHide',0,'Jamais',+s.subHide||0),o('subHide',5,'5 secondes',+s.subHide||0),o('subHide',10,'10 secondes',+s.subHide||0),o('subHide',15,'15 secondes',+s.subHide||0)]}
    ];
  });
}
function applySubStyle(){
  var s=S.settings,sz={s:'2.2vw',m:'2.8vw',l:'3.5vw',xl:'4.3vw'}[s.subSize||'m'],bg={none:'transparent',semi:'rgba(0,0,0,.55)',black:'#000'}[s.subBg||'semi'],col=(s.subColor==='yellow')?'#ffe14d':'#fff';
  var el=$('subcss');if(!el){el=document.createElement('style');el.id='subcss';document.head.appendChild(el);}
  el.textContent='#vid::cue{font-size:'+sz+';color:'+col+';background:'+bg+';text-shadow:0 0 .3em #000,0 0 .1em #000}';
}
function dlgParental(){
  if(!pinSet()){
    optDialog('Contrôle parental',function(){return [{t:'Les catégories adultes (Adult, XXX, 18+…) demanderont un code à 4 chiffres.',opts:[{l:'Activer et choisir un code',primary:true,fn:function(){OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';parentalMenu();}}]}];});
    return;
  }
  parentalMenu();
}
function dlgCache(){
  optDialog('Vider le cache et l\'historique',function(){return [
    {t:'Les chaînes, films et séries déjà téléchargés seront rechargés depuis le serveur. Vos playlists et favoris sont conservés.',opts:[{l:'Vider le cache maintenant',primary:true,fn:function(){S.cache={};catClear();S.data=null;S.cur=null;toast('Cache vidé : la playlist sera rechargée.');closeOpt();}}]},
    {t:'Historique',opts:[
      {l:'Effacer l\'historique des chaînes',fn:function(){try{var ks=[],j,n;for(j=0;j<localStorage.length;j++){n=localStorage.key(j);if(n&&n.indexOf('streamix.hist.')===0) ks.push(n);}ks.forEach(function(x){localStorage.removeItem(x);});}catch(e){}toast('Historique des chaînes effacé.');}},
      {l:'Effacer les reprises (films et séries)',fn:function(){try{localStorage.removeItem('streamix.resume');}catch(e){}toast('Reprises de lecture effacées.');}}]}
  ];});
}
function dlgAuto(){
  optDialog('Récupération automatique',function(){
    var s=S.settings;
    return [
      {t:'Récupérer au démarrage les playlists ajoutées avec le QR code ou le site',opts:[{l:'ON',sel:!s.noAuto,fn:function(){setS('noAuto',false);}},{l:'OFF',sel:!!s.noAuto,fn:function(){setS('noAuto',true);}}]},
      {t:'',opts:[{l:'Synchroniser maintenant',fn:function(){toast('Synchronisation...');importAccount(false);refreshLicense();}}]}
    ];
  });
}
function dlgHide(){
  optDialog('Masquer des catégories',function(){
    return [{t:'Choisissez la rubrique',opts:[
      {l:'Direct',fn:function(){OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';openHideCats('live');}},
      {l:'Films (VOD)',fn:function(){OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';openHideCats('vod');}},
      {l:'Séries',fn:function(){OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';openHideCats('series');}}]}];
  });
}
function dlgSite(){
  optDialog('Page téléphone (QR code)',function(){
    var s=S.settings;
    return [
      {t:'Adresse utilisée par le QR code : '+(s.site||PHONE_PAGE_DEFAULT),opts:[
        {l:'Adresse STREAMIX par défaut',sel:!s.site,fn:function(){setS('site','');}},
        {l:'Saisir une autre adresse',sel:!!s.site,fn:function(){OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';
          kbOpen('Adresse de la page téléphone',s.site||'',['https://','.netlify.app/','ajouter-playlist.html'],function(v){setS('site',(v||'').trim());dlgSite();});}}]},
      {t:'',opts:[{l:'Afficher le QR code',fn:function(){OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';S.screen='settings';openProfile();}}]}
    ];
  });
}
function dlgAdvanced(){
  optDialog('Avancé',function(){
    var s=S.settings;
    return [
      {t:'Format des chaînes en direct (Xtream)',opts:[{l:'m3u8 (HLS, conseillé)',sel:s.liveFmt!=='ts',fn:function(){setS('liveFmt','m3u8');S.cache={};}},{l:'ts (brut)',sel:s.liveFmt==='ts',fn:function(){setS('liveFmt','ts');S.cache={};}}]},
      {t:'Relais (facultatif, inutile sur TV Samsung) : '+(s.relay||'aucun'),opts:[
        {l:'Modifier le relais',fn:function(){OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';act('set-relay');}},
        {l:'Flux vidéo par le relais : '+(s.relayStreams?'Oui':'Non'),fn:function(){setS('relayStreams',!s.relayStreams);}}]},
      {t:'',opts:[
        {l:'Diagnostic de la TV',fn:function(){OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';openDiag();}},
        {l:'Effacer toutes les données',fn:function(){OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';act('set-reset');}}]}
    ];
  });
}


// ---------- choisir l'heure soi-meme ----------
function dlgSetTime(){
  var base=nowAdj(),H=base.getHours(),Mi=base.getMinutes();
  function mk(){
    return [
      {t:'Heures',opts:[{l:'◀ -1',fn:function(){H=(H+23)%24;}},{l:z2(H),primary:true,fn:function(){}},{l:'+1 ▶',fn:function(){H=(H+1)%24;}},{l:'-10',fn:function(){H=(H+14)%24;}},{l:'+10',fn:function(){H=(H+10)%24;}}]},
      {t:'Minutes',opts:[{l:'◀ -1',fn:function(){Mi=(Mi+59)%60;}},{l:z2(Mi),primary:true,fn:function(){}},{l:'+1 ▶',fn:function(){Mi=(Mi+1)%60;}},{l:'-10',fn:function(){Mi=(Mi+50)%60;}},{l:'+10',fn:function(){Mi=(Mi+10)%60;}}]},
      {t:'Heure choisie : '+z2(H)+':'+z2(Mi),opts:[
        {l:'Valider cette heure',primary:true,fn:function(){
          var n=new Date(),t=new Date(n.getFullYear(),n.getMonth(),n.getDate(),H,Mi,n.getSeconds()),off=Math.round((t-n)/60000);
          if(off>720) off-=1440; if(off<-720) off+=1440;
          setS('clockOff',off);toast('Heure réglée sur '+z2(H)+':'+z2(Mi)+'.');OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';dlgClock();}},
        {l:'Taper l\'heure au clavier',fn:function(){OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';
          kbOpen('Nouvelle heure (par exemple 18:30)',z2(H)+':'+z2(Mi),[':'],function(v){
            var m=/^\s*(\d{1,2})\s*[:hH.]\s*(\d{1,2})\s*$/.exec(v||'');
            if(!m||+m[1]>23||+m[2]>59){toast('Format attendu : HH:MM, par exemple 18:30');dlgSetTime();return;}
            var n=new Date(),t=new Date(n.getFullYear(),n.getMonth(),n.getDate(),+m[1],+m[2],n.getSeconds()),off=Math.round((t-n)/60000);
            if(off>720) off-=1440; if(off<-720) off+=1440;
            setS('clockOff',off);toast('Heure réglée sur '+z2(+m[1])+':'+z2(+m[2])+'.');dlgClock();
          });}},
        {l:'Annuler',fn:function(){OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';dlgClock();}}]}
    ];
  }
  optDialog('Choisir l\'heure',mk,function(){dlgClock();});
}

// ---------- activation avec un code ----------
var CODE_ERR={invalid_code:'Code inconnu ou désactivé.',used:'Ce code a déjà été utilisé le nombre de fois prévu.',already_redeemed:'Ce code a déjà été utilisé sur cette TV.',locked:'Trop d\'essais : réessayez dans 15 minutes.',not_found:'TV pas encore enregistrée : vérifiez la connexion internet puis réessayez.',invalid_key:'Clé de l\'appareil refusée.'};
function askActivationCode(after){
  kbOpen('Code d\'activation STREAMIX',  '',['-'],function(v){
    v=(v||'').toUpperCase().replace(/\s+/g,'');
    if(!v){if(after) after();return;}
    var d=devId(),tok=++S.tok;
    loadingOn('Vérification du code...');
    rpc('redeem_code',{p_mac:d.mac,p_key:d.key,p_code:v}).then(function(res){
      if(tok!==S.tok) return;loadingOff();
      if(res&&res.ok){
        S.lic={status:res.status||'active',exp:res.expires_at?Date.parse(res.expires_at):0,at:Date.now()};lsSet('streamix.lic',S.lic);
        info('STREAMIX activé','Merci ! Statut : '+licLabel()+(S.lic.exp?' jusqu\'au '+licExpiry():' (licence à vie)')+'.');
        if(S.screen==='profile') renderProfile(); else if(S.screen==='hub') showHub();
      } else {info('Code refusé',CODE_ERR[res&&res.error]||('Activation impossible ('+((res&&res.error)||'erreur')+').'));}
    }).catch(function(){if(tok!==S.tok) return;loadingOff();info('Code refusé','Serveur STREAMIX injoignable : vérifiez la connexion internet de la TV.');});
  });
}
function licBlocked(){
  var d=devId();
  modal('Abonnement non actif','Statut : '+licLabel()+'.\n\nPour activer STREAMIX, entrez un code d\'activation, ou activez-la sur le site fascinating-malabi-b55b12.netlify.app avec :\nAdresse MAC : '+d.mac+'\nClé de l\'appareil : '+d.key,[
    {label:'Activer avec le QR code',primary:true,fn:function(){openProfile();}},
    {label:'Entrer un code',fn:function(){askActivationCode();}},
    {label:'J\'ai payé, vérifier',fn:function(){toast('Vérification...');refreshLicense().then(function(){if(licActive()){toast('Abonnement actif.');showHub();} else toast('Toujours non actif.');});}},
    {label:'Fermer'}]);
}


// ---------- reprise de lecture, historique et guide des programmes (comme l'appli Android) ----------
function lastEpKey(){return 'streamix.lastep.'+(S.cur?S.cur.id:'x');}
function lastEpGet(sr){var m=lsGet(lastEpKey(),{});return (m&&sr&&m[sr.k])||'';}
function lastEpSet(it){if(!it||!it.sr) return;var m=lsGet(lastEpKey(),{});if(!m||typeof m!=='object') m={};m[it.sr.k]=it.k;var ks=Object.keys(m);if(ks.length>200) delete m[ks[0]];lsSet(lastEpKey(),m);}
function resumeKey(it){return (S.cur?S.cur.id:'x')+'|'+(it.k||it.n);}
function resumeGet(it){var m=lsGet('streamix.resume',{});return (m&&+m[resumeKey(it)])||0;}
function resumeSave(){
  if(!P.item||P.item.t==='live'||!vid) return;
  var pos=vid.currentTime||0,dur=isFinite(vid.duration)?vid.duration:0,m=lsGet('streamix.resume',{}),k=resumeKey(P.item),keys;
  if(!m||typeof m!=='object') m={};
  if(pos<30||(dur>0&&pos>dur-90)) delete m[k]; else m[k]=Math.floor(pos);
  keys=Object.keys(m);if(keys.length>300) delete m[keys[0]];
  lsSet('streamix.resume',m);
  var dm=lsGet('streamix.resdur',{});if(!dm||typeof dm!=='object') dm={};
  if(dur>0&&m[k]) dm[k]=Math.floor(dur); else delete dm[k];
  keys=Object.keys(dm);if(keys.length>300) delete dm[keys[0]];lsSet('streamix.resdur',dm);
  if(dur>0&&pos>dur-90){var sm=lsGet('streamix.seen',{});if(!sm||typeof sm!=='object') sm={};sm[k]=1;keys=Object.keys(sm);if(keys.length>1000) delete sm[keys[0]];lsSet('streamix.seen',sm);}
}
function histKey(){return 'streamix.hist.'+(S.cur?S.cur.id:'x');}
function vhistKey(){return 'streamix.vhist.'+(S.cur?S.cur.id:'x');}
function vhistGet(kind){var h=lsGet(vhistKey(),[]);if(!Array.isArray(h)) return [];return kind?h.filter(function(x){return kind==='series'?x.t==='series':x.t!=='series';}):h;}
function vhistAdd(it){
  if(!it||it.t==='live'||!S.cur||isEmptyMode()) return;
  var src=it.sr||it,c={};
  FAV_FIELDS.forEach(function(f){if(src[f]!==undefined) c[f]=src[f];});
  var h=vhistGet().filter(function(x){return x.k!==c.k;});
  h.unshift(c);if(h.length>60) h.length=60;
  lsSet(vhistKey(),h);
}
var RIM={at:0};
function resumeInfo(it){
  if(Date.now()-RIM.at>1500){RIM={at:Date.now(),m:lsGet('streamix.resume',{})||{},dm:lsGet('streamix.resdur',{})||{},sm:lsGet('streamix.seen',{})||{}};}
  var k=resumeKey(it);
  return {pos:+RIM.m[k]||0,dur:+RIM.dm[k]||0,seen:!!RIM.sm[k]};
}
function histGet(){var h=lsGet(histKey(),[]);return Array.isArray(h)?h:[];}
function histAdd(it){
  if(!it||it.t!=='live'||!S.cur||isEmptyMode()) return;
  var h=histGet().filter(function(x){return x.k!==it.k;}),c={};
  FAV_FIELDS.forEach(function(f){if(it[f]!==undefined) c[f]=it[f];});
  h.unshift(c);if(h.length>30) h.length=30;
  lsSet(histKey(),h);
}
function b64txt(t){try{return decodeURIComponent(escape(atob(t)));}catch(e){try{return atob(t);}catch(e2){return t||'';}}}
// ---------- guide TV en grille ----------
var GD={open:false,top:0,rows:7,hw:21,span:3};
function gNow(){return Date.now()/1000;}
function openGuide(fromPlayer){
  if(!S.data||!S.data.live){toast('Chargez d\'abord une playlist.');return;}
  if(!S.cur||S.cur.type!=='xtream'){info('Guide TV','Le guide TV est disponible avec les comptes Xtream (codes serveur / identifiant / mot de passe).');return;}
  var list=(S.kind==='live'&&!S.query&&S.items&&S.items.length&&S.items[0].t==='live')?S.items:visibleOf('live');
  if(fromPlayer&&P.list&&P.list.length) list=P.list;
  if(!list.length){toast('Aucune chaîne à afficher.');return;}
  GD.list=list;GD.cache=GD.cache||{};
  var cur=fromPlayer&&P.item?list.indexOf(P.item):0;if(cur<0) cur=0;
  GD.top=Math.max(0,Math.min(cur,list.length-GD.rows));GD.focusRow=cur;
  var n=gNow();GD.base=Math.floor(n/1800)*1800;GD.start=GD.base;GD.ft=n;
  GD.from=document.activeElement;GD.open=true;
  if(fromPlayer){GD.reopen=true;closePlayer();}
  $('guide').style.display='block';
  gRender(true);
}
function closeGuide(){
  GD.open=false;GD.reopen=false;$('guide').style.display='none';clearInterval(GD.clk);
  if(GD.from&&document.body.contains(GD.from)) setFocus(GD.from); else restoreFocus();
}
function gFetch(ch){
  var c=GD.cache[ch.id];if(c&&(c.loading||Date.now()-c.at<600000)) return;
  GD.cache[ch.id]={loading:true,at:Date.now(),l:[]};
  fetchJSON(xBase(S.cur)+'&action=get_short_epg&stream_id='+encodeURIComponent(ch.id)+'&limit=24',15000).then(function(j){
    var a=(j&&j.epg_listings)||[],out=[],i,o,st,en,ti;
    for(i=0;i<a.length;i++){o=a[i];st=+o.start_timestamp;en=+o.stop_timestamp;ti=b64txt(o.title||'').trim();if(st&&en&&ti) out.push({s:st,e:en,t:ti,d:b64txt(o.description||'').trim()});}
    out.sort(function(x,y){return x.s-y.s;});
    GD.cache[ch.id]={at:Date.now(),l:out};
    if(GD.open) gRender(false);
  }).catch(function(){GD.cache[ch.id]={at:Date.now(),l:[]};if(GD.open) gRender(false);});
}
function gHm(t){return fmtClock(new Date(t*1000),!!S.settings.clock12);}
function gRender(focus){
  var st=GD.start,en=st+GD.span*3600,hw=GD.hw,n=gNow(),h='',r,i;
  h+='<div class="ghead"><span class="brand">STREAMIX</span><span class="gtitle">Guide TV</span><span class="gday">'+esc(fmtDay(new Date(st*1000),'long'))+'</span></div>';
  h+='<div class="ginfo" id="ginfo"></div>';
  h+='<div class="gtimes"><div class="gchh"></div><div class="gtl">';
  for(i=0;i<GD.span*2;i++) h+='<span style="left:'+(i*hw/2)+'rem">'+gHm(st+i*1800)+'</span>';
  h+='</div></div><div class="grows">';
  var nowx=(n-st)/3600*hw;
  for(r=GD.top;r<Math.min(GD.list.length,GD.top+GD.rows);r++){
    var ch=GD.list[r],c=GD.cache[ch.id];gFetch(ch);
    h+='<div class="grow"><div class="gch">'+(ch.l&&/^https?:/i.test(ch.l)?'<img alt="" src="'+esc(ch.l)+'">':'')+'<span>'+(r+1)+'. '+esc(ch.n)+'</span></div><div class="gtl">';
    var progs=(c&&c.l||[]).filter(function(p){return p.e>st&&p.s<en;});
    if(!progs.length) h+='<div class="gp gempty" data-f data-act="g-prog" data-arg="'+r+':-1" style="left:0;width:'+(GD.span*hw-.3)+'rem">'+(c&&c.loading?'Chargement...':'Pas de programme')+'</div>';
    progs.forEach(function(p,k){
      var a=Math.max(p.s,st),b=Math.min(p.e,en),left=(a-st)/3600*hw,w=Math.max(.6,(b-a)/3600*hw-.3);
      h+='<div class="gp'+(p.s<=n&&p.e>n?' gnow':'')+(p.e<=n?' gpast':'')+'" data-f data-act="g-prog" data-arg="'+r+':'+k+'" style="left:'+left+'rem;width:'+w+'rem"><b>'+esc(p.t)+'</b><i>'+gHm(p.s)+' - '+gHm(p.e)+'</i></div>';
    });
    h+='</div></div>';
  }
  h+='</div>';
  if(nowx>=0&&nowx<=GD.span*hw) h+='<div class="gline" style="left:calc(23rem + '+nowx+'rem)"></div>';
  h+='<div class="gfoot">Flèches : se déplacer · OK : regarder la chaîne · Retour : fermer le guide · Haut / Bas en bord d\'écran : chaînes suivantes</div>';
  var keep=document.activeElement&&document.activeElement.getAttribute&&$('guide').contains(document.activeElement)?document.activeElement.getAttribute('data-arg'):null;
  $('guide').innerHTML=h;
  var target=null;
  if(!focus&&keep) target=document.querySelector('#guide [data-arg="'+keep+'"]');
  if(!target) target=gCellAt(GD.focusRow,GD.ft);
  if(target){setFocus(target);gInfo(target);}
}
function gProgs(r){var ch=GD.list[r],c=ch&&GD.cache[ch.id],st=GD.start,en=st+GD.span*3600;return (c&&c.l||[]).filter(function(p){return p.e>st&&p.s<en;});}
function gCellAt(r,t){
  var cells=document.querySelectorAll('#guide [data-arg^="'+r+':"]'),pr=gProgs(r),i,best=cells[0]||null;
  for(i=0;i<pr.length;i++) if(pr[i].s<=t&&pr[i].e>t){best=document.querySelector('#guide [data-arg="'+r+':'+i+'"]')||best;break;}
  return best;
}
function gInfo(el){
  var a=(el.getAttribute('data-arg')||'').split(':'),r=+a[0],k=+a[1],ch=GD.list[r],p=k>=0?gProgs(r)[k]:null,box=$('ginfo');
  GD.focusRow=r;
  if(!box||!ch) return;
  box.innerHTML='<div class="gich">'+esc(ch.n)+'</div>'+(p?'<div class="gipt">'+esc(p.t)+' <span>'+gHm(p.s)+' - '+gHm(p.e)+'</span></div><div class="gid">'+esc(p.d||'')+'</div>':'<div class="gid">Pas d\'informations de programme pour cette chaîne.</div>');
}
function guideKey(k){
  var el=document.activeElement,a=(el&&el.getAttribute&&el.getAttribute('data-arg')||'0:0').split(':'),r=+a[0],ki=+a[1],pr=gProgs(r);
  var curP=ki>=0?pr[ki]:null,t=curP?Math.max(curP.s,GD.start)+1:GD.ft;
  if(k==='back'||k==='stop'){closeGuide();return;}
  if(k==='ok'){var ch=GD.list[r];if(!ch) return;if(curP&&curP.s>gNow()){toast('« '+curP.t+' » commence à '+gHm(curP.s)+'. La chaîne est lancée.');}
    closeGuide();GD.reopen=true;play(ch,GD.list,r,false);showCtl();return;}
  if(k==='up'||k==='down'){
    var nr=r+(k==='down'?1:-1);if(nr<0||nr>=GD.list.length) return;
    GD.ft=t;GD.focusRow=nr;
    if(nr<GD.top||nr>=GD.top+GD.rows){GD.top=Math.max(0,Math.min(GD.list.length-GD.rows,nr-(k==='down'?GD.rows-1:0)));gRender(true);return;}
    var c=gCellAt(nr,t);if(c){setFocus(c);gInfo(c);}return;
  }
  if(k==='left'||k==='right'){
    var nk=ki+(k==='right'?1:-1);
    var c2=ki>=0?document.querySelector('#guide [data-arg="'+r+':'+nk+'"]'):null;
    if(c2){setFocus(c2);gInfo(c2);GD.ft=Math.max(pr[nk].s,GD.start)+1;return;}
    // bord de la grille : on decale d'une heure
    if(k==='right'&&GD.start<GD.base+9*3600){GD.start+=3600;GD.ft=Math.max(t,GD.start+1);gRender(true);}
    else if(k==='left'&&GD.start>GD.base){GD.start-=3600;GD.ft=Math.min(t,GD.start+GD.span*3600-60);gRender(true);}
    return;
  }
}
function loadEpg(it){
  P.epg=[];renderEpg();
  if(!it||it.t!=='live'||!S.cur||S.cur.type!=='xtream'||!it.id) return;
  var tok=P.epgTok=(P.epgTok||0)+1;
  fetchJSON(xBase(S.cur)+'&action=get_short_epg&stream_id='+encodeURIComponent(it.id)+'&limit=6',15000).then(function(j){
    if(tok!==P.epgTok) return;
    var a=(j&&j.epg_listings)||[],out=[],i,o,st,en,ti;
    for(i=0;i<a.length;i++){o=a[i];st=+o.start_timestamp;en=+o.stop_timestamp;ti=b64txt(o.title||'').trim();if(st&&en&&ti) out.push({s:st,e:en,t:ti});}
    out.sort(function(x,y){return x.s-y.s;});
    P.epg=out;renderEpg();
  }).catch(function(){});
}
function renderEpg(){
  var el=$('pepg');if(!el) return;
  var now=Date.now()/1000,list=(P.epg||[]).filter(function(x){return x.e>now;}),cur=null,next=[],h='';
  list.forEach(function(x){if(!cur&&x.s<=now) cur=x; else if(next.length<3) next.push(x);});
  function hm(t){return fmtClock(new Date(t*1000),!!S.settings.clock12);}
  if(cur){var pc=Math.max(0,Math.min(100,(now-cur.s)/(cur.e-cur.s)*100));h+='<div class="enow"><span class="elab">Maintenant</span> <b>'+esc(cur.t)+'</b> <span class="etm">'+hm(cur.s)+' - '+hm(cur.e)+'</span><div class="ebar"><i style="width:'+pc.toFixed(0)+'%"></i></div></div>';}
  if(next.length){h+='<div class="enext"><span class="elab">Ensuite</span> ';next.forEach(function(x,i){h+=(i?'<span class="esep">·</span>':'')+'<span class="etm">'+hm(x.s)+'</span> '+esc(x.t);});h+='</div>';}
  el.innerHTML=h;el.style.display=h?'block':'none';
}


// ---------- langues audio et sous-titres du film en cours ----------
var LANGN={fr:'Français',fre:'Français',fra:'Français',en:'Anglais',eng:'Anglais',es:'Espagnol',spa:'Espagnol',de:'Allemand',ger:'Allemand',deu:'Allemand',it:'Italien',ita:'Italien',pt:'Portugais',por:'Portugais',ar:'Arabe',ara:'Arabe',tr:'Turc',tur:'Turc',nl:'Néerlandais',dut:'Néerlandais',nld:'Néerlandais',ru:'Russe',rus:'Russe',pl:'Polonais',pol:'Polonais',ja:'Japonais',jpn:'Japonais',zh:'Chinois',chi:'Chinois',zho:'Chinois',ko:'Coréen',kor:'Coréen',hi:'Hindi',hin:'Hindi',sv:'Suédois',swe:'Suédois'};
function langName(lang,name,i){
  var l=String(lang||'').toLowerCase().split(/[-_]/)[0],n=String(name||'').trim(),ln=LANGN[l]||'';
  if(n&&ln&&n.toLowerCase().indexOf(ln.toLowerCase())<0&&!/^(audio|track|piste|subtitles?)\s*\d*$/i.test(n)) return ln+' ('+n+')';
  return ln||n||('Piste '+(i+1));
}
function audioTracks(){
  var out=[],i;
  if(AV.on) return avAudioList();
  try{if(P.hls&&P.hls.audioTracks&&P.hls.audioTracks.length){
    P.hls.audioTracks.forEach(function(t,i){out.push({l:langName(t.lang,t.name,i),sel:P.hls.audioTrack===i,fn:function(){P.hls.audioTrack=i;}});});
    return out;}}catch(e){}
  try{var at=vid.audioTracks;if(at&&at.length>1){for(i=0;i<at.length;i++)(function(i){out.push({l:langName(at[i].language,at[i].label,i),sel:!!at[i].enabled,fn:function(){for(var j=0;j<at.length;j++) at[j].enabled=(j===i);}});})(i);}}catch(e){}
  return out;
}
function subTracks(){
  var out=[],i;
  if(AV.on) return avSubList();
  try{if(P.hls&&P.hls.subtitleTracks&&P.hls.subtitleTracks.length){
    out.push({l:'Désactivés',sel:P.hls.subtitleTrack<0||!P.hls.subtitleDisplay,fn:function(){P.hls.subtitleTrack=-1;P.hls.subtitleDisplay=false;}});
    P.hls.subtitleTracks.forEach(function(t,i){out.push({l:langName(t.lang,t.name,i),sel:P.hls.subtitleDisplay&&P.hls.subtitleTrack===i,fn:function(){P.hls.subtitleDisplay=true;P.hls.subtitleTrack=i;}});});
    return out;}}catch(e){}
  try{var tt=vid.textTracks,any=false,list=[];for(i=0;tt&&i<tt.length;i++) if(tt[i].kind==='subtitles'||tt[i].kind==='captions') list.push(tt[i]);
    if(list.length){
      list.forEach(function(t){if(t.mode==='showing'||(t.mode==='hidden'&&t.__byUs)) any=true;});
      out.push({l:'Désactivés',sel:!any,fn:function(){list.forEach(function(t){t.mode='disabled';t.__byUs=false;});}});
      list.forEach(function(t,i){out.push({l:langName(t.language,t.label,i),sel:t.mode==='showing'||(t.mode==='hidden'&&t.__byUs),fn:function(){list.forEach(function(x){x.mode='disabled';x.__byUs=false;});t.mode='showing';t.__key='';}});});
    }}catch(e){}
  return out;
}
function dlgTracks(){
  clearTimeout(P.ctlT);
  optDialog('Langue et sous-titres',function(){
    var a=audioTracks(),st=subTracks(),secs=[];
    secs.push({t:'Langue audio'+(a.length?'':(P.item&&P.item.t==='live'?(AV.on?' (cette chaîne ne diffuse qu\'une langue)':' (pour voir les autres langues d\'une chaîne : ⚙ Image › Lecteur du direct › Samsung)'):' (une seule langue dans ce fichier)')),opts:a.length?a:[{l:'Langue actuelle : '+(lgCode(P.item&&P.item.n)?lgLabel(lgCode(P.item.n)):'langue du fichier'),sel:true,fn:function(){}}]});
    if(P.item&&P.item.t==='live'&&voiceCanHere()) secs.push({t:'Voix plus claires (dialogues renforcés, bruits forts adoucis)',opts:[
      {l:'Non',sel:S.settings.voice!=='on'&&S.settings.voice!=='strong',fn:function(){setS('voice','off');voiceApply();toast('Voix plus claires : désactivé');}},
      {l:'🗣 Léger',sel:S.settings.voice==='on',fn:function(){setS('voice','on');voiceApply();toast(VC.on?'Voix plus claires : léger':'Impossible sur cette TV.');}},
      {l:'🗣🗣 Fort',sel:S.settings.voice==='strong',fn:function(){setS('voice','strong');voiceApply();toast(VC.on?'Voix plus claires : fort':'Impossible sur cette TV.');}}]});
    secs.push({t:'Sous-titres (forcés = seulement les passages en langue étrangère)',opts:st.length?st:[{l:'Aucun sous-titre dans ce film',sel:true,fn:function(){}}]});
    return secs;
  },function(){if(P.open){showCtl();focusIn($('player'),'#pbtracks');}});
}


// ---------- qualite (SD / HD / Full HD / 4K) et rechargement du flux ----------
function qLabel(l){
  var h=+l.height||0,w=+l.width||0,br=+l.bitrate||0,n;
  
  if(h>=2000||w>=3200) n='4K UHD'; else if(h>=1400||w>=2400) n='2K 1440p'; else if(h>=1000||w>=1800) n='Full HD 1080p'; else if(h>=700||w>=1200) n='HD 720p'; else if(h) n='SD '+h+'p'; else n='Qualité';
  return n+(br?' ('+(br/1e6).toFixed(1)+' Mb/s)':'');
}
function qShort(){
  try{
    var lv=P.hls&&P.hls.levels,cur;
    if(lv&&lv.length){
      cur=lv[P.hls.currentLevel>=0?P.hls.currentLevel:(P.hls.loadLevel>=0?P.hls.loadLevel:0)];
      var name=cur?qLabel(cur).split(' (')[0]:'';
      if(lv.length>1&&(P.hls.autoLevelEnabled||P.hls.manualLevel<0)) return 'Auto · '+(name||'…');
      return name||'Qualité';
    }
    if(vid&&vid.videoHeight) return qLabel({height:vid.videoHeight,width:vid.videoWidth}).split(' (')[0];
  }catch(e){}
  return 'Qualité';
}
function updQBtn(){var b=$('pbq');if(b) b.textContent=qShort();}
// ---------- meme film dans une autre langue (entrees FR / EN / VO / VOSTFR / MULTI de la playlist) ----------
var LG_PRE=/^\s*(?:[\[|(]\s*([^\]|)]{1,14}?)\s*[\]|)]|([A-Za-z]{2,6}(?:[\- ][A-Za-z0-9]{1,4})?)\s*[:|]|([A-Za-z]{2,6})\s+-\s+)\s*/;
function lgCode(n){
  n=String(n||'');var m=n.match(LG_PRE),tag=m?(m[1]||m[2]||m[3]||''):'',parts=tag.toUpperCase().split(/[^A-Z]+/),i;
  if(/\bVOSTFR\b/i.test(n)) return 'VOSTFR';if(/\bMULTI\b/i.test(n)) return 'MULTI';
  for(i=0;i<parts.length;i++) if(parts[i]&&!/^(4K|UHD|FHD|HD|SD|HDR|HEVC|K|VIP|TOP|NEW)$/.test(parts[i])&&parts[i].length<=6) return parts[i];
  return '';
}
function lgLabel(c){return {FR:'Français',VF:'Français (VF)',VFF:'Français (VFF)',VFQ:'Québécois (VFQ)',EN:'Anglais',UK:'Anglais',US:'Anglais',VO:'Version originale (VO)',VOSTFR:'VO sous-titrée français',MULTI:'Multi-langues',ES:'Espagnol',DE:'Allemand',IT:'Italien',PT:'Portugais',AR:'Arabe',TR:'Turc',NL:'Néerlandais'}[c]||c;}
function lgBase(n){return vqBase(String(n||'').replace(LG_PRE,' ').replace(/\b(VOSTFR|MULTI|VFF|VFQ|VF|VO|TRUEFRENCH|FRENCH)\b/gi,' '));}
function switchTo(v){
  var pos=P.item&&P.item.t==='live'?0:(vid.currentTime||0);
  OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';
  play(v,P.list,P.idx,P.force);
  if(pos>5){var sk=function(){try{vid.currentTime=pos;}catch(e){}vid.removeEventListener('loadedmetadata',sk);};vid.addEventListener('loadedmetadata',sk);}
  showCtl();
}
function langSec(){
  try{
    var it=P.item;if(!it||it.p==='series'||!S.data) return {t:'',opts:[]};
    var pool=S.data[it.t==='live'?'live':'vod'];pool=pool&&pool.items;if(!pool) return {t:'',opts:[]};
    var base=lgBase(it.n);if(base.length<2) return {t:'',opts:[]};
    var cur=lgCode(it.n),w=base.split(' ').sort(function(a,b){return b.length-a.length;})[0],best={},i,x,c,myq=vqName(it.n);
    for(i=0;i<pool.length;i++){x=pool[i];if(!x||!x.n||x.n.toLowerCase().indexOf(w)<0||sameItem(x,it)) continue;
      c=lgCode(x.n);if(!c||c===cur||lgBase(x.n)!==base) continue;
      // par langue : on garde la meme qualite que le film en cours si possible, sinon la meilleure
      if(!best[c]||(vqName(x.n)===myq&&vqName(best[c].n)!==myq)||(vqName(best[c].n)!==myq&&vqRank(vqName(x.n))<vqRank(vqName(best[c].n)))) best[c]=x;}
    var ks=Object.keys(best);
    if(!ks.length) return {t:'Autres langues : aucune autre langue de ce film dans ta playlist.',opts:[]};
    return {t:'Ce film existe dans une autre langue dans ta playlist (la lecture reprend au même moment) :',opts:ks.map(function(k){var v=best[k];return {l:lgLabel(k)+' — '+vqName(v.n)+' — '+v.n,sel:false,fn:function(){switchTo(v);}};})};
  }catch(e){return {t:'',opts:[]};}
}
// ---------- autres versions du meme film / chaine dans la playlist (4K, Full HD, HD, SD) ----------
var VQ_TAG=/\b(4K|UHD|2160P?|FHD|FULL ?HD|1080P?|HD|720P?|SD|576P?|480P?|HEVC|H\.?265|H\.?264|X265|X264|HDR|10 ?BITS?|LQ|HQ|RAW|50FPS|60FPS|BACKUP|DV|DOVI|DOLBY ?VISION|HDR10\+?|HLG|ATMOS|DTS|E?AC3|DD5 ?1|5 ?1|7 ?1|REMUX|BLU ?RAY|BDRIP|WEB ?DL|WEB ?RIP|WEB|IMAX)\b/gi;
function vqBase(n){return String(n||'').toLowerCase().replace(VQ_TAG,' ').replace(/[^a-z0-9àâäçéèêëîïôöûùüÿœ]+/g,' ').trim();}
function vqName(n){n=String(n||'');if(/\b(4K|UHD|2160P?)\b/i.test(n)) return '4K UHD';if(/\b(FHD|FULL ?HD|1080P?)\b/i.test(n)) return 'Full HD';if(/\b(HD|720P?)\b/i.test(n)) return 'HD';if(/\b(SD|576P?|480P?)\b/i.test(n)) return 'SD';return 'Standard';}
function vqRank(q){return {'4K UHD':0,'Full HD':1,'HD':2,'Standard':3,'SD':4}[q];}
function findVersions(it){
  try{
    if(!it||it.p==='series'||!S.data) return [];
    var pool=S.data[it.t==='live'?'live':'vod'];pool=pool&&pool.items;if(!pool||!pool.length) return [];
    var base=lgBase(it.n);if(base.length<2) return [];
    var w=base.split(' ').sort(function(a,b){return b.length-a.length;})[0],out=[],i,x;
    for(i=0;i<pool.length&&out.length<25;i++){x=pool[i];if(x&&x.n&&x.n.toLowerCase().indexOf(w)>-1&&lgBase(x.n)===base) out.push(x);}
    if(out.length<2) return [];
    var myl=lgCode(it.n);out.sort(function(a,b){return vqRank(vqName(a.n))-vqRank(vqName(b.n))||((lgCode(a.n)===myl?0:1)-(lgCode(b.n)===myl?0:1));});
    return out;
  }catch(e){return [];}
}
function sameItem(a,b){return a===b||(a&&b&&((a.k&&a.k===b.k)||(a.u&&a.u===b.u)));}
function versionSec(){
  var vs=findVersions(P.item);
  if(!vs.length) return {t:'Autres versions : aucune version 4K / Full HD / SD de '+(P.item&&P.item.t==='live'?'cette chaîne':'ce film')+' dans ta playlist.',opts:[]};
  return {t:'Autres versions dans ta playlist (la lecture reprend avec la version choisie) :',opts:vs.map(function(v){var lc=lgCode(v.n);return {l:vqName(v.n)+(/\b(DV|DOVI|DOLBY ?VISION)\b/i.test(v.n)?' Dolby Vision':(/\bHDR/i.test(v.n)?' HDR':''))+(lc?' · '+lgLabel(lc):'')+' — '+v.n,sel:sameItem(v,P.item),fn:function(){
    if(sameItem(v,P.item)) return;
    var pos=P.item.t==='live'?0:(vid.currentTime||0);
    OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';
    play(v,P.list,P.idx,P.force);
    if(pos>5){var sk=function(){try{vid.currentTime=pos;}catch(e){}vid.removeEventListener('loadedmetadata',sk);};vid.addEventListener('loadedmetadata',sk);}
    showCtl();
  }};})};
}
function updVerBtn(it){var b=$('pbver');if(!b) return;var n=findVersions(it).length;b.style.display=(it&&it.p==='series')?'none':'inline-block';b.textContent='🎞 4K / HD / SD'+(n>1?' ('+n+')':'');}
function dlgVersions(){
  clearTimeout(P.ctlT);
  optDialog('Version du '+(P.item&&P.item.t==='live'?'direct':'film'),function(){return [versionSec()];},function(){if(P.open){showCtl();focusIn($('player'),'#pbver');}});
  $('modal').classList.add('seethru');document.body.classList.add('menuopen');
}
function vqBucket(n){var q=vqName(n);return q==='4K UHD'?'4K':q==='Full HD'?'FHD':q==='SD'?'SD':'HD';}
function quickSec(){
  var vs=findVersions(P.item);if(!vs.length) return null;
  var myl=lgCode(P.item.n),cur=vqBucket(P.item.n),B=[['4K','4K UHD'],['FHD','Full HD 1080p'],['HD','HD 720p'],['SD','SD']];
  return {t:'Choisir la qualité '+(P.item&&P.item.t==='live'?'de la chaîne':'du film')+' :',opts:B.map(function(b){
    var pick=null,i,v;
    for(i=0;i<vs.length;i++){v=vs[i];if(vqBucket(v.n)!==b[0]) continue;if(!pick||(lgCode(v.n)===myl&&lgCode(pick.n)!==myl)) pick=v;}
    if(!pick) return {l:b[1]+' (pas dispo)',sel:false,fn:function(){toast(b[1]+' : aucune version de ce film dans ta playlist.');}};
    return {l:b[1],sel:b[0]===cur,fn:function(){if(!sameItem(pick,P.item)) switchTo(pick);}};
  })};
}
function dlgQuality(){
  clearTimeout(P.ctlT);
  optDialog('Qualité de l\'image',function(){
    var lv=(P.hls&&P.hls.levels)||[],opts=[],order=[],i;
    var qs=(P.item&&P.item.p==='series'&&P.item.sr)?epQuickSec():quickSec();
    if(lv.length<2) return qs?[qs]:[{t:'Ce flux n\'a qu\'une seule qualité :',opts:[{l:(lv[0]?qLabel(lv[0]):(vid.videoHeight?qLabel({height:vid.videoHeight,width:vid.videoWidth}):'Qualité unique')),sel:true,fn:function(){}}]}];
    var auto=P.hls.autoLevelEnabled||P.hls.manualLevel<0,curH=0;
    try{var cl=lv[P.hls.currentLevel>=0?P.hls.currentLevel:P.hls.loadLevel];curH=cl?(+cl.height||0):0;}catch(e){}
    // Auto : passe par toutes les qualites (SD comprises) selon la connexion
    opts.push({l:'Auto (selon la connexion)'+(auto&&curH&&curH<700?' · SD en ce moment':''),sel:auto,fn:function(){P.hls.currentLevel=-1;S.settings.qPref='auto';saveSettings();updQBtn();}});
    // choix manuels : seulement HD et plus (le SD est gere par Auto)
    for(i=0;i<lv.length;i++) if((+lv[i].height||0)>=700) order.push(i);
    order.sort(function(a,b){return (lv[b].height||0)-(lv[a].height||0)||(lv[b].bitrate||0)-(lv[a].bitrate||0);});
    var has4k=order.some(function(i){return (+lv[i].height||0)>=2000;}),has1080=order.some(function(i){var h=+lv[i].height||0;return h>=1000&&h<2000;});
    if(!has4k) opts.push({l:'4K UHD 2160p (pas sur ce flux)',sel:false,fn:function(){toast('Ce flux ne propose pas la 4K. Le bouton marchera sur les films et chaînes disponibles en 4K.');}});
    if(!has1080) opts.push({l:'Full HD 1080p (pas sur ce flux)',sel:false,fn:function(){toast('Ce flux ne propose pas le 1080p.');}});
    order.forEach(function(i){opts.push({l:qLabel(lv[i]),sel:!auto&&P.hls.currentLevel===i,fn:function(){P.hls.currentLevel=i;S.settings.qPref=lv[i].height||'auto';saveSettings();updQBtn();}});});
    return [{t:'Choisissez la qualité. Les qualités SD sont gérées par Auto quand la connexion faiblit.',opts:opts}];
  },function(){if(P.open){showCtl();focusIn($('player'),'#pbq');}});
  $('modal').classList.add('seethru','qcompact');document.body.classList.add('menuopen');
}
function applyQPref(){
  try{
    var q=S.settings.qPref;if(!P.hls||!q||q==='auto'||+q<700) return;
    var lv=P.hls.levels||[],best=-1,i;
    for(i=0;i<lv.length;i++) if((lv[i].height||0)<=+q&&(best<0||(lv[i].height||0)>(lv[best].height||0))) best=i;
    if(best>=0) P.hls.currentLevel=best;
  }catch(e){}
}
function reloadKeepPos(){
  if(!P.item) return;
  var pos=P.item.t==='live'?0:(vid.currentTime||0);
  play(P.item,P.list,P.idx,P.force);
  if(pos>5){var sk=function(){try{vid.currentTime=pos;}catch(e){}vid.removeEventListener('loadedmetadata',sk);};vid.addEventListener('loadedmetadata',sk);}
  showCtl();
}
function reloadStream(){
  if(!P.item) return;
  toast('Rechargement du flux...');
  play(P.item,P.list,P.idx,P.force);
}


// ---------- options du lecteur (comme l'appli Android) : vitesse, format, langue preferee ----------
function applyFormat(){var f=S.settings.vFormat||'contain';if(AV.on){avFormat();return;}
  if(P.forceClassic&&(f==='contain'||f==='fill')){P.forceClassic=false;if(P.open&&P.item&&P.item.t!=='live'&&avOk()&&S.settings.avplay!=='off'&&P.running){toast('Retour au lecteur Samsung (toutes les langues).');setTimeout(function(){if(OD.active) closeOpt();reloadKeepPos();},60);return;}}try{vid.style.objectFit=f;vid.style.transform=f==='zoom'?'scale(1.15)':'';if(f==='zoom') vid.style.objectFit='contain';}catch(e){}}
function dlgPlayerOpts(){
  clearTimeout(P.ctlT);
  optDialog('Image et vitesse',function(){
    var f=S.settings.vFormat||'contain',sp=vid.playbackRate||1,live=P.item&&P.item.t==='live',secs=[];
    secs.push({t:'Mémoire tampon (grande = moins de coupures, démarrage un peu plus long)',opts:[
      {l:'Normale',sel:S.settings.buffer!=='big',fn:function(){if(S.settings.buffer==='big'){setS('buffer','normal');toast('Mémoire tampon normale : appliquée au prochain lancement ou avec Recharger.');}}},
      {l:'Grande',sel:S.settings.buffer==='big',fn:function(){if(S.settings.buffer!=='big'){setS('buffer','big');toast('Grande mémoire tampon : appliquée au prochain lancement ou avec Recharger.');}}}]});
    if(live&&avOk()) secs.push({t:'Lecteur du direct (Samsung = choix de la langue quand la chaîne en diffuse plusieurs)',opts:[
      {l:'Classique',sel:S.settings.livePlayer==='off',fn:function(){if(S.settings.livePlayer!=='off'){setS('livePlayer','off');setTimeout(function(){closeOpt();reloadKeepPos();},50);}}},
      {l:'Samsung (recommandé)',sel:S.settings.livePlayer!=='off',fn:function(){if(S.settings.livePlayer==='off'){setS('livePlayer','on');toast('Lecteur Samsung pour le direct : relance de la chaîne...');setTimeout(function(){closeOpt();reloadKeepPos();},50);}}}]});
    if(!live&&avOk()) secs.push({t:'Lecteur des films et séries',opts:[
      {l:'Samsung (plusieurs langues)',sel:S.settings.avplay!=='off',fn:function(){if(S.settings.avplay==='off'){setS('avplay','on');toast('Lecteur Samsung : relance du film...');setTimeout(function(){closeOpt();reloadStream();},50);}}},
      {l:'Classique (tous les formats d\'image)',sel:S.settings.avplay==='off',fn:function(){if(S.settings.avplay!=='off'){setS('avplay','off');toast('Lecteur classique : relance du film...');setTimeout(function(){closeOpt();reloadStream();},50);}}}]});
    var vw=AV.on?AV.w:vid.videoWidth,vh=AV.on?AV.h:vid.videoHeight,is169=vw&&vh&&Math.abs(vw/vh-16/9)<0.03;
    secs.push({t:'Format de l\'image'+(is169?' (image déjà en 16:9 : seul Zoom léger change vraiment l\'image)':''),opts:[
      {l:'Adapter (bandes noires)',sel:f==='contain',fn:function(){setS('vFormat','contain');applyFormat();}},
      {l:'Zoom léger',sel:f==='zoom',fn:function(){setS('vFormat','zoom');applyFormat();}},
      {l:'Recadrer (remplir)',sel:f==='cover',fn:function(){setS('vFormat','cover');applyFormat();}},
      {l:'Étirer',sel:f==='fill',fn:function(){setS('vFormat','fill');applyFormat();}}]});
    if(!live) secs.push({t:'Vitesse de lecture',opts:[0.5,0.75,1,1.25,1.5,2].map(function(v){return {l:v===1?'Normale (1x)':v+'x',sel:Math.abs(sp-v)<0.01,fn:function(){try{vid.playbackRate=v;}catch(e){}}};})});
    secs.push({t:'Langue audio préférée (choisie automatiquement quand le film en propose plusieurs)',opts:[
      {l:'Français',sel:(S.settings.audioLang||'fr')==='fr',fn:function(){setS('audioLang','fr');pickAudio();}},
      {l:'Anglais',sel:S.settings.audioLang==='en',fn:function(){setS('audioLang','en');pickAudio();}},
      {l:'Langue d\'origine',sel:S.settings.audioLang==='any',fn:function(){setS('audioLang','any');}}]});
    return secs;
  },function(){if(P.open){showCtl();focusIn($('player'),'#pbopts');}});
  $('modal').classList.add('seethru');document.body.classList.add('menuopen');
}
function pickAudio(){
  if(AV.on){if(AV.started) avPickAudio();return;}
  var lg=S.settings.audioLang||'fr';if(lg==='any') return;
  var re=lg==='fr'?/^(fr|fre|fra)\b|^fr[-_]|fran|\b(vff|vfq|vfi|vf|truefrench|french)\b/i:/^(en|eng)\b|^en[-_]|angl|engl/i,i;
  try{if(P.hls&&P.hls.audioTracks&&P.hls.audioTracks.length>1){for(i=0;i<P.hls.audioTracks.length;i++){var t=P.hls.audioTracks[i];if(re.test(t.lang||'')||re.test(t.name||'')){if(P.hls.audioTrack!==i) P.hls.audioTrack=i;return;}}}}catch(e){}
  try{var at=vid.audioTracks;if(at&&at.length>1){for(i=0;i<at.length;i++) if(re.test(at[i].language||'')||re.test(at[i].label||'')){for(var j=0;j<at.length;j++) at[j].enabled=(j===i);return;}}}catch(e){}
}
// ---------- liste des chaines pendant le direct ----------
function dlgChannels(){
  if(!P.list||!P.list.length) return;
  clearTimeout(P.ctlT);
  var n=P.list.length,from=Math.max(0,P.idx-20),to=Math.min(n,from+60),opts=[],i;
  for(i=from;i<to;i++)(function(i){var it=P.list[i];opts.push({l:(i+1)+'. '+it.n,sel:i===P.idx,fn:function(){OD.active=false;modalClose();$('modal').classList.remove('optm');$('mm').style.display='';play(P.list[i],P.list,i,P.force);showCtl();}});})(i);
  optDialog('Chaînes ('+n+')',function(){return [{t:n>60?'Chaînes '+(from+1)+' à '+to+' (Haut / Bas sur la télécommande pour zapper)':'',opts:opts}];},function(){if(P.open){showCtl();focusIn($('player'),'#pbchans');}});
  focusIn($('modal'),'.obtn.osel');
}
// ---------- tri des listes (comme l'appli Android) ----------
var SORTS=[['provider','Ordre du fournisseur'],['recent','Ajoutés récemment'],['az','Nom A → Z'],['za','Nom Z → A']];
function sortLabel(){var m=S.settings.sort||'provider',i;for(i=0;i<SORTS.length;i++) if(SORTS[i][0]===m) return SORTS[i][1];return SORTS[0][1];}
function applySort(list){
  var m=S.settings.sort||'provider';if(m==='provider'||S.kind==='fav'||S.catId==='__recent') return list;
  var a=list.slice();
  if(m==='az') a.sort(function(x,y){return String(x.n).localeCompare(String(y.n),'fr',{sensitivity:'base'});});
  else if(m==='za') a.sort(function(x,y){return String(y.n).localeCompare(String(x.n),'fr',{sensitivity:'base'});});
  else if(m==='recent') a.sort(function(x,y){return (+y.ad||0)-(+x.ad||0);});
  return a;
}


// ---------- avance / retour rapide (x2 a x64) avec apercu sur la barre ----------
var FF_STEPS=[2,4,8,16,32,64];
function ffSet(dir){
  if(!P.item||P.item.t==='live'||!isFinite(vid.duration)) return;
  var cur=P.ff||0,lvl;
  if(cur&&(cur>0)===(dir>0)){lvl=FF_STEPS.indexOf(Math.abs(cur))+1;if(lvl>=FF_STEPS.length) lvl=FF_STEPS.length-1;}
  else lvl=0;
  P.ff=dir*FF_STEPS[lvl];
  if(P.scrub==null) P.scrub=vid.currentTime||0;
  try{vid.pause();}catch(e){}
  $('player').classList.add('ff');
  $('pffbadge').textContent=(P.ff>0?'▶▶ x':'◀◀ x')+Math.abs(P.ff);
  clearInterval(P.ffT);clearTimeout(P.scrubT);
  P.ffT=setInterval(function(){
    var d=isFinite(vid.duration)?vid.duration:0;if(!d){ffStop(false);return;}
    P.scrub=Math.max(0,Math.min(d-1,P.scrub+P.ff*0.25));
    timeUpd();
    showCtl();clearTimeout(P.ctlT);
    if(P.scrub<=0||P.scrub>=d-1) ffStop(true);
  },250);
  showCtl();clearTimeout(P.ctlT);timeUpd();
}
function ffStop(apply){
  if(!P.ff) return false;
  clearInterval(P.ffT);P.ff=0;$('player').classList.remove('ff');
  if(apply!==false&&P.scrub!=null){try{vid.currentTime=P.scrub;}catch(e){}}
  P.scrub=null;timeUpd();tryPlay();
  clearTimeout(P.ctlT);P.ctlT=setTimeout(hideCtl,4000);
  return true;
}

// ---------- Samsung Tizen : touches de la telecommande ----------
(function(){
  if(!window.tizen||!tizen.tvinputdevice) return;
  var keys=['MediaPlayPause','MediaPlay','MediaPause','MediaStop','MediaRewind','MediaFastForward',
    'ChannelUp','ChannelDown','ColorF0Red','ColorF2Yellow','Info',
    '0','1','2','3','4','5','6','7','8','9'];
  for(var i=0;i<keys.length;i++){try{tizen.tvinputdevice.registerKey(keys[i]);}catch(e){}}
})();
document.addEventListener('visibilitychange',function(){
  var v=document.querySelector('video');
  if(document.hidden&&v&&!v.paused){try{v.pause();}catch(e){}}
});

// ---------- demarrage ----------
var sp=lsGet('streamix.playlists',[]);
S.playlists=Array.isArray(sp)?sp:[];
// retire la playlist de test (test.m3u) si elle est encore enregistree sur la TV
(function(){var n=S.playlists.length;S.playlists=S.playlists.filter(function(p){var u=String((p&&p.url)||'');return !/\/test\.m3u(\?|$)/i.test(u);});if(S.playlists.length!==n) savePlaylists();})();
var ss=lsGet('streamix.settings',null);
if(ss&&typeof ss==='object'){S.settings.relay=ss.relay||'';S.settings.relayStreams=!!ss.relayStreams;S.settings.liveFmt=ss.liveFmt==='ts'?'ts':'m3u8';S.settings.clock12=!!ss.clock12;S.settings.noAuto=!!ss.noAuto;S.settings.subMode=ss.subMode||(ss.subs?'on':'off');S.settings.subLang=ss.subLang||'fr';S.settings.subSize=ss.subSize||'m';S.settings.subBg=ss.subBg||'semi';S.settings.subColor=ss.subColor||'white';S.settings.dateFmt=ss.dateFmt||'long';S.settings.clockOff=+ss.clockOff||0;S.settings.qPref=ss.qPref||'auto';S.settings.vFormat=ss.vFormat||'contain';S.settings.audioLang=ss.audioLang||'fr';S.settings.sort=ss.sort||'provider';S.settings.subHide=+ss.subHide||0;S.settings.site=ss.site||'';S.settings.buffer=ss.buffer==='big'?'big':'normal';S.settings.avplay=ss.avplay==='off'?'off':'on';S.settings.livePlayer=ss.livePlayer==='off'?'off':'on';S.settings.voice=(ss.voice==='on'||ss.voice==='strong')?ss.voice:'off';}
applySubStyle();
initPlayer();
showHome();
var bootEl=document.getElementById('boot');if(bootEl&&!window.__errs.length) bootEl.parentNode.removeChild(bootEl);
(function(){
  var last=lsGet('streamix.last',null),i;
  if(!S.playlists.length){showHub();return;}
  S.boot=true;
  for(i=0;i<S.playlists.length;i++) if(S.playlists[i].id===last){openPlaylist(last);return;}
  openPlaylist(S.playlists[0].id);
})();
refreshLicense();
if(!S.settings.noAuto) importAccount(true);
})();
