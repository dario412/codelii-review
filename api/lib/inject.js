/**
 * Inject review overlay scripts into HTML and rewrite absolute/relative URLs for proxy mode.
 */
import { canUseCursorTools } from './permissions.js';
import { getCore } from './store.js';
import { connectedPmProviders } from './pm.js';

function viewPrefix(project) {
  return project.type === 'github' ? `/s/${project.id}` : `/p/${project.id}`;
}

/**
 * Runs before site JS. Root-absolute fetches/chunk loads (esp. Next `/_next/`)
 * would otherwise hit the review host and 404 — leaving canvas/motion empty.
 *
 * Scroll-into-view: nudge IntersectionObserver + reduced-motion so React
 * entrance state flips (FadeUp, TopicMix, StatCounter). Also selectively
 * force entrance opacity/translate only — never hover/popover cards
 * (absolute + group-hover), which must stay closed until hovered like live.
 */
export function proxyPathBootstrap(prefix) {
  const P = JSON.stringify(String(prefix || '').replace(/\/+$/, ''));
  return `<script data-codelii-path-bootstrap>(function(){
var PREFIX=${P};
window.__CODELII_REVIEW__=true;

/* Reduced-motion + IO first so later site modules see the patches even if rewrite throws */
(function scrollIntoViewAssist(){
  try{
    var _mm=window.matchMedia.bind(window);
    window.matchMedia=function(query){
      var q=String(query||"");
      if(/prefers-reduced-motion/i.test(q)&&/reduce/i.test(q)){
        try{
          var real=_mm(q);
          return new Proxy(real,{
            get:function(t,p){
              if(p==="matches")return true;
              var v=t[p];
              return typeof v==="function"?v.bind(t):v;
            }
          });
        }catch(e){
          return {
            matches:true,
            media:q,
            onchange:null,
            addListener:function(){},
            removeListener:function(){},
            addEventListener:function(){},
            removeEventListener:function(){},
            dispatchEvent:function(){return false;}
          };
        }
      }
      return _mm(query);
    };
  }catch(e){}

  try{
    var OrigIO=window.IntersectionObserver;
    if(OrigIO){
      window.IntersectionObserver=function(callback,options){
        function forceEntry(target){
          var rect=target&&target.getBoundingClientRect?target.getBoundingClientRect():{top:0,left:0,bottom:0,right:0,width:0,height:0,x:0,y:0,toJSON:function(){return{};}};
          return {
            time: typeof performance!=="undefined"?performance.now():Date.now(),
            target: target,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: rect,
            intersectionRect: rect,
            rootBounds: null,
            isVisible: true
          };
        }
        function fire(target,obs){
          try{ callback([forceEntry(target)],obs); }catch(err){}
        }
        var obs=new OrigIO(function(entries,observer){
          callback((entries||[]).map(function(e){
            return {
              time: e.time,
              target: e.target,
              isIntersecting: true,
              intersectionRatio: 1,
              boundingClientRect: e.boundingClientRect,
              intersectionRect: e.boundingClientRect||e.intersectionRect,
              rootBounds: e.rootBounds,
              isVisible: true
            };
          }),observer);
        },options);
        var _observe=obs.observe.bind(obs);
        obs.observe=function(target){
          _observe(target);
          try{
            queueMicrotask(function(){ fire(target,obs); });
            setTimeout(function(){ fire(target,obs); },0);
            setTimeout(function(){ fire(target,obs); },50);
            setTimeout(function(){ fire(target,obs); },250);
          }catch(err){}
        };
        return obs;
      };
      window.IntersectionObserver.prototype=OrigIO.prototype;
      try{ Object.setPrototypeOf(window.IntersectionObserver, OrigIO); }catch(e){}
    }
  }catch(e){}

  /* Selective DOM reveal: entrance fades only (not hover popovers) */
  (function selectiveEntranceReveal(){
    /* CSS fallback — works even if React keeps re-adding opacity-0 classes.
       Skip .absolute/.fixed so hero/hover popovers stay closed until hover. */
    try{
      var css=document.createElement("style");
      css.setAttribute("data-codelii-entrance-reveal","1");
      css.textContent=[
        '.opacity-0.translate-y-4:not(.absolute):not(.fixed),',
        '.opacity-0.translate-y-5:not(.absolute):not(.fixed),',
        '.opacity-0.translate-y-6:not(.absolute):not(.fixed),',
        '.opacity-0.translate-y-7:not(.absolute):not(.fixed),',
        '.opacity-0.translate-y-8:not(.absolute):not(.fixed),',
        '.opacity-0.translate-y-10:not(.absolute):not(.fixed),',
        '.opacity-0.translate-y-12:not(.absolute):not(.fixed),',
        '.opacity-0.translate-y-16:not(.absolute):not(.fixed),',
        '.opacity-0.translate-y-20:not(.absolute):not(.fixed),',
        '.opacity-0.translate-y-24:not(.absolute):not(.fixed),',
        '[class*="transition-[opacity,transform]"].opacity-0:not(.absolute):not(.fixed){',
        'opacity:1!important;transform:none!important;translate:none!important;visibility:visible!important;',
        '}'
      ].join("");
      (document.head||document.documentElement).appendChild(css);
    }catch(e){}

    var ENTRANCE_Y=/translate-y-(?:[1-9]|1[0-2]|14|16|20|24)\\b|-translate-y-/;
    var HOVER_SHOW=/group-hover:opacity-|group-focus-within:opacity-|peer-hover:opacity-/;
    function isReviewChrome(el){
      if(!el||!el.closest)return false;
      return !!el.closest("#review-toolbar,#review-sidebar,#review-pins-layer,#review-active-bubble,#review-live-toasts,#review-notifications-panel,#review-notifications-wrap,#review-click-shield,#review-screenshot-lightbox,#review-selection-bar,#review-follow-banner,#review-remote-cursor,#review-mention-dropdown,.review-bubble,.review-assign-picker,.review-pm-picker,.review-toolbar,.review-sidebar");
    }
    function classStr(el){
      if(!el)return "";
      if(typeof el.className==="string")return el.className;
      if(el.className&&typeof el.className.baseVal==="string")return el.className.baseVal;
      return "";
    }
    function isHoverChrome(el){
      var cls=classStr(el);
      if(HOVER_SHOW.test(cls))return true;
      if(/(\\s|^)(absolute|fixed)(\\s|$)/.test(cls))return true;
      try{
        var cs=window.getComputedStyle(el);
        if(cs&&(cs.position==="absolute"||cs.position==="fixed"))return true;
      }catch(e){}
      return false;
    }
    function isEntranceCandidate(el){
      if(!el||el.nodeType!==1||isReviewChrome(el)||isHoverChrome(el))return false;
      var cls=classStr(el);
      var style=el.style;
      var hasOpacity0=cls.indexOf("opacity-0")!==-1||(style&&style.opacity==="0");
      if(!hasOpacity0)return false;
      if(ENTRANCE_Y.test(cls))return true;
      if(cls.indexOf("transition-[opacity,transform]")!==-1)return true;
      if(style&&style.transform&&/translateY\\s*\\(\\s*[1-9]/.test(style.transform))return true;
      return false;
    }
    function reveal(el){
      if(!el||!el.style||!isEntranceCandidate(el))return;
      el.style.setProperty("opacity","1","important");
      el.style.setProperty("transform","none","important");
      el.style.setProperty("translate","none","important");
      el.style.setProperty("filter","none","important");
      el.style.setProperty("visibility","visible","important");
      try{
        el.classList.remove("opacity-0","invisible","translate-y-1","translate-y-2","translate-y-3","translate-y-4","translate-y-5","translate-y-6","translate-y-7","translate-y-8","translate-y-10","translate-y-12","translate-y-16","translate-y-20","translate-y-24");
        el.classList.add("opacity-100","translate-y-0");
      }catch(e){}
    }
    var sweepTimer=0;
    function sweep(){
      if(!document.body)return;
      var nodes=document.body.querySelectorAll(".opacity-0,[class*=\\"opacity-0\\"],[style*=\\"opacity: 0\\"],[style*=\\"opacity:0\\"]");
      for(var i=0;i<nodes.length;i++){
        if(isEntranceCandidate(nodes[i]))reveal(nodes[i]);
      }
    }
    function scheduleSweep(){
      if(sweepTimer)return;
      sweepTimer=setTimeout(function(){ sweepTimer=0; sweep(); },48);
    }
    function boot(){
      sweep();
      try{
        var mo=new MutationObserver(scheduleSweep);
        mo.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["class","style"]});
      }catch(e){}
      setTimeout(sweep,0);
      setTimeout(sweep,100);
      setTimeout(sweep,500);
      setTimeout(sweep,1500);
      setTimeout(sweep,3000);
    }
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);
    else boot();
  })();
})();

if(!PREFIX)return;
function rewrite(url){
  if(url==null)return url;
  if(typeof Request!=="undefined"&&typeof url==="object"&&url instanceof Request){
    var nr=rewrite(url.url);
    return nr===url.url?url:new Request(nr,url);
  }
  if(typeof URL!=="undefined"&&typeof url==="object"&&url instanceof URL){
    var nu=rewrite(url.href);
    return nu===url.href?url:new URL(nu);
  }
  if(typeof url!=="string")return url;
  if(!url||url.charAt(0)==="#"||/^(data:|blob:|mailto:|tel:|javascript:)/i.test(url))return url;
  try{
    var abs=new URL(url,location.href);
    if(abs.origin!==location.origin)return url;
    var path=abs.pathname;
    if(path===PREFIX||path.indexOf(PREFIX+"/")===0)return url;
    if(/^\\/(api|css|js)(\\/|$)/.test(path))return url;
    if(/^\\/(login|dashboard|integrations|join|favicon\\.ico|apple-touch|site\\.webmanifest)/.test(path))return url;
    return PREFIX+path+abs.search+abs.hash;
  }catch(e){return url;}
}
var _fetch=window.fetch;
window.fetch=function(input,init){return _fetch.call(this,rewrite(input),init);};
var xhrOpen=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(method,url){
  arguments[1]=rewrite(String(url));
  return xhrOpen.apply(this,arguments);
};
function patch(proto,prop){
  var d=Object.getOwnPropertyDescriptor(proto,prop);
  if(!d||!d.set)return;
  Object.defineProperty(proto,prop,{
    configurable:true,
    enumerable:!!d.enumerable,
    get:function(){return d.get.call(this);},
    set:function(v){d.set.call(this,rewrite(String(v)));}
  });
}
patch(HTMLScriptElement.prototype,"src");
patch(HTMLImageElement.prototype,"src");
patch(HTMLLinkElement.prototype,"href");
if(typeof HTMLSourceElement!=="undefined")patch(HTMLSourceElement.prototype,"src");
if(typeof HTMLIFrameElement!=="undefined")patch(HTMLIFrameElement.prototype,"src");
if(typeof Worker!=="undefined"){
  var OrigWorker=Worker;
  window.Worker=function(scriptURL,options){return new OrigWorker(rewrite(String(scriptURL)),options);};
  window.Worker.prototype=OrigWorker.prototype;
}
})();</script>`;
}

export async function injectOverlay(html, project, viewer) {
  const hasSource =
    typeof project.hasSource === 'boolean'
      ? project.hasSource
      : project.type === 'github';
  const cursorTools = canUseCursorTools(project, viewer);

  let pmProviders = [];
  if (viewer?.id) {
    try {
      const core = await getCore();
      const account = core.users.find((u) => u.id === viewer.id);
      pmProviders = connectedPmProviders(account);
    } catch {
      pmProviders = [];
    }
  }

  const ctx = {
    canUseCursorTools: cursorTools,
    // Project owner can moderate comments (delete / hide). Not a full role system.
    isOwner: Boolean(viewer && project.ownerId === viewer.id),
    id: project.id,
    name: project.name,
    type: project.type,
    source: project.source,
    baseUrl: project.baseUrl || null,
    hasSource,
    viewPrefix: viewPrefix(project),
    pmProviders,
  };

  // Repo and local folder paths only drive the Cursor tools, so clients never
  // receive them — nor the prompt builder that reads them.
  if (cursorTools) {
    ctx.repoUrl = project.repoUrl || (project.type === 'github' ? project.source : null);
    ctx.localPath = project.localPath || null;
    ctx.autoCreatePR = project.autoCreatePR !== false;
  }

  const scripts = [
    '<script src="/js/auth-guard.js"></script>',
    cursorTools ? '<script src="/js/cursor-prompts.js"></script>' : null,
    '<script src="/js/review.js" defer></script>',
  ]
    .filter(Boolean)
    .join('\n');

  const snippet = `
<!-- Codelii Review Mode -->
<link rel="stylesheet" href="/css/review.css">
<script>window.__REVIEW_PROJECT__=${JSON.stringify(ctx)};</script>
${scripts}
`;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${snippet}\n</body>`);
  }
  return html + snippet;
}

function normalizeHost(host) {
  return (host || '').toLowerCase().replace(/^www\./, '');
}

export function sameSite(urlA, urlB) {
  try {
    return normalizeHost(new URL(urlA).host) === normalizeHost(new URL(urlB).host);
  } catch {
    return false;
  }
}

function isSameOrigin(href, baseOrigin) {
  try {
    let u;
    if (href.startsWith('//')) u = new URL(`https:${href}`);
    else if (/^https?:\/\//i.test(href)) u = new URL(href);
    else return true; // relative or root-relative
    return normalizeHost(u.host) === normalizeHost(new URL(baseOrigin).host);
  } catch {
    return false;
  }
}

function rewriteUrl(href, projectId, baseOrigin, mode) {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:') || href.startsWith('data:') || href.startsWith('blob:')) {
    return href;
  }

  const prefix = mode === 'github' ? `/s/${projectId}` : `/p/${projectId}`;

  // Already rewritten or app-owned path
  if (
    href === prefix ||
    href.startsWith(`${prefix}/`) ||
    href.startsWith('/css/') ||
    href.startsWith('/js/') ||
    href.startsWith('/api/') ||
    href.startsWith('/login') ||
    href.startsWith('/dashboard')
  ) {
    return href;
  }

  try {
    if (href.startsWith('//')) {
      const u = new URL(`https:${href}`);
      if (!isSameOrigin(href, baseOrigin)) return href;
      return `${prefix}${u.pathname}${u.search}${u.hash}`;
    }
    if (/^https?:\/\//i.test(href)) {
      const u = new URL(href);
      if (!isSameOrigin(href, baseOrigin)) return href;
      return `${prefix}${u.pathname}${u.search}${u.hash}`;
    }
    if (href.startsWith('/')) {
      return `${prefix}${href}`;
    }
    // relative — leave for browser; <base> resolves it
    return href;
  } catch {
    return href;
  }
}

/** Rewrite hardcoded bundler public paths inside JS (Next.js `__webpack_require__.p`). */
export function rewriteJs(js, project) {
  const prefix = viewPrefix(project);
  if (!js || !prefix) return js;
  let out = js;
  // "/_next/..." and '/_next/...' and `/_next/...`
  out = out.replace(/(["'`])\/_next\//g, `$1${prefix}/_next/`);
  out = out.replace(/(["'`])\/_vercel\//g, `$1${prefix}/_vercel/`);
  // Escaped form common in bundled strings: \/_next\/
  const esc = prefix.replace(/\//g, '\\/');
  out = out.replace(/\\\/_next\//g, `${esc}/_next/`);
  out = out.replace(/\\\/_vercel\//g, `${esc}/_vercel/`);
  return out;
}

export async function rewriteHtml(html, project, viewer) {
  const projectId = project.id;
  const baseOrigin = project.baseUrl || '';
  const mode = project.type === 'github' ? 'github' : 'url';
  const prefix = mode === 'github' ? `/s/${projectId}` : `/p/${projectId}`;

  let out = html;

  // Strip CSP that could block the overlay
  out = out.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');

  // Remove existing base tags — we set ours after rewrites
  out = out.replace(/<base[^>]*>/gi, '');

  // Strip subresource integrity — rewritten same-origin assets would fail the hash
  out = out.replace(/\sintegrity=["'][^"']*["']/gi, '');

  // Rewrite href/src/action attributes (same-origin only; external URLs untouched)
  out = out.replace(/\b(href|src|action)=["']([^"']+)["']/gi, (match, attr, url) => {
    const next = rewriteUrl(url, projectId, baseOrigin, mode);
    if (next === url) return match;
    return `${attr}="${next}"`;
  });

  // Lazy-load attrs
  out = out.replace(/\b(data-src|data-href)=["']([^"']+)["']/gi, (match, attr, url) => {
    const next = rewriteUrl(url, projectId, baseOrigin, mode);
    if (next === url) return match;
    return `${attr}="${next}"`;
  });

  // Open external anchor links in a new tab (anchors only — never <link>/<script>)
  if (mode === 'url' && baseOrigin) {
    out = out.replace(/<a\b([^>]*)>/gi, (match, attrs) => {
      const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
      if (!hrefMatch) return match;
      const href = hrefMatch[1];
      if (!/^(https?:)?\/\//i.test(href)) return match;
      if (isSameOrigin(href, baseOrigin)) return match;
      if (/\btarget=/i.test(attrs)) return match;
      return `<a${attrs} target="_blank">`;
    });
  }

  // srcset + imagesrcset
  out = out.replace(/\b(srcset|imagesrcset)=["']([^"']+)["']/gi, (match, attr, value) => {
    const parts = value.split(',').map((part) => {
      const trimmed = part.trim();
      const [u, ...rest] = trimmed.split(/\s+/);
      const next = rewriteUrl(u, projectId, baseOrigin, mode);
      return [next, ...rest].join(' ');
    });
    return `${attr}="${parts.join(', ')}"`;
  });

  // CSS url()
  out = out.replace(/url\((['"]?)([^)'"]+)\1\)/gi, (match, quote, url) => {
    if (url.startsWith('data:')) return match;
    const next = rewriteUrl(url.trim(), projectId, baseOrigin, mode);
    return `url(${quote}${next}${quote})`;
  });

  // Path bootstrap + <base> first in <head> so chunk loads resolve under /p|/s
  const headInject = `${proxyPathBootstrap(prefix)}<base href="${prefix}/">`;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${headInject}`);
  } else {
    out = headInject + out;
  }

  return injectOverlay(out, project, viewer);
}

export function rewriteCss(css, project) {
  const projectId = project.id;
  const baseOrigin = project.baseUrl || '';
  const mode = project.type === 'github' ? 'github' : 'url';
  return css.replace(/url\((['"]?)([^)'"]+)\1\)/gi, (match, quote, url) => {
    if (url.startsWith('data:')) return match;
    const next = rewriteUrl(url.trim(), projectId, baseOrigin, mode);
    return `url(${quote}${next}${quote})`;
  });
}
