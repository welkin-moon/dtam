#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

function verifyCsp() {
  const htmlPath = path.join(root, 'index.html');
  const headersPath = path.join(root, '_headers');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const headers = fs.readFileSync(headersPath, 'utf8');

  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert(scriptMatch, 'index.html 内未找到内联 <script> 标签');

  const inlineScript = scriptMatch[1];
  assert(!inlineScript.includes('\r\n'), 'index.html 包含 Windows CRLF (\\r\\n) 换行符，将导致生产环境 CSP sha256 签名失效！请配置 .gitattributes 并转换为 LF 换行。');

  const hash = 'sha256-' + crypto.createHash('sha256').update(inlineScript).digest('base64');
  assert(headers.includes(hash), `index.html 内联脚本的 sha256 哈希 (${hash}) 未在 _headers Content-Security-Policy 允许列表中！`);
  console.log(`[PASS] CSP 内联脚本哈希校验通过 (${hash})，且已确认保持 LF 换行。`);
}

function checkJsSyntax(files, isModule = false) {
  for (const relPath of files) {
    const fullPath = path.join(root, relPath);
    assert(fs.existsSync(fullPath), `目标文件不存在: ${relPath}`);

    if (isModule) {
      const ext = path.extname(relPath);
      const tmpFile = path.join(process.env.TEMP || '.', `__chk_${Math.random().toString(36).slice(2)}_${path.basename(relPath, ext)}.mjs`);
      try {
        fs.copyFileSync(fullPath, tmpFile);
        execFileSync(process.execPath, ['--check', tmpFile], { stdio: 'pipe' });
      } catch (err) {
        const errDetails = err.stderr ? err.stderr.toString().trim() : err.message;
        assert(false, `${relPath} ES 模块语法错误:\n${errDetails}`);
      } finally {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
      }
    } else {
      try {
        execFileSync(process.execPath, ['--check', fullPath], { stdio: 'pipe' });
      } catch (err) {
        const errDetails = err.stderr ? err.stderr.toString().trim() : err.message;
        assert(false, `${relPath} 脚本语法错误:\n${errDetails}`);
      }
    }
  }
}

const mode = process.argv[2] || 'all';

if (mode === 'csp' || mode === 'all') {
  verifyCsp();
}

if (mode === 'classic' || mode === 'all') {
  const classicScripts = ['game.js', 'v3-bootstrap.js', 'v3-resilience.js', 'game-polish.js'];
  checkJsSyntax(classicScripts, false);
  console.log(`[PASS] 经典 JS 脚本语法校验通过 (${classicScripts.length} 个文件)。`);
}

if (mode === 'modules' || mode === 'all') {
  const esModules = [
    'bootstrap.js',
    'p2p-entry.js',
    'p2p-trystero.js',
    'p2p-cf-mailbox.js',
    'p2p-game-room-patch.js',
    'p2p-authority-clock.js',
    'p2p-join-guard.js',
    'voice-pc-close-guard.js',
    'runtime-guard.js',
    'p2p-doorbell-bootstrap.js',
    'hybrid-transport.js',
    'p2p-resilience.js',
    'p2p-doorbell-host.js',
    'p2p-stability-guard.js',
    'minimap-hud.js',
    'minimap-hud-refresh.js',
    'minimap-hud-late.js',
    'net-config.js',
    'signal-budget.js',
    'runtime-policy.js',
    'recovery-fanout.js'
  ];
  checkJsSyntax(esModules, true);
  console.log(`[PASS] ES 模块静态语法校验通过 (${esModules.length} 个文件)。`);
}

if (mode === 'workers' || mode === 'all') {
  const workers = ['worker.js', 'workers/p2p-signal-v2.js'];
  checkJsSyntax(workers, true);
  console.log(`[PASS] Worker 脚本静态语法校验通过 (${workers.length} 个文件)。`);
}
