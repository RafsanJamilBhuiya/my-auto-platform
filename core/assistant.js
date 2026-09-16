const store = require('./store');

async function getStatus() {
  const users = await store.countUsers();
  const integrations = await store.listIntegrations();
  return { service:'my-auto-platform', architecture:'GitHub → Render', storage:'native-json-memory', users, integrations:integrations.length, timestamp:new Date().toISOString() };
}
async function replyTo(text) {
  const input=String(text||'').trim().toLowerCase();
  if (/^(hi|hello|hey|help|start)\b/.test(input)) return 'Hello! I can report platform status. Try: status, users, integrations, or help.';
  if (input.includes('status')||input.includes('health')||input.includes('running')) { const s=await getStatus(); return `Platform status: operational\nUsers: ${s.users}\nIntegrations: ${s.integrations}\nStorage: ${s.storage}\nTime: ${s.timestamp}`; }
  if (input.includes('user')) return `Registered users: ${await store.countUsers()}`;
  if (input.includes('integration')) return `Configured integrations: ${(await store.listIntegrations()).length}`;
  return 'I can answer: status, users, integrations, or help.';
}
async function sendTelegramMessage(chatId,text) {
  const token=process.env.TELEGRAM_BOT_TOKEN;
  if(!token)return {ok:false,configured:false,error:'TELEGRAM_BOT_TOKEN is not configured'};
  const response=await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text:String(text).slice(0,4096)})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.ok===false)throw new Error(data.description||`Telegram API HTTP ${response.status}`);
  return {ok:true,configured:true,messageId:data.result?.message_id||null};
}
async function sendAlert(text) { const chatId=process.env.TELEGRAM_ALERT_CHAT_ID; if(!chatId)return {ok:false,configured:false,error:'TELEGRAM_ALERT_CHAT_ID is not configured'}; return sendTelegramMessage(chatId,`my-auto-platform alert\n${text}`); }
module.exports={getStatus,replyTo,sendTelegramMessage,sendAlert};
