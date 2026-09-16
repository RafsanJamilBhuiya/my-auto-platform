const express=require('express');
const fs=require('fs');
const fsp=fs.promises;
const path=require('path');
const os=require('os');
const {execFile}=require('child_process');
const multer=require('multer');
const {authRequired,adminRequired}=require('../middleware/auth');
const store=require('../core/store');
const router=express.Router();
const root=path.resolve(__dirname,'..');
const maxArchiveBytes=10*1024*1024;
const upload=multer({dest:path.join(os.tmpdir(),'my-auto-platform-uploads'),limits:{fileSize:maxArchiveBytes,files:1}});
const safeFiles=['package.json','render.yaml','server.js','README.md','routes/auth.js','routes/admin.js','routes/integrations.js','routes/backup.js','routes/devops-api.js','middleware/auth.js','core/store.js','public/index.html','public/dashboard.html','public/login.html','public/register.html','public/admin.html','public/integrations.html','public/navbar.js'];
function runTar(args,options={}){return new Promise((resolve,reject)=>execFile('tar',args,options,(error,stdout,stderr)=>error?reject(new Error(stderr||error.message)):resolve({stdout,stderr})));}
function isSafeEntry(name){if(!name||name.includes('\\')||name.startsWith('/')||name.includes('..'))return false;return safeFiles.includes(name)||name==='backup-data.json';}
async function removeFile(file){if(!file)return;try{await fsp.rm(file,{force:true,recursive:true});}catch(_) {}}
async function copySafeFiles(stage){for(const relative of safeFiles){const source=path.join(root,relative),target=path.join(stage,relative);try{await fsp.mkdir(path.dirname(target),{recursive:true});await fsp.copyFile(source,target);}catch(error){if(error.code!=='ENOENT')throw error;}}}

// Direct JSON backup: reads native store state and sends it as an attachment; no persistent disk is required.
router.get('/export',authRequired,adminRequired,async(req,res)=>{
  try{
    const data=await store.exportData();
    const payload=JSON.stringify({format:'my-auto-platform-backup',version:1,exportedAt:data.exportedAt,users:data.users,integrations:data.integrations},null,2);
    const filename=`my-auto-platform-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
    res.set({'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="${filename}"`,'Cache-Control':'no-store','Content-Length':String(Buffer.byteLength(payload))});
    res.status(200).send(payload);
  }catch(error){console.error('[Backup] direct export:',error);res.status(500).json({ok:false,error:'Backup generation failed'});}
});

// Legacy archive restore remains supported for previously exported tar.gz backups.
router.post('/restore',authRequired,adminRequired,upload.single('archive'),async(req,res)=>{
  const archive=req.file?.path;const stage=await fsp.mkdtemp(path.join(os.tmpdir(),'my-auto-platform-restore-'));
  try{
    if(!archive)return res.status(400).json({ok:false,error:'Upload a .tar.gz backup using form field "archive".'});
    const listing=await runTar(['-tzf',archive]);const entries=listing.stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    if(!entries.length||entries.length>100||!entries.every(isSafeEntry))throw new Error('Archive contains a forbidden, unsafe, or excessive entry');
    const detail=await runTar(['-tvzf',archive]);if(detail.stdout.split(/\r?\n/).filter(Boolean).some(line=>!line.startsWith('-')))throw new Error('Archive contains non-regular entries');
    await runTar(['-xzf',archive,'-C',stage,'--no-same-owner','--no-same-permissions']);
    const payload=JSON.parse(await fsp.readFile(path.join(stage,'backup-data.json'),'utf8'));const restored=await store.restoreData(payload);
    res.json({ok:true,restored,message:'Backup data validated and restored. Archived source files were not executed.'});
  }catch(error){console.error('[Backup] restore:',error);res.status(400).json({ok:false,error:`Restore rejected: ${error.message}`});}
  finally{await removeFile(archive);await removeFile(stage);}
});
module.exports=router;
