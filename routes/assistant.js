const express=require('express');
const {authRequired}=require('../middleware/auth');
const assistant=require('../core/assistant');
const router=express.Router();
router.get('/status',authRequired,async(req,res)=>{try{res.set('Cache-Control','no-store');res.json({ok:true,status:await assistant.getStatus()});}catch(error){console.error('[Assistant] status:',error);res.status(500).json({ok:false,error:'Assistant status unavailable'});}});
router.post('/chat',authRequired,express.json(),async(req,res)=>{try{const message=String(req.body?.message||'').trim();if(!message)return res.status(400).json({ok:false,error:'Message is required'});res.json({ok:true,reply:await assistant.replyTo(message)});}catch(error){console.error('[Assistant] chat:',error);res.status(500).json({ok:false,error:'Assistant request failed'});}});
module.exports=router;
