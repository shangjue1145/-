// ==UserScript==
// @name         DeepSeek 余额悬浮球
// @namespace    deepseek-balance-fab
// @version      1.0.0
// @description  悬浮显示 DeepSeek 开放平台充值余额：可拖动、可缩放、每 10 秒自动刷新、位置大小永久记忆
// @author       you
// @match        http://127.0.0.1:3080/*
// @match        http://localhost:3080/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      api.deepseek.com
// @license      MIT
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ==================== 配置 ==================== */
  var REFRESH_MS = 10 * 1000; // 自动刷新间隔（毫秒）
  var API_URL = 'https://api.deepseek.com/user/balance';
  var MIN_BALL = 48, MAX_BALL = 200; // 悬浮球直径范围（px）
  var MIN_PW = 260, MIN_PH = 300, MAX_PW = 600, MAX_PH = 800; // 面板尺寸范围（px）

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ==================== 永久记忆（本机存储） ==================== */
  function sget(key, def) {
    try { var v = GM_getValue(key); return (v === undefined || v === null) ? def : v; } catch (e) { return def; }
  }
  function sset(key, val) { try { GM_setValue(key, val); } catch (e) {} }

  var apiKey = String(sget('dsfab.key', '') || '');
  var pos = sget('dsfab.pos', null);          // {x, y}
  var size = clamp(Number(sget('dsfab.size', 64)) || 64, MIN_BALL, MAX_BALL);
  var psize = sget('dsfab.psize', null);      // {x, y, w, h}
  var balance = null, error = null, lastUpdate = 0, open = false;

  /* ==================== 外壳与样式（Shadow DOM 隔离页面样式） ==================== */
  var host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;';
  var root = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = [
    '*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}',
    '.ball{position:fixed;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14%;',
    'border-radius:50%;background:radial-gradient(circle at 30% 26%,#7c96ff 0%,#4d6bfe 55%,#2f4bd8 100%);color:#fff;',
    'box-shadow:0 6px 24px rgba(77,107,254,.45),0 2px 6px rgba(0,0,0,.25);cursor:grab;touch-action:none;',
    'border:2px solid rgba(255,255,255,.4);transition:box-shadow .15s}',
    '.ball:active{cursor:grabbing}',
    '.ball:hover{box-shadow:0 10px 32px rgba(77,107,254,.6),0 2px 8px rgba(0,0,0,.3)}',
    '.num{font-weight:700;line-height:1;white-space:nowrap}',
    '.sub{line-height:1.2;white-space:nowrap;opacity:.9}',
    '.dot{position:absolute;top:9%;right:9%;width:13%;height:13%;border-radius:50%;border:2px solid #fff}',
    '.ok{background:#22c55e}.warn{background:#f59e0b}.bad{background:#ef4444}.idle{background:#94a3b8}',
    '.rz{position:absolute;right:-2px;bottom:-2px;width:24%;height:24%;display:flex;align-items:flex-end;justify-content:flex-end;',
    'color:rgba(255,255,255,.95);cursor:nwse-resize;opacity:0;transition:opacity .15s}',
    '.ball:hover .rz{opacity:1}',
    '.panel{position:fixed;display:none;flex-direction:column;background:#fff;border-radius:14px;border:1px solid #e2e8f0;',
    'box-shadow:0 12px 40px rgba(15,23,42,.25);overflow:hidden;color:#0f172a}',
    '.panel.open{display:flex}',
    '.phead{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;',
    'background:linear-gradient(90deg,#4d6bfe,#2f4bd8);color:#fff;cursor:grab;touch-action:none}',
    '.phead:active{cursor:grabbing}',
    '.ptitle{font-size:14px;font-weight:600}',
    '.pclose{border:none;background:transparent;color:#fff;font-size:16px;cursor:pointer;line-height:1;padding:2px 8px;border-radius:6px}',
    '.pclose:hover{background:rgba(255,255,255,.25)}',
    '.pbody{flex:1;overflow:auto;padding:12px 14px;font-size:13px}',
    '.row{display:flex;justify-content:space-between;align-items:center;padding:9px 2px;border-bottom:1px dashed #e2e8f0}',
    '.row .k{color:#64748b}',
    '.row .v{font-weight:600;font-variant-numeric:tabular-nums}',
    '.big .v{font-size:20px;color:#3451e0}',
    '.status{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600}',
    '.st-ok{background:#dcfce7;color:#15803d}.st-warn{background:#fef3c7;color:#b45309}.st-bad{background:#fee2e2;color:#b91c1c}',
    '.msg{margin-top:6px;padding:8px 10px;border-radius:8px;background:#fef2f2;color:#b91c1c;font-size:12px}',
    '.updated{margin-top:10px;color:#94a3b8;font-size:11px;display:flex;justify-content:space-between;align-items:center;gap:8px}',
    '.btn{border:none;background:#eef2ff;color:#3451e0;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;font-weight:600;white-space:nowrap}',
    '.btn:hover{background:#e0e7ff}',
    '.pfoot{padding:10px 14px;border-top:1px solid #e2e8f0;background:#f8fafc}',
    '.label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}',
    '.keyrow{display:flex;gap:6px}',
    '.keyrow input{flex:1;min-width:0;border:1px solid #cbd5e1;border-radius:8px;padding:6px 8px;font-size:12px;outline:none;font-family:inherit;user-select:text}',
    '.keyrow input:focus{border-color:#4d6bfe}',
    '.hint{margin-top:6px;font-size:11px;color:#94a3b8;line-height:1.6}',
    '.hint a{color:#4d6bfe;text-decoration:none}',
    '.prz{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;touch-action:none}',
    '.prz::after{content:"";position:absolute;right:3px;bottom:3px;width:8px;height:8px;border-right:2px solid #94a3b8;border-bottom:2px solid #94a3b8}'
  ].join('\n');
  root.appendChild(style);

  /* ==================== 悬浮球 ==================== */
  var ball = document.createElement('div');
  ball.className = 'ball';
  ball.title = 'DeepSeek 余额：单击展开面板 · 按住拖动 · 拖右下角缩放';
  var numEl = document.createElement('div');
  numEl.className = 'num';
  var subEl = document.createElement('div');
  subEl.className = 'sub';
  var dotEl = document.createElement('div');
  dotEl.className = 'dot idle';
  var rzEl = document.createElement('div');
  rzEl.className = 'rz';
  rzEl.textContent = '↘';
  ball.appendChild(numEl);
  ball.appendChild(subEl);
  ball.appendChild(dotEl);
  ball.appendChild(rzEl);

  /* ==================== 面板 ==================== */
  var panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML =
    '<div class="phead" id="phead"><span class="ptitle">DeepSeek 余额</span><button class="pclose" id="pclose" title="关闭">✕</button></div>' +
    '<div class="pbody" id="pbody"></div>' +
    '<div class="pfoot">' +
    '  <label class="label">API Key（仅保存在本机浏览器）</label>' +
    '  <div class="keyrow"><input id="key" type="password" placeholder="sk-..." autocomplete="off" spellcheck="false"><button class="btn" id="save">保存</button></div>' +
    '  <div class="hint">到 <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener">platform.deepseek.com/api_keys</a> 创建 Key。Key 只保存在本机 Tampermonkey 存储中，不会上传。</div>' +
    '</div>' +
    '<div class="prz" id="prz" title="拖动缩放面板"></div>';
  root.appendChild(ball);
  root.appendChild(panel);
  document.documentElement.appendChild(host);

  var pbody = panel.querySelector('#pbody');
  var phead = panel.querySelector('#phead');
  var keyInput = panel.querySelector('#key');
  keyInput.value = apiKey;

  /* ==================== 悬浮球：拖动 ==================== */
  var drag = null;
  ball.addEventListener('pointerdown', function (e) {
    if (e.target === rzEl || (e.target.closest && e.target.closest('.rz'))) return;
    if (e.button !== 0) return;
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
    try { ball.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  ball.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    pos.x = clamp(drag.ox + dx, 0, window.innerWidth - size);
    pos.y = clamp(drag.oy + dy, 0, window.innerHeight - size);
    applyBallPos();
  });
  ball.addEventListener('pointerup', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var moved = drag.moved;
    drag = null;
    sset('dsfab.pos', pos);
    if (!moved) togglePanel();
  });

  /* ==================== 悬浮球：缩放 ==================== */
  rzEl.addEventListener('pointerdown', function (e) {
    e.stopPropagation();
    e.preventDefault();
    try { rzEl.setPointerCapture(e.pointerId); } catch (err) {}
    var s0 = size, x0 = e.clientX, y0 = e.clientY;
    function mv(ev) {
      size = clamp(s0 + (ev.clientX - x0 + ev.clientY - y0) / 2, MIN_BALL, MAX_BALL);
      applyBallSize();
      pos.x = clamp(pos.x, 0, window.innerWidth - size);
      pos.y = clamp(pos.y, 0, window.innerHeight - size);
      applyBallPos();
    }
    function up() {
      rzEl.removeEventListener('pointermove', mv);
      rzEl.removeEventListener('pointerup', up);
      sset('dsfab.size', size);
      sset('dsfab.pos', pos);
    }
    rzEl.addEventListener('pointermove', mv);
    rzEl.addEventListener('pointerup', up);
  });

  /* ==================== 面板：拖动 ==================== */
  var pdrag = null;
  phead.addEventListener('pointerdown', function (e) {
    if (e.target && e.target.id === 'pclose') return;
    if (e.button !== 0) return;
    pdrag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: psize.x, oy: psize.y };
    try { phead.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  phead.addEventListener('pointermove', function (e) {
    if (!pdrag || e.pointerId !== pdrag.id) return;
    psize.x = clamp(pdrag.ox + e.clientX - pdrag.sx, 0, window.innerWidth - psize.w);
    psize.y = clamp(pdrag.oy + e.clientY - pdrag.sy, 0, window.innerHeight - psize.h);
    panel.style.left = psize.x + 'px';
    panel.style.top = psize.y + 'px';
  });
  phead.addEventListener('pointerup', function (e) {
    if (!pdrag || e.pointerId !== pdrag.id) return;
    pdrag = null;
    sset('dsfab.psize', psize);
  });

  /* ==================== 面板：缩放 ==================== */
  var prz = panel.querySelector('#prz');
  prz.addEventListener('pointerdown', function (e) {
    e.stopPropagation();
    e.preventDefault();
    try { prz.setPointerCapture(e.pointerId); } catch (err) {}
    var w0 = psize.w, h0 = psize.h, x0 = e.clientX, y0 = e.clientY;
    function mv(ev) {
      psize.w = clamp(w0 + ev.clientX - x0, MIN_PW, MAX_PW);
      psize.h = clamp(h0 + ev.clientY - y0, MIN_PH, MAX_PH);
      panel.style.width = psize.w + 'px';
      panel.style.height = psize.h + 'px';
    }
    function up() {
      prz.removeEventListener('pointermove', mv);
      prz.removeEventListener('pointerup', up);
      sset('dsfab.psize', psize);
    }
    prz.addEventListener('pointermove', mv);
    prz.addEventListener('pointerup', up);
  });

  /* ==================== 面板：开关与定位 ==================== */
  function togglePanel() {
    open = !open;
    panel.classList.toggle('open', open);
    if (open) placePanel();
  }
  function placePanel() {
    var m = 10, vw = window.innerWidth, vh = window.innerHeight;
    var x, y;
    if (typeof psize.x === 'number') {
      x = psize.x; y = psize.y;
    } else {
      var ballLeft = pos.x + size / 2 <= vw / 2;
      x = ballLeft ? pos.x + size + m : pos.x - psize.w - m;
      y = pos.y + size - psize.h;
    }
    x = clamp(x, m, Math.max(m, vw - psize.w - m));
    y = clamp(y, m, Math.max(m, vh - psize.h - m));
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    psize.x = x; psize.y = y;
    sset('dsfab.psize', psize);
  }
  panel.querySelector('#pclose').addEventListener('click', function () {
    open = false;
    panel.classList.remove('open');
  });
  panel.querySelector('#save').addEventListener('click', function () {
    apiKey = keyInput.value.trim();
    sset('dsfab.key', apiKey);
    balance = null; error = null; lastUpdate = 0;
    renderBall(); renderStatus();
    fetchBalance();
  });

  /* ==================== 位置 / 大小应用 ==================== */
  function applyBallPos() {
    ball.style.left = pos.x + 'px';
    ball.style.top = pos.y + 'px';
  }
  function applyBallSize() {
    ball.style.width = size + 'px';
    ball.style.height = size + 'px';
    fitNumFont();
    subEl.style.fontSize = Math.round(size * 0.12) + 'px';
    rzEl.style.fontSize = Math.round(size * 0.16) + 'px';
  }
  function fitNumFont() {
    var t = numEl.textContent || '';
    var f = size * 0.30;
    if (t.length > 9) f = size * 0.17;
    else if (t.length > 7) f = size * 0.20;
    else if (t.length > 5) f = size * 0.24;
    numEl.style.fontSize = Math.round(f) + 'px';
  }

  /* ==================== 余额数据（DeepSeek 官方接口） ==================== */
  function fetchBalance() {
    if (!apiKey) { renderBall(); renderStatus(); return; }
    GM_xmlhttpRequest({
      method: 'GET',
      url: API_URL,
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Accept': 'application/json' },
      timeout: 10000,
      onload: function (res) {
        try {
          var data = JSON.parse(res.responseText || res.response || '{}');
          if (res.status === 401) { error = 'API Key 无效（401），请重新填写'; balance = null; }
          else if (res.status !== 200) { error = '接口返回错误码 ' + res.status; balance = null; }
          else {
            var info = data.balance_infos && data.balance_infos[0];
            if (!info) { error = '返回数据缺少余额信息'; balance = null; }
            else {
              balance = {
                currency: info.currency || 'CNY',
                total: info.total_balance,
                topped: info.topped_up_balance,
                granted: info.granted_balance,
                available: !!data.is_available
              };
              error = null;
            }
          }
        } catch (err) { error = '返回数据解析失败'; balance = null; }
        lastUpdate = Date.now();
        renderBall(); renderStatus();
      },
      onerror: function () { error = '网络错误，无法连接 api.deepseek.com'; lastUpdate = Date.now(); renderBall(); renderStatus(); },
      ontimeout: function () { error = '请求超时（10 秒）'; lastUpdate = Date.now(); renderBall(); renderStatus(); }
    });
  }

  /* ==================== 显示 ==================== */
  function fmtMoney(v) {
    var n = Number(v);
    if (isNaN(n)) return String(v);
    if (n !== 0 && Math.abs(n) < 1) return n.toFixed(4);
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }
  function curSym(c) {
    if (c === 'CNY') return '¥';
    if (c === 'USD') return '$';
    return c ? c + ' ' : '';
  }
  function renderBall() {
    var num = '…', sub = '', dot = 'idle';
    if (!apiKey) { num = '设置'; sub = 'API Key'; }
    else if (balance) {
      num = curSym(balance.currency) + fmtMoney(balance.total);
      sub = balance.available ? '可用' : '需充值';
      dot = balance.available ? 'ok' : 'warn';
    } else if (error) { num = 'ERR'; sub = '重试'; dot = 'bad'; }
    numEl.textContent = num;
    subEl.textContent = sub;
    dotEl.className = 'dot ' + dot;
    fitNumFont();
  }
  function renderStatus() {
    var html = '';
    if (!apiKey) {
      html = '<div class="msg">尚未配置 API Key，请在下方输入并点击“保存”。</div>';
    } else if (balance) {
      var sym = curSym(balance.currency);
      html =
        '<div class="row big"><span class="k">总余额</span><span class="v">' + sym + fmtMoney(balance.total) + '</span></div>' +
        '<div class="row"><span class="k">充值余额</span><span class="v">' + sym + fmtMoney(balance.topped) + '</span></div>' +
        '<div class="row"><span class="k">赠送余额</span><span class="v">' + sym + fmtMoney(balance.granted) + '</span></div>' +
        '<div class="row"><span class="k">币种</span><span class="v">' + (balance.currency || 'CNY') + '</span></div>' +
        '<div class="row"><span class="k">状态</span><span class="status ' + (balance.available ? 'st-ok' : 'st-warn') + '">' +
        (balance.available ? '✓ 可用' : '⚠ 不可用，请充值') + '</span></div>';
    } else if (error) {
      html = '<div class="msg">' + error + '</div>';
    } else {
      html = '<div class="msg">正在获取余额…</div>';
    }
    if (lastUpdate && apiKey) {
      var t = new Date(lastUpdate);
      function p2(n) { return (n < 10 ? '0' : '') + n; }
      html += '<div class="updated"><span>更新于 ' + p2(t.getHours()) + ':' + p2(t.getMinutes()) + ':' + p2(t.getSeconds()) +
        ' · 每 10 秒自动刷新</span><button class="btn" id="refresh">立即刷新</button></div>';
    }
    pbody.innerHTML = html;
    var rf = pbody.querySelector('#refresh');
    if (rf) rf.addEventListener('click', fetchBalance);
  }

  /* ==================== 定时刷新 / 回到前台立即刷新 ==================== */
  setInterval(fetchBalance, REFRESH_MS);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) fetchBalance();
  });

  /* ==================== 油猴菜单 ==================== */
  if (typeof GM_registerMenuCommand === 'function') {
    try {
      GM_registerMenuCommand('打开 DeepSeek 余额面板', function () {
        open = true; panel.classList.add('open'); placePanel();
      });
      GM_registerMenuCommand('立即刷新 DeepSeek 余额', fetchBalance);
    } catch (e) {}
  }

  /* ==================== 初始化 ==================== */
  var vw = window.innerWidth, vh = window.innerHeight;
  if (!pos) pos = { x: vw - size - 24, y: vh - size - 24 };
  pos.x = clamp(pos.x, 0, Math.max(0, vw - size));
  pos.y = clamp(pos.y, 0, Math.max(0, vh - size));
  if (!psize) psize = { w: 300, h: 430 };
  panel.style.width = psize.w + 'px';
  panel.style.height = psize.h + 'px';
  applyBallPos();
  applyBallSize();
  renderBall();
  renderStatus();
  fetchBalance();
  window.addEventListener('resize', function () {
    pos.x = clamp(pos.x, 0, Math.max(0, window.innerWidth - size));
    pos.y = clamp(pos.y, 0, Math.max(0, window.innerHeight - size));
    applyBallPos();
    if (open) placePanel();
  });
})();
