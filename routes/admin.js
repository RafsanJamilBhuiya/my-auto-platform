const express = require('express');
const { authRequired, adminRequired } = require('../middleware/auth');
const router = express.Router();

router.get('/profile', authRequired, (req,res) => res.json({ ok:true, user:req.user, security:{session:'httpOnly cookie', tokenExpiry:'24h', oauth:'Google OpenID Connect when configured'}, rbac:{role:req.user.role, permissions:req.user.role==='admin'?['dashboard:read','profile:read','profile:write','backup:read','backup:write','integrations:read','integrations:write']:['dashboard:read','profile:read','integrations:read']} }));
router.get('/access', authRequired, adminRequired, (req,res) => res.json({ ok:true, roles:[{role:'admin',permissions:['*']},{role:'user',permissions:['dashboard:read','profile:read','integrations:read']}] }));
module.exports = router;
