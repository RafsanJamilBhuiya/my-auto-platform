const express = require('express');
const crypto = require('crypto');
const { authRequired, adminRequired } = require('../middleware/auth');
const router = express.Router();
const integrations = new Map();

router.get('/', authRequired, (req,res) => res.json({ok:true, integrations:[...integrations.values()].map(({secret,...x})=>x)}));
router.post('/', authRequired, adminRequired, express.json(), (req,res) => {
  const name=String(req.body.name||'').trim(); const type=String(req.body.type||'webhook').trim(); const endpoint=String(req.body.endpoint||'').trim();
  if(!name || !endpoint || !/^https?:\/\//i.test(endpoint)) return res.status(400).json({ok:false,error:'name and a valid HTTPS/HTTP endpoint are required'});
  const item={id:crypto.randomUUID(),name,type,endpoint,enabled:req.body.enabled!==false,createdAt:new Date().toISOString(),secret:crypto.randomBytes(24).toString('hex')}; integrations.set(item.id,item); const {secret,...safe}=item; res.status(201).json({ok:true,integration:safe});
});
router.patch('/:id', authRequired, adminRequired, express.json(), (req,res) => { const item=integrations.get(req.params.id); if(!item) return res.status(404).json({ok:false,error:'Integration not found'}); if(typeof req.body.enabled==='boolean') item.enabled=req.body.enabled; if(req.body.name) item.name=String(req.body.name).trim(); const {secret,...safe}=item; res.json({ok:true,integration:safe}); });
router.delete('/:id', authRequired, adminRequired, (req,res)=> integrations.delete(req.params.id) ? res.json({ok:true}) : res.status(404).json({ok:false,error:'Integration not found'}));
module.exports=router;
