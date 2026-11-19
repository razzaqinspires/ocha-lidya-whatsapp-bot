import { spawn } from 'node:child_process';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getConfig } from '../core/config.js';
import { logger } from '../core/logger.js';

const TOKENS = ['>>>','>>','=>','>','$'];
export function isMasterSyntax(body) { return TOKENS.some(token => body.startsWith(token) && body.slice(token.length).trim()); }
const runtimeLimits = () => getConfig().limits;
const outputLimit = () => Number(runtimeLimits().masterMaxOutput || 12000);
const timeout = () => Math.min(Number(runtimeLimits().masterTimeoutMs || 8000), 30000);

function runProcess(command, args, input) {
  return new Promise((resolve,reject) => {
    const child = spawn(command,args,{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR}});
    let stdout='',stderr='',settled=false;
    const limit=outputLimit();
    const timer=setTimeout(()=>{child.kill('SIGKILL'); if(!settled){settled=true;reject(new Error('Execution timeout'));}},timeout());
    const collect=(target,chunk)=>{target.value+=chunk.toString();if(target.value.length>limit) target.value=target.value.slice(0,limit)+'\n[output truncated]';};
    const out={value:''},err={value:''};
    child.stdout.on('data',c=>collect(out,c)); child.stderr.on('data',c=>collect(err,c));
    child.on('error',e=>{clearTimeout(timer);if(!settled){settled=true;reject(e);}});
    child.on('close',code=>{clearTimeout(timer);if(!settled){settled=true;resolve({code,stdout:out.value,stderr:err.value});}});
    child.stdin.end(input);
  });
}
async function runGo(source) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocha-go-'));
  const file = path.join(dir, 'main.go');
  try {
    await fs.writeFile(file, source, { mode: 0o600 });
    return await runProcess('go', ['run', file]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
async function sendResult(m, title, result) {
  const content = [title, result.stdout && `STDOUT:\n${result.stdout}`, result.stderr && `STDERR:\n${result.stderr}`, `Exit: ${result.code}`].filter(Boolean).join('\n\n');
  await m.reply(content.slice(0,outputLimit()));
}
async function runJs(m, source, returnMode) {
  if (!getConfig().security.masterEvalEnabled) return m.reply('Eval dinonaktifkan. Aktifkan melalui konfigurasi persisten hanya pada deployment privat.');
  // vm is a convenience context, not a security boundary. This feature is opt-in and owner-only.
  const logs = [];
  const writeLog = (...values) => logs.push(values.map(value => {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join(' '));
  const safeConsole = { log:writeLog, info:writeLog, warn:writeLog, error:writeLog, debug:writeLog };
  const context = vm.createContext({ console:safeConsole, Buffer, setTimeout, clearTimeout, setInterval, clearInterval });
  const body = returnMode && !/\breturn\b/.test(source) ? `return (${source});` : source;
  const wrapped = `(async()=>{ ${body} })()`;
  try {
    const script = new vm.Script(wrapped,{filename:'ocha-owner-eval.js'});
    const execution = script.runInContext(context,{timeout:timeout()});
    const value = await Promise.race([execution,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Async execution timeout')),timeout()))]);
    const output = [...logs, ...(value === undefined ? [] : [typeof value === 'string' ? value : JSON.stringify(value)])].join('\n');
    await m.reply((output || 'undefined').slice(0,outputLimit()));
  } catch(error) { await m.reply(`${error.name}: ${error.message}`); }
}
export async function runMasterCommand(sock,m,body) {
  const token = TOKENS.find(t=>body.startsWith(t));
  const code = body.slice(token.length).trim();
  const security = getConfig().security;
  const enabled = security.masterExecEnabled;
  if (token === '>' || token === '=>') return runJs(m,code,token === '=>');
  if (!enabled) return m.reply('Master execution dinonaktifkan. Aktifkan hanya pada server privat yang Anda kendalikan.');
  try {
    let result;
    if (token === '$') {
      if (!security.masterCliEnabled) return m.reply('CLI shell belum diaktifkan.');
      result = await runProcess('/bin/sh',['-lc',code]);
    } else if (token === '>>') {
      if (!security.masterPythonEnabled) return m.reply('Python runner belum diaktifkan.');
      result = await runProcess('python3',['-I','-c',code]);
    } else if (token === '>>>') {
      if (!security.masterGolangEnabled) return m.reply('Go runner belum diaktifkan.');
      result = await runGo(code);
    }
    await sendResult(m,`Ocha Master · ${token}`,result);
  } catch(error) {
    logger.warn({err:error,token},'Master command failed');
    await m.reply(`Master error: ${error.message}`);
  }
}
