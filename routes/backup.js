const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const multer = require('multer');
const { authRequired, adminRequired } = require('../middleware/auth');
const store = require('../core/store');

const router = express.Router();
const root = path.resolve(__dirname, '..');
const maxArchiveBytes = 10 * 1024 * 1024;
const upload = multer({ dest: path.join(os.tmpdir(), 'my-auto-platform-uploads'), limits: { fileSize: maxArchiveBytes, files: 1 } });
const safeFiles = ['package.json','render.yaml','server.js','README.md','core/database.js','core/store.js','routes/auth.js','routes/admin.js','routes/integrations.js','routes/backup.js','routes/devops-api.js','middleware/auth.js','public/index.html','public/dashboard.html','public/login.html','public/register.html','public/admin.html','public/integrations.html','database/001_platform_tables.sql'];
function runTar(args, options={}) { return new Promise((resolve,reject)=>execFile('tar',args,options,(error,stdout,stderr)=>error?reject(new Error(stderr||error.message)):resolve({stdout,stderr}))); }
function isSafeEntry(name) { if(!name || name.includes('\\') || name.startsWith('/') || name.includes('..')) return false; return safeFiles.includes(name) || name==='backup-data.json'; }
async function removeFile(file) { if(!file)return; try { await fsp.rm(file,{force:true,recursive:true}); } catch(_) {} }
async function copySafeFiles(stage) { for(const relative of safeFiles){const source=path.join(root,relative),target=path.join(stage,relative);await fsp.mkdir(path.dirname(target),{recursive:true});await fsp.copyFile(source,target);} }
router.get('/export', authRequired, adminRequired, async (req,res)=>{
  const work=await fsp.mkdtemp(path.join(os.tmpdir(),'my-auto-platform-backup-')); const out=path.join(os.tmpdir(),`my-auto-platform-${Date.now()}.tar.gz`);
  try { const data=await store.exportData(); await copySafeFiles(work); await fsp.writeFile(path.join(work,'backup-data.json'),JSON.stringify(data,null,2),{mode:0o600}); await runTar(['-czf',out,'-C',work,...safeFiles,'backup-data.json']); res.download(out,'my-auto-platform-backup.tar.gz',async()=>{await removeFile(out);await removeFile(work);}); }
  catch(error){await removeFile(out);await removeFile(work);console.error('[Backup] export:',error);res.status(503).json({ok:false,error:'Backup generation failed. Ensure persistent storage is configured.'});}
});
router.post('/restore', authRequired, adminRequired, upload.single('archive'), async(req,res)=>{
  const archive=req.file?.path; const stage=await fsp.mkdtemp(path.join(os.tmpdir(),'my-auto-platform-restore-'));
  try {
    if(!archive)return res.status(400).json({ok:false,error:'Upload a .tar.gz backup using form field "archive".'});
    const listing=await runTar(['-tzf',archive]); const entries=listing.stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    if(!entries.length||entries.length>100||!entries.every(isSafeEntry))throw new Error('Archive contains a forbidden, unsafe, or excessive entry');
    const detail=await runTar(['-tvzf',archive]); if(detail.stdout.split(/\r?\n/).filter(Boolean).some(line=>!line.startsWith('-')))throw new Error('Archive contains non-regular entries');
    await runTar(['-xzf',archive,'-C',stage,'--no-same-owner','--no-same-permissions']);
    const payload=JSON.parse(await fsp.readFile(path.join(stage,'backup-data.json'),'utf8')); const restored=await store.restoreData(payload);
    res.json({ok:true,restored,message:'Backup data validated and restored. Archived source files were not executed.'});
  } catch(error){console.error('[Backup] restore:',error);res.status(400).json({ok:false,error:`Restore rejected: ${error.message}`});}
  finally{await removeFile(archive);await removeFile(stage);}
});
module.exports=router;
