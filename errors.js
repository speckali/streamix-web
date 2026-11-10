window.__errs=[];
window.onerror=function(m,src,l,c){
  var t=String(m)+' (ligne '+l+':'+c+') '+(src?String(src).split('/').pop():'');
  window.__errs.push(t);
  var d=document.getElementById('boot');
  if(!d){d=document.createElement('div');d.id='boot';if(document.body)document.body.appendChild(d);}
  d.style.cssText='position:fixed;left:3%;right:3%;top:5%;z-index:9999;background:#300;color:#fff;font:28px Arial,sans-serif;padding:24px;border:4px solid #f55;white-space:pre-wrap';
  d.textContent='ERREUR STREAMIX :\n'+window.__errs.join('\n');
};
