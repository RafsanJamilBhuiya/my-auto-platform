const express=require('express');
const crypto=require('crypto');
const {authRequired,adminRequired}=require('../middleware/auth');
const assistant=require('../core/assistant');
const router=express.Router();
function validSecret(req){const expected=process.env.TELEGRAM_WEBHOOK_SECRET;if(!expected)return false;const received=req.get('x-telegram-bot-api-secret-token')||'';return received.length===expected.length&&crypto.timingSafeEqual(Buffer.from(received),Buffer.from(expected));}
router.post('/webhook',async(req,res)=>{if(!validSecret(req))return res.status(401).json({ok:false,error:'Invalid Telegram webhook secret'});res.sendStatus(200);try{const message=req.body?.message;const chatId=message?.chat?.id;const text=message?.text;if(chatId==null||!text)return;const reply=await assistant.replyTo(text);await assistant.sendTelegramMessage(chatId,reply);}catch(error){console.error('[Telegram] webhook:',error.message);}});
router.get('/status',authRequired,(req,res)=>res.json({ok:true,configured:Boolean(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_WEBHOOK_SECRET),alertsConfigured:Boolean(process.env.TELEGRAM_ALERT_CHAT_ID),webhookPath:'/api/telegram/webhook'}));
router.post('/alert',authRequired,adminRequired,express.json(),async(req,res)=>{try{const text=String(req.body?.text||'').trim();if(!text)return res.status(400).json({ok:false,error:'Alert text is required'});const result=await assistant.sendAlert(text);if(!result.configured)return res.status(503).json(result);res.json(result);}catch(error){console.error('[Telegram] alert:',error);res.status(502).json({ok:false,error:'Telegram alert failed'});}});
module.exports=router;
