/* Unified auth-aware navigation for the GitHub → Render platform. */
(function(){'use strict';
async function getUser(){try{const r=await fetch('/api/auth/profile',{credentials:'same-origin',cache:'no-store'});if(!r.ok)return null;const d=await r.json();return d.ok?d.user:null;}catch(_){return null;}}
function render(user){const root=document.querySelector('[data-navbar]');if(!root)return;const links=[['Home','/'],['Dashboard','/dashboard'],['Live Status','/status.html'],['Integrations','/integrations'],['Assistant','/assistant']];if(user&&user.role==='admin')links.push(['Admin','/admin']);const items=links.map(([label,href])=>`<a href="${href}">${label}</a>`);if(user)items.push('<button type="button" data-navbar-logout>Logout</button>');else items.push('<a href="/login">Login</a>','<a href="/register">Register</a>');root.innerHTML=items.join('');const logout=root.querySelector('[data-navbar-logout]');if(logout)logout.onclick=async()=>{await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});location.href='/';};}
async function init(){render(await getUser());}
window.PlatformNavbar={init,refresh:init};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
