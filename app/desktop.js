// Desktop glue, runs in the page before the editor. It gives the editor the same
// "downloads" and "sample" services it has on claude.ai, backed by the desktop app.
(function () {
  const N = window.regaimNative;
  if (!N) return;
  const codeOf = (e) => { const m = String(e && e.message || e).match(/\[(\w+)\]/); return m ? m[1] : 'unavailable'; };
  const b64 = async (blob) => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };

  window.regaim = {
    desktop: true,
    // HEVC and anything else Chromium can't play: full FFmpeg, no size or length limit
    async convertFile(f, onP) {
      const p = N.pathOf(f);
      if (!p) throw new Error('no path');
      const r = await N.convert(p, f.name, (x) => onP && onP(x));
      const blob = await (await fetch(r.url)).blob();
      return new File([blob], r.name, { type: 'video/mp4' });
    }
  };

  window.claude = {
    async use(name) {
      if (name === 'downloads') {
        return {
          async save({ filename, data }) {
            const r = await N.saveFile(filename, await data.arrayBuffer());
            if (r && r.canceled) { const e = new Error('declined'); e.code = 'declined'; throw e; }
            if (r && r.path) setTimeout(() => { const t = document.getElementById('toast'); if (t) { t.textContent = 'נשמר: ' + r.path; t.hidden = false; setTimeout(() => (t.hidden = true), 5000); } }, 50);
            return r;
          }
        };
      }
      if (name === 'sample') {
        const st = await N.keyStatus();
        if (!st.has) { const e = new Error('no key'); e.code = 'not_granted'; throw e; }
        return {
          async limits() { return { images: { maxCount: 4, mediaTypes: ['image/jpeg', 'image/png'] } }; },
          async json(prompt, opts) {
            opts = opts || {};
            const images = await Promise.all((opts.images || []).map(async (b) => ({ type: b.type || 'image/jpeg', data: await b64(b) })));
            try { return await N.claudeJson(prompt, images, opts.modelTier === 'quick' ? 'quick' : 'default'); }
            catch (e) { const er = new Error(String(e.message || e)); er.code = codeOf(e); throw er; }
          }
        };
      }
      throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
    }
  };

  // settings: version, updates, and the optional Claude key
  function ui() {
    const acts = document.querySelector('.topacts');
    if (!acts || document.getElementById('dkSet')) return;
    const css = document.createElement('style');
    css.textContent = `#dkSet{position:relative}#dkSet[data-u]::after{content:'';position:absolute;top:5px;left:5px;width:8px;height:8px;border-radius:50%;background:var(--amber)}
    .dk p{margin:0}.dk .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.dk input[type=password]{flex:1;min-width:0;background:var(--raise);border:1px solid var(--line);border-radius:9px;padding:9px 10px;color:inherit;font:13px var(--mono)}
    .dk .ok{color:var(--ok)}.dk .mut{color:var(--mute);font-size:13px}.dk h4{margin:6px 0 0;font-size:15px}`;
    document.head.append(css);
    const b = document.createElement('button'); b.className = 'btn'; b.id = 'dkSet'; b.textContent = 'הגדרות';
    acts.prepend(b);
    const sh = document.createElement('div'); sh.className = 'sheet'; sh.hidden = true; sh.dir = 'rtl'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
    sh.innerHTML = `<div class="dk"><div style="display:flex;justify-content:space-between;align-items:center"><h3>הגדרות</h3><button class="btn" id="dkX" aria-label="סגירה">×</button></div>
      <h4>גרסה</h4><div class="row"><span id="dkVer" class="mut"></span><span id="dkUp" class="mut"></span><button class="btn" id="dkChk">בדיקת עדכונים</button></div>
      <h4>Claude (לא חובה)</h4>
      <p class="mut">עם מפתח API של Anthropic התוכנה מבינה מה יש בכל תמונה, נותנת שם לקליפ ומוצאת חפץ לפי תיאור. בלי מפתח כל השאר עובד כרגיל. המפתח נשמר מוצפן על המחשב הזה בלבד, והשימוש מחויב בחשבון Anthropic שלך.</p>
      <div class="row"><input type="password" id="dkKey" placeholder="sk-ant-..." autocomplete="off" spellcheck="false" dir="ltr"><button class="btn hot" id="dkSave">שמירה</button><button class="btn" id="dkDel">הסרה</button></div>
      <span id="dkKs" class="mut"></span></div>`;
    document.body.append(sh);
    const $ = (id) => document.getElementById(id);
    const ks = async () => { const s = await N.keyStatus(); $('dkKs').textContent = s.has ? '✓ מפתח שמור' : 'אין מפתח שמור'; $('dkKs').className = s.has ? 'ok' : 'mut'; };
    const upTxt = (s) => ({ checking: 'בודק…', downloading: `מוריד גרסה ${s.version || ''} ${s.p ? Math.round(s.p * 100) + '%' : ''}`, ready: `גרסה ${s.version} מוכנה, תותקן בסגירה`, latest: '✓ זו הגרסה העדכנית', error: 'הבדיקה נכשלה, ננסה שוב מאוחר יותר' })[s.status] || '';
    N.onUpdate((s) => { $('dkUp').textContent = upTxt(s); if (s.status === 'ready' || s.status === 'downloading') b.dataset.u = '1'; });
    b.onclick = async () => { sh.hidden = false; const i = await N.info(); $('dkVer').textContent = 'רגעים ' + i.version + (i.packaged ? '' : ' (פיתוח)'); $('dkUp').textContent = upTxt(await N.updateState()); ks(); };
    $('dkX').onclick = () => (sh.hidden = true);
    sh.addEventListener('click', (e) => { if (e.target === sh) sh.hidden = true; });
    $('dkChk').onclick = () => { $('dkUp').textContent = 'בודק…'; N.checkUpdates(); };
    $('dkSave').onclick = async () => { const v = $('dkKey').value.trim(); if (!/^sk-ant-/.test(v)) { $('dkKs').textContent = 'זה לא נראה כמו מפתח של Anthropic (מתחיל ב-sk-ant-)'; return; } await N.setKey(v); $('dkKey').value = ''; ks(); };
    $('dkDel').onclick = async () => { await N.setKey(''); ks(); };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ui); else ui();
})();
