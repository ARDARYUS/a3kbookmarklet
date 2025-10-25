
// AssessmentHelper — MCQ-Only (rewritten clean build)
// – Keeps launcher UI, eye animations (lightweight), settings (MC only), API plumbing
// – Removes all writing/reflect/TinyMCE logic
// – Focuses solely on detecting and answering Multiple-Choice questions
(function () {
  try { console.clear(); } catch (e) {}
  if (document.getElementById('Launcher')) return;

  class AssessmentHelperMCQ {
    constructor() {
      // public-ish
      window.__AssessmentHelperInstance = this;

      // state
      this.isRunning = false;
      this.answerIsDragging = false;
      this.answerInitialX = 0;
      this.answerInitialY = 0;
      this.currentAbortController = null;
      this.cachedContext = '';
      this.eyeState = 'sleep';
      this.currentVideo = null;
      this._apiCallCounter = 0;

      // assets
      this.assetBase = 'https://raw.githubusercontent.com/ARDARYUS/a3kbookmarklet/main/icons/';
      this.animeScriptUrl = 'https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js';
      this.draggabillyScriptUrl = 'https://unpkg.com/draggabilly@3/dist/draggabilly.pkgd.min.js';

      // settings
      this.settingsKeys = {
        mc_wait: 'ah_mc_wait_ms',
        mc_random_pct: 'ah_mc_random_pct',
        ai_use_api: 'ah_ai_use_api',
        ai_groq_url: 'ah_ai_groq_url',
        ai_groq_key: 'ah_ai_groq_key',
        ai_groq_model: 'ah_ai_groq_model',
        cloudflare_ask: 'ah_cloudflare_ask'
      };
      this.defaults = { mc_wait: 350, mc_random_pct: 0 };
      this.settingsState = 'closed';
      this._eyeOriginal = null;

      // boot
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.init());
      } else {
        this.init();
      }
    }

    // --------------- utils ---------------
    getUrl(path) {
      if (!path) return '';
      if (/^https?:\/\//i.test(path)) return path;
      if (path.indexOf('icons/') === 0) return this.assetBase + path.substring('icons/'.length);
      return this.assetBase + path;
    }
    createEl(tag, props = {}) {
      const el = document.createElement(tag);
      Object.keys(props).forEach((k) => {
        if (k === 'style') el.style.cssText = props.style;
        else if (k === 'dataset') Object.assign(el.dataset, props.dataset);
        else if (k === 'children') props.children.forEach((c) => el.appendChild(c));
        else if (k === 'text') el.textContent = props.text;
        else if (k === 'innerHTML') el.innerHTML = props.innerHTML;
        else el[k] = props[k];
      });
      return el;
    }
    applyStylesOnce(id, cssText) {
      if (!document.getElementById(id)) {
        const style = document.createElement('style');
        style.id = id;
        style.textContent = cssText;
        document.head.appendChild(style);
      }
    }
    async loadScript(url) {
      return new Promise((resolve, reject) => {
        const existing = Array.from(document.getElementsByTagName('script')).find(s => s.src && s.src.indexOf(url) !== -1);
        if (existing) return resolve();
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => resolve();
        script.onerror = () => { try { script.remove(); } catch(e){} reject(new Error('Failed to load ' + url)); };
        document.head.appendChild(script);
      });
    }
    saveSetting(key, value) { try { localStorage.setItem(key, String(value)); } catch (e) {} }
    loadSetting(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        if (v === null || v === undefined) return fallback;
        return v;
      } catch (e) { return fallback; }
    }
    getMCWait() { return Number(this.loadSetting(this.settingsKeys.mc_wait, this.defaults.mc_wait)); }
    getMCRandomPct() { return Number(this.loadSetting(this.settingsKeys.mc_random_pct, this.defaults.mc_random_pct)); }
    resetMCWait() { this.saveSetting(this.settingsKeys.mc_wait, this.defaults.mc_wait); }
    resetMCRandom() { this.saveSetting(this.settingsKeys.mc_random_pct, this.defaults.mc_random_pct); }

    // --------------- init / UI ---------------
    async init() {
      try { await this.loadScript(this.animeScriptUrl); } catch(e){}
      try { await this.loadScript(this.draggabillyScriptUrl); } catch(e){}
      this.itemMetadata = {
        UI: this.createUI(),
        answerUI: this.createAnswerUI(),
      };
      try { this.playIntroAnimation(); } catch(e){ this.showUI(true); }
    }
    createUI() {
      const container = this.createEl('div');
      const launcher = this.createEl('div', {
        id: 'Launcher',
        className: 'Launcher',
        style: "min-height:160px;opacity:0;visibility:hidden;transition:opacity .25s ease,width .25s ease;font-family:'Nunito',sans-serif;width:180px;height:240px;background:#010203;position:fixed;border-radius:12px;border:2px solid #0a0b0f;display:flex;flex-direction:column;align-items:center;color:white;font-size:16px;top:50%;left:20px;transform:translateY(-50%);z-index:99999;padding:16px;box-shadow:0 10px 8px rgba(0,0,0,.2),0 0 8px rgba(255,255,255,.05);overflow:hidden;white-space:nowrap;"
      });
      const dragHandle = this.createEl('div', { className: 'drag-handle', style: 'width:100%;height:24px;cursor:move;background:transparent;position:absolute;top:0;' });
      const eyeWrapper = this.createEl('div', {
        id: 'helperEye',
        style: 'width:90px;height:90px;margin-top:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;transform-origin:50% 40%;pointer-events:none;'
      });
      const uiImg = this.createEl('img', {
        id: 'helperEyeImg',
        src: this.getUrl('icons/sleep.gif'),
        dataset: { idle: this.getUrl('icons/idle.gif'), tilt: this.getUrl('icons/full.gif') },
        style: 'width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;'
      });
      const uiVideo = this.createEl('video', {
        id: 'helperEyeVideo',
        style: 'width:100%;height:100%;object-fit:cover;display:none;pointer-events:none;',
        autoplay: false, loop: false, muted: true, playsInline: true, preload: 'auto'
      });
      eyeWrapper.appendChild(uiImg); eyeWrapper.appendChild(uiVideo);

      const closeButton = this.createEl('button', {
        id: 'closeButton', text: '\u00D7',
        style: 'position:absolute;top:8px;right:8px;background:none;border:none;color:white;font-size:18px;cursor:pointer;padding:2px 8px;opacity:.5;z-index:100005;'
      });
      const getAnswerButton = this.createEl('button', {
        id: 'getAnswerButton',
        style: 'background:#151515;border:1px solid rgba(255,255,255,0.04);color:white;padding:10px 12px;border-radius:8px;cursor:pointer;margin-top:18px;width:140px;height:64px;font-size:14px;transition:background .14s ease,transform .08s ease,box-shadow .12s;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;'
      });
      const spinner = this.createEl('div', {
        id: 'ah-spinner',
        style: 'width:22px;height:22px;border-radius:50%;border:3px solid rgba(255,255,255,0.12);border-top-color:#ffffff;display:none;animation:ah-spin .85s cubic-bezier(.4,0,.2,1) infinite;'
      });
      const buttonTextSpan = this.createEl('span', { text: 'work smArt-er', id: 'getAnswerButtonText', style: 'font-size:14px;line-height:1;user-select:none;' });
      getAnswerButton.appendChild(spinner); getAnswerButton.appendChild(buttonTextSpan);

      const version = this.createEl('div', { id: 'ah-version', style: 'position:absolute;bottom:8px;right:8px;font-size:12px;opacity:.9;z-index:100005', text: 'MCQ' });
      const settingsCog = this.createEl('button', {
        id: 'settingsCog', title: 'Settings', innerHTML: '⚙',
        style: 'position:absolute;bottom:8px;left:8px;background:none;border:none;color:#cfcfcf;font-size:16px;cursor:pointer;opacity:.85;padding:2px;z-index:100005'
      });
      const settingsBack = this.createEl('button', {
        id: 'settingsBack', title: 'Back', innerHTML: '⟵',
        style: 'position:absolute;bottom:8px;left:8px;background:none;border:none;color:#ff4d4d;font-size:18px;cursor:pointer;opacity:0;display:none;padding:2px;z-index:100005'
      });
      const settingsPanel = this.createEl('div', {
        id: 'settingsPanel',
        style: 'position:absolute;top:48px;left:12px;right:12px;bottom:48px;display:none;flex-direction:column;align-items:flex-start;gap:8px;overflow:auto;'
      });

      launcher.appendChild(dragHandle);
      launcher.appendChild(eyeWrapper);
      launcher.appendChild(closeButton);
      launcher.appendChild(getAnswerButton);
      launcher.appendChild(version);
      launcher.appendChild(settingsCog);
      launcher.appendChild(settingsBack);
      launcher.appendChild(settingsPanel);
      container.appendChild(launcher);

      this.applyStylesOnce('assessment-helper-spinner-styles', `
        @keyframes ah-spin { 0% { transform: rotate(0deg);} 100%{transform: rotate(360deg);} }
        #getAnswerButton.running { background:#1e1e1e; box-shadow:0 4px 12px rgba(0,0,0,0.35); }
        #getAnswerButton.running span { font-size:12px; opacity:.95; }
        #settingsPanel input[type="number"] { width:80px;padding:4px;border-radius:6px;border:1px solid rgba(255,255,255,.08);background:transparent;color:white; }
        #settingsPanel label { font-size:13px;margin-right:6px; }
        .ah-reset { cursor:pointer;margin-left:8px;opacity:.8;font-size:14px;user-select:none; }
        .ah-section-title { font-weight:700;margin-top:4px;margin-bottom:6px;font-size:14px; }
        #settingsPanel button { transition: background .12s ease, transform .08s ease; }
        #settingsPanel button:hover { background:#222; transform: translateY(-1px); }
        #getAnswerButton:hover { background:#1f1f1f !important; transform: translateY(-1px); }
      `);
      return container;
    }
    createAnswerUI() {
      const container = this.createEl('div');
      const answerContainer = this.createEl('div', {
        id: 'answerContainer', className: 'answerLauncher',
        style: "outline:none;min-height:60px;transform:translateX(0px) translateY(-50%);opacity:0;visibility:hidden;transition:opacity .3s ease, transform .3s ease;font-family:'Nunito',sans-serif;width:60px;height:60px;background:#1c1e2b;position:fixed;border-radius:8px;display:flex;justify-content:center;align-items:center;color:white;font-size:24px;top:50%;right:220px;z-index:99998;padding:8px;box-shadow:0 4px 8px rgba(0,0,0,0.2);overflow:hidden;white-space:normal;"
      });
      const dragHandle = this.createEl('div', { className:'answer-drag-handle', style:'width:100%;height:24px;cursor:move;background:transparent;position:absolute;top:0;' });
      const closeButton = this.createEl('button', { id:'closeAnswerButton', style:'position:absolute;top:8px;right:8px;background:none;border:none;color:white;font-size:18px;cursor:pointer;padding:2px 8px;' });
      const answerContent = this.createEl('div', { id:'answerContent', style:'padding:0;margin:0;word-wrap:break-word;font-size:24px;font-weight:bold;display:flex;justify-content:center;align-items:center;width:100%;height:100%;' });
      answerContainer.appendChild(dragHandle); answerContainer.appendChild(closeButton); answerContainer.appendChild(answerContent);
      container.appendChild(answerContainer);
      return container;
    }
    playIntroAnimation() {
      if (typeof anime === 'undefined') { this.showUI(); return; }
      const imageUrl = this.getUrl('icons/eyebackground.gif');
      const introImgElement = this.createEl('img', { src:imageUrl, id:'introLoaderImage',
        style:'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(.5);width:100px;height:auto;border-radius:12px;box-shadow:0 4px 8px rgba(0,0,0,.2);z-index:100001;opacity:0;'
      });
      document.body.appendChild(introImgElement);
      anime.timeline({ easing:'easeInOutQuad', duration:800, complete:()=>{ try{introImgElement.remove();}catch(e){} this.showUI(); } })
        .add({ targets:introImgElement, opacity:[0,1], scale:[.5,1], rotate:'1turn', duration:1000, easing:'easeOutExpo' })
        .add({ targets:introImgElement, translateY:'-=20', duration:500, easing:'easeInOutSine' })
        .add({ targets:introImgElement, translateY:'+=20', duration:500, easing:'easeInOutSine' })
        .add({ targets:introImgElement, opacity:0, duration:500, easing:'linear' }, '+=500');
    }
    showUI(skipAnimation=false) {
      try { document.body.appendChild(this.itemMetadata.UI); document.body.appendChild(this.itemMetadata.answerUI); } catch(e){}
      const launcher = document.getElementById('Launcher');
      if (!launcher) { this.setupEventListeners(); return; }
      launcher.style.visibility = 'visible';
      if (skipAnimation) { launcher.style.opacity = 1; this.setupEventListeners(); }
      else { setTimeout(()=> (launcher.style.opacity = 1), 10); setTimeout(()=> this.setupEventListeners(), 200); }
    }

    // --------------- eye ---------------
    setEyeToSleep() {
      if (this.eyeState === 'full') return;
      try {
        this.clearCurrentVideo();
        const img = document.getElementById('helperEyeImg');
        const video = document.getElementById('helperEyeVideo');
        if (!img || !video) return;
        video.style.display = 'none'; img.style.display = 'block';
        img.src = this.getUrl('icons/sleep.gif'); this.eyeState='sleep'; img.style.opacity='1';
      } catch(e){}
    }
    setEyeToFull() {
      try {
        this.eyeState='full'; this.clearCurrentVideo();
        const img = document.getElementById('helperEyeImg');
        const video = document.getElementById('helperEyeVideo');
        if (!img || !video) return;
        video.style.display='none'; img.style.display='block';
        img.src = this.getUrl('icons/full.gif') + '?r=' + Date.now();
      } catch(e){}
    }
    async handleHoverEnter() {
      if (this.eyeState === 'full') return;
      try { await this.playVideoOnce(this.getUrl('icons/wakeup.webm'));
        if (this.eyeState === 'full') return;
        const img = document.getElementById('helperEyeImg');
        const video = document.getElementById('helperEyeVideo');
        if (!img || !video) return;
        video.style.display='none'; img.style.display='block';
        img.src = this.getUrl('icons/idle.gif') + '?r=' + Date.now(); this.eyeState='idle';
      } catch(e){}
    }
    async handleHoverLeave() {
      if (this.eyeState === 'full') return;
      try { await this.playVideoOnce(this.getUrl('icons/gotosleep.webm')); if (this.eyeState === 'full') return; this.setEyeToSleep(); } catch(e){}
    }
    playVideoOnce(src) {
      return new Promise((resolve)=>{
        try {
          const video = document.getElementById('helperEyeVideo');
          const img = document.getElementById('helperEyeImg');
          if (!video || !img) { resolve(); return; }
          this.clearCurrentVideo();
          video.src=src; video.loop=false; video.muted=true; video.playsInline=true; video.preload='auto';
          video.style.display='block'; img.style.display='none'; this.currentVideo=video;
          const onEnded=()=>{ if(this.currentVideo===video) this.currentVideo=null; video.removeEventListener('ended',onEnded); video.removeEventListener('error',onError); setTimeout(()=>resolve(),8); };
          const onError=()=>{ if(this.currentVideo===video) this.currentVideo=null; video.removeEventListener('error',onError); video.removeEventListener('ended',onEnded); resolve(); };
          video.addEventListener('ended',onEnded); video.addEventListener('error',onError);
          const playPromise = video.play(); if (playPromise && typeof playPromise.then==='function') playPromise.catch(()=>{ video.removeEventListener('ended',onEnded); video.removeEventListener('error',onError); this.currentVideo=null; setTimeout(()=>resolve(),250); });
        } catch(e){ resolve(); }
      });
    }
    clearCurrentVideo() {
      try {
        const video = document.getElementById('helperEyeVideo');
        const img = document.getElementById('helperEyeImg');
        if (!video || !img) return;
        try { if (!video.paused) video.pause(); } catch(e){}
        try { video.removeAttribute('src'); video.load(); } catch(e){}
        video.style.display='none'; img.style.display='block'; this.currentVideo=null;
      } catch(e){}
    }

    // --------------- UI state ---------------
    async startProcessUI() {
      const btn = document.getElementById('getAnswerButton');
      const spinner = document.getElementById('ah-spinner');
      const label = document.getElementById('getAnswerButtonText');
      if (btn) btn.classList.add('running');
      if (spinner) spinner.style.display = 'block';
      if (label) label.textContent = 'stop.';
    }
    async stopProcessUI() {
      const btn = document.getElementById('getAnswerButton');
      const spinner = document.getElementById('ah-spinner');
      const label = document.getElementById('getAnswerButtonText');
      if (btn) btn.classList.remove('running');
      if (spinner) spinner.style.display = 'none';
      if (label) label.textContent = 'work smArt-er';
      try { await this.playVideoOnce(this.getUrl('icons/gotosleep.webm')); } catch(e){}
      this.setEyeToSleep();
    }
    stopProcessImmediate() {
      this.isRunning = false;
      if (this.currentAbortController) {
        try { this.currentAbortController.abort(); } catch(e){}
        this.currentAbortController = null;
      }
    }

    // --------------- settings (MC only) ---------------
    _computeExpandRight() {
      const launcher = document.getElementById('Launcher');
      if (!launcher) return true;
      const rect = launcher.getBoundingClientRect();
      const distanceToLeft = rect.left;
      const distanceToRight = window.innerWidth - rect.right;
      return distanceToLeft <= distanceToRight;
    }
    _setLauncherWidthAndAnchor(widthPx, expandRight) {
      const launcher = document.getElementById('Launcher');
      if (!launcher) return;
      const rect = launcher.getBoundingClientRect();
      if (expandRight) { launcher.style.left = `${rect.left}px`; launcher.style.right='auto'; launcher.style.width = `${widthPx}px`; }
      else { const rightCss = Math.round(window.innerWidth - rect.right); launcher.style.right = `${rightCss}px`; launcher.style.left='auto'; launcher.style.width = `${widthPx}px`; }
    }
    _shrinkEyeToTopRight() {
      const eye = document.getElementById('helperEye');
      if (!eye) return;
      if (!this._eyeOriginal) { this._eyeOriginal = { style: eye.getAttribute('style') || '' }; }
      eye.style.display='flex'; eye.style.position='absolute'; eye.style.top='12px'; eye.style.right='44px'; eye.style.width='48px'; eye.style.height='48px'; eye.style.marginTop='0'; eye.style.zIndex='100004';
      const img = document.getElementById('helperEyeImg'); if (img) img.style.width='100%';
    }
    _restoreEyeFromShrink() {
      const eye = document.getElementById('helperEye'); if (!eye) return;
      if (this._eyeOriginal) { eye.setAttribute('style', this._eyeOriginal.style); this._eyeOriginal = null; }
      else { eye.style.position=''; eye.style.top=''; eye.style.right=''; eye.style.width='90px'; eye.style.height='90px'; eye.style.marginTop='32px'; eye.style.zIndex=''; const img = document.getElementById('helperEyeImg'); if (img) img.style.width='100%'; }
    }
    buildSettingsMenu() {
      const panel = document.getElementById('settingsPanel'); if (!panel) return;
      panel.innerHTML='';
      const title = this.createEl('div', { className:'ah-section-title', text:'Settings' });
      panel.appendChild(title);

      const mcBtn = this.createEl('button', { id:'mcSettingsBtn', text:'Multiple Choice Settings',
        style:'padding:10px 12px;border-radius:8px;background:#151515;border:1px solid rgba(255,255,255,.04);color:white;cursor:pointer;' });
      const aiBtn = this.createEl('button', { id:'aiSettingsBtn', text:'AI Settings',
        style:'padding:10px 12px;border-radius:8px;background:#151515;border:1px solid rgba(255,255,255,.04);color:white;cursor:pointer;' });
      panel.appendChild(mcBtn); panel.appendChild(aiBtn);
      mcBtn.addEventListener('click', (e)=>{ e.preventDefault(); this.openMCSettings(); });
      aiBtn.addEventListener('click', (e)=>{ e.preventDefault(); this.openAISettings(); });
    }
    openSettingsMenu() {
      const btn = document.getElementById('getAnswerButton');
      const expandRight = this._computeExpandRight();
      this._setLauncherWidthAndAnchor(360, expandRight);
      this._shrinkEyeToTopRight();
      if (btn) { btn.style.transition='opacity .12s'; btn.style.opacity='0'; setTimeout(()=> btn.style.display='none', 140); }
      const panel = document.getElementById('settingsPanel'); if (panel) { panel.style.display='flex'; panel.style.opacity='1'; }
      const settingsCog = document.getElementById('settingsCog'); const settingsBack = document.getElementById('settingsBack');
      if (settingsCog) settingsCog.style.display='none';
      if (settingsBack) { settingsBack.style.display='block'; settingsBack.style.opacity='1'; }
      this.settingsState='menu';
      this.buildSettingsMenu();
    }
    openMCSettings() {
      const panel = document.getElementById('settingsPanel'); if (!panel) return;
      const expandRight = this._computeExpandRight(); this._setLauncherWidthAndAnchor(520, expandRight);
      panel.innerHTML=''; this.settingsState='mc';
      const title = this.createEl('div', { className:'ah-section-title', text:'Multiple Choice Settings' }); panel.appendChild(title);
      const waitRow = this.createEl('div', { style:'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
      const waitLabel = this.createEl('label', { text:'Wait time (ms):', style:'min-width:120px;' });
      const waitInput = this.createEl('input', { type:'number', id:'mcWaitInput', value:String(this.getMCWait()) });
      const waitReset = this.createEl('span', { className:'ah-reset', text:'↺', title:'Reset to default' });
      waitReset.addEventListener('click', ()=>{ this.resetMCWait(); waitInput.value = String(this.getMCWait()); });
      waitInput.addEventListener('change', ()=>{ const v = Number(waitInput.value) || this.defaults.mc_wait; this.saveSetting(this.settingsKeys.mc_wait, v); });
      waitRow.appendChild(waitLabel); waitRow.appendChild(waitInput); waitRow.appendChild(waitReset); panel.appendChild(waitRow);

      const probRow = this.createEl('div', { style:'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
      const probLabel = this.createEl('label', { text:'Random answer %:', style:'min-width:120px;' });
      const probInput = this.createEl('input', { type:'number', id:'mcRandomInput', value:String(this.getMCRandomPct()), min:0, max:100 });
      const probReset = this.createEl('span', { className:'ah-reset', text:'↺', title:'Reset to default' });
      probReset.addEventListener('click', ()=>{ this.resetMCRandom(); probInput.value = String(this.getMCRandomPct()); });
      probInput.addEventListener('change', ()=>{
        let v = Number(probInput.value); if (!Number.isFinite(v) || v < 0) v = 0; if (v>100) v=100; this.saveSetting(this.settingsKeys.mc_random_pct, v); probInput.value = String(v);
      });
      probRow.appendChild(probLabel); probRow.appendChild(probInput); probRow.appendChild(probReset); panel.appendChild(probRow);

      const note = this.createEl('div', { text:'Tip: set random % to >0 for occasional wrong answers to mimic humans.', style:'font-size:12px;opacity:.8;margin-top:8px;' });
      panel.appendChild(note);
    }
    openAISettings() {
      const panel = document.getElementById('settingsPanel'); if (!panel) return;
      const expandRight = this._computeExpandRight(); this._setLauncherWidthAndAnchor(520, expandRight);
      panel.innerHTML=''; this.settingsState='ai';
      const title = this.createEl('div', { className:'ah-section-title', text:'AI Settings' }); panel.appendChild(title);

      const methodRow = this.createEl('div', { style:'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
      const methodLabel = this.createEl('label', { text:'Use direct API (toggle):', style:'min-width:160px;' });
      const methodToggle = this.createEl('input', { type:'checkbox', id:'aiUseApiToggle' });
      const useApiStored = localStorage.getItem(this.settingsKeys.ai_use_api);
      methodToggle.checked = (useApiStored === 'true');
      methodRow.appendChild(methodLabel); methodRow.appendChild(methodToggle); panel.appendChild(methodRow);

      const urlRow = this.createEl('div', { style:'display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%;' });
      const urlLabel = this.createEl('label', { text:'Groq URL:', style:'min-width:160px;' });
      const urlInput = this.createEl('input', { type:'text', id:'aiGroqUrlInput', value: localStorage.getItem(this.settingsKeys.ai_groq_url) || 'https://api.groq.com/openai/v1/chat/completions', style:'flex:1;' });
      const urlReset = this.createEl('span', { className:'ah-reset', text:'↺', title:'Reset to default' });
      urlReset.addEventListener('click', ()=>{ urlInput.value='https://api.groq.com/openai/v1/chat/completions'; this.saveSetting(this.settingsKeys.ai_groq_url, urlInput.value); });
      urlRow.appendChild(urlLabel); urlRow.appendChild(urlInput); urlRow.appendChild(urlReset); panel.appendChild(urlRow);

      const modelRow = this.createEl('div', { style:'display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%;' });
      const modelLabel = this.createEl('label', { text:'Model:', style:'min-width:160px;' });
      const modelInput = this.createEl('input', { type:'text', id:'aiGroqModelInput', value: localStorage.getItem(this.settingsKeys.ai_groq_model) || 'llama-3.1-8b-instant', style:'flex:1;' });
      modelRow.appendChild(modelLabel); modelRow.appendChild(modelInput); panel.appendChild(modelRow);

      const cfAskRow = this.createEl('div', { style:'display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%;' });
      const cfAskLabel = this.createEl('label', { text:'Cloudflare /ask URL:', style:'min-width:160px;' });
      const cfAskInput = this.createEl('input', { type:'text', value: localStorage.getItem(this.settingsKeys.cloudflare_ask) || '', placeholder:'https://your-cloudflare-host/ask', style:'flex:1;padding:6px;border:1px solid #ccc;border-radius:4px;' });
      const cfAskReset = this.createEl('span', { className:'ah-reset', text:'↺', title:'Reset' });
      cfAskReset.addEventListener('click', ()=>{ cfAskInput.value=''; this.saveSetting(this.settingsKeys.cloudflare_ask,''); localStorage.removeItem(this.settingsKeys.cloudflare_ask); });
      cfAskInput.addEventListener('change', ()=> this.saveSetting(this.settingsKeys.cloudflare_ask, cfAskInput.value || ''));
      cfAskRow.appendChild(cfAskLabel); cfAskRow.appendChild(cfAskInput); cfAskRow.appendChild(cfAskReset); panel.appendChild(cfAskRow);

      // persistors
      methodToggle.addEventListener('change', ()=> this.saveSetting(this.settingsKeys.ai_use_api, methodToggle.checked ? 'true':'false'));
      urlInput.addEventListener('change', ()=> this.saveSetting(this.settingsKeys.ai_groq_url, urlInput.value || ''));
      modelInput.addEventListener('change', ()=> this.saveSetting(this.settingsKeys.ai_groq_model, modelInput.value || 'llama-3.1-8b-instant'));
    }
    backFromSettings() {
      const launcher = document.getElementById('Launcher');
      const btn = document.getElementById('getAnswerButton');
      const settingsPanel = document.getElementById('settingsPanel');
      const settingsCog = document.getElementById('settingsCog');
      const settingsBack = document.getElementById('settingsBack');

      if (this.settingsState === 'mc' || this.settingsState === 'ai') {
        const expandRight = this._computeExpandRight();
        this._setLauncherWidthAndAnchor(360, expandRight);
        this.settingsState='menu'; this.buildSettingsMenu(); return;
      }

      if (this.settingsState === 'menu') {
        if (settingsPanel) { settingsPanel.style.display='none'; settingsPanel.innerHTML=''; }
        if (btn) { btn.style.display='flex'; setTimeout(()=> btn.style.opacity='1', 10); }
        if (settingsBack) { settingsBack.style.opacity = '0'; setTimeout(()=> settingsBack.style.display='none', 120); }
        if (settingsCog) settingsCog.style.display='block';
        const expandRight = this._computeExpandRight(); this._setLauncherWidthAndAnchor(180, expandRight);
        this._restoreEyeFromShrink();
        this.settingsState = 'closed';
        return;
      }
    }

    // --------------- core solver ---------------
    async runSolverLoop() {
      try {
        while (this.isRunning) {
          const block = this.detectCurrentMCQ();
          if (!block) {
            await this.sleep(800);
            continue;
          }
          const { question, options, inputs } = block;

          const randomPct = this.getMCRandomPct();
          let chosenIndex = -1;
          if (randomPct > 0 && Math.random()*100 < randomPct) {
            chosenIndex = Math.floor(Math.random()*options.length);
          } else {
            const choice = await this.askLLMForChoice(question, options).catch(()=>null);
            chosenIndex = this.parseChoiceIndex(choice, options.length);
            if (chosenIndex < 0) chosenIndex = 0; // safe fallback
          }

          // click the answer
          await this.sleep(this.getMCWait());
          try {
            const input = inputs[chosenIndex];
            if (input) {
              input.click();
              // also click label if exists to ensure UI reacts
              const lbl = this.findLabelForInput(input);
              if (lbl) lbl.click();
            }
          } catch(e){}

          // show in badge
          this.showAnswerBubble(options[chosenIndex] ? options[chosenIndex] : '...');

          // stop after one question per click; user can click again
          this.isRunning = false;
          await this.stopProcessUI();
        }
      } catch (e) {
        this.isRunning = false;
        await this.stopProcessUI();
      }
    }
    detectCurrentMCQ() {
      // Strategy: look for a visible question block with multiple radio/checkbox inputs.
      // Extract the stem text and each option text.
      const allInputs = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]'))
        .filter(inp => this.isVisible(inp));
      if (allInputs.length === 0) return null;

      // group by nearest question container (heuristic: nearest form/fieldset/article/section/div with multiple inputs)
      let container = this.closestWithMany(allInputs[0], ['fieldset','form','article','section','div']);
      if (!container) container = document.body;

      const inputs = Array.from(container.querySelectorAll('input[type="radio"], input[type="checkbox"]'))
        .filter(inp => this.isVisible(inp));
      if (inputs.length < 2) return null;

      // question text heuristic: look for elements with possible question stem ids/classes or preceding headers
      const questionText = this.extractQuestionText(container);

      // options
      const options = inputs.map(inp => this.extractOptionText(inp)).map(t => (t || '').trim()).map(t => t.replace(/\s+/g,' '));
      const filtered = options.map((t, i) => ({ t, i })).filter(o => o.t && o.t.length > 0);
      if (filtered.length < 2) return null;

      // align inputs to filtered order
      const alignedInputs = filtered.map(o => inputs[o.i]);
      return { question: questionText || 'Choose the best option:', options: filtered.map(o=>o.t), inputs: alignedInputs };
    }
    isVisible(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width >= 1 && rect.height >= 1 && style.visibility !== 'hidden' && style.display !== 'none';
    }
    closestWithMany(el, tags) {
      let cur = el;
      while (cur && cur !== document.body) {
        const radios = cur.querySelectorAll('input[type="radio"], input[type="checkbox"]');
        if (radios.length >= 2 && tags.includes(cur.tagName.toLowerCase())) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    extractQuestionText(container) {
      // try common selectors
      const candidates = [
        '#question-text', '.question-text', 'h1', 'h2', 'h3',
        '[data-question-stem]', '.prompt', '.stem', '.qtext'
      ].map(sel => Array.from(container.querySelectorAll(sel))).flat().filter(n => this.isVisible(n));
      const picked = candidates.find(n => (n.textContent || '').trim().length > 10);
      if (picked) return picked.textContent.trim();
      // fallback: first paragraph
      const p = Array.from(container.querySelectorAll('p')).find(x => this.isVisible(x) && (x.textContent||'').trim().length > 10);
      return p ? p.textContent.trim() : '';
    }
    extractOptionText(inputEl) {
      // prefer label[for=id]
      const lbl = this.findLabelForInput(inputEl);
      if (lbl) return lbl.textContent || '';
      // try parent text
      const p = inputEl.closest('label, li, div');
      if (p) return p.textContent || '';
      // last resort: sibling text node
      const sib = inputEl.nextSibling;
      if (sib && sib.nodeType === Node.TEXT_NODE) return String(sib.nodeValue || '');
      return '';
    }
    findLabelForInput(inputEl) {
      if (!inputEl) return null;
      const id = inputEl.id;
      if (id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lbl) return lbl;
      }
      // wrapped label
      let cur = inputEl;
      while (cur) {
        if (cur.tagName && cur.tagName.toLowerCase() === 'label') return cur;
        cur = cur.parentElement;
      }
      return null;
    }

    // --------------- LLM ---------------
    async askLLMForChoice(question, options) {
      const useDirectApi = (this.loadSetting(this.settingsKeys.ai_use_api, 'false') === 'true');
      const prompt = this.buildPrompt(question, options);
      const articleContext = this.grabContextNearby();

      if (useDirectApi) {
        const url = this.loadSetting(this.settingsKeys.ai_groq_url, 'https://api.groq.com/openai/v1/chat/completions');
        const model = this.loadSetting(this.settingsKeys.ai_groq_model, 'llama-3.1-8b-instant');
        const keys = this.loadKeysArray();
        this._apiCallCounter = (this._apiCallCounter || 0) + 1;
        const idx = Math.floor((this._apiCallCounter - 1)/2) % Math.max(1, keys.length);
        const key = (keys[idx] || '').trim();

        this.currentAbortController = new AbortController();
        const signal = this.currentAbortController.signal;
        const payload = { model, messages: [{ role:'user', content: prompt + (articleContext ? `\n\nContext:\n${articleContext}` : '') }], max_tokens: 256 };
        let response = await fetch(url, {
          method:'POST',
          headers: { 'Accept':'application/json', 'Content-Type':'application/json', ...(key ? { 'Authorization':'Bearer '+key } : {}) },
          body: JSON.stringify(payload), signal
        });
        this.currentAbortController = null;
        if (!response.ok) throw new Error('LLM HTTP '+response.status);
        const data = await response.json();
        const content = (data && data.choices && data.choices[0] && (data.choices[0].message?.content || data.choices[0].text)) || '';
        return String(content || '').trim();
      } else {
        const cfAskUrl = this.loadSetting(this.settingsKeys.cloudflare_ask, '');
        if (!cfAskUrl) throw new Error('Cloudflare /ask endpoint not configured');
        this.currentAbortController = new AbortController();
        const signal = this.currentAbortController.signal;
        const body = { q: prompt, article: articleContext || null };
        const response = await fetch(cfAskUrl, { method:'POST', headers:{'Accept':'application/json','Content-Type':'application/json'}, body: JSON.stringify(body), signal });
        this.currentAbortController = null;
        if (!response.ok) throw new Error('Proxy HTTP '+response.status);
        const data = await response.json();
        return String(data.response || data.answer || data.result || '').trim();
      }
    }
    loadKeysArray() {
      try {
        const raw = localStorage.getItem('ah_ai_groq_keys') || '[]';
        const arr = JSON.parse(raw);
        const legacy = this.loadSetting(this.settingsKeys.ai_groq_key, '');
        const a = Array.isArray(arr) ? arr : [];
        if (a.length === 0 && legacy) return [legacy];
        return a;
      } catch(e){ return []; }
    }
    buildPrompt(question, options) {
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').slice(0, options.length);
      const lines = options.map((opt,i)=> `${letters[i]}. ${opt}`);
      return [
        'You are an expert test-taker. Read the question and options and return ONLY the letter of the best choice.',
        'Format: A / B / C / D (one letter, no explanation).',
        '',
        'Question: ' + question,
        'Options:',
        ...lines,
      ].join('\n');
    }
    parseChoiceIndex(llmText, n) {
      if (!llmText) return -1;
      const m = llmText.trim().toUpperCase().match(/\b([A-Z])\b/);
      if (!m) return -1;
      const ch = m[1].charCodeAt(0) - 65;
      if (ch >= 0 && ch < n) return ch;
      return -1;
    }
    grabContextNearby() {
      // Get nearby article-like text for better answers (no writing/reflect handling)
      try {
        const roots = ['#start-reading', 'article', '.passage', '.text'];
        let content = '';
        for (const sel of roots) {
          const el = document.querySelector(sel);
          if (el) {
            const ps = el.querySelectorAll('p,li');
            content = Array.from(ps).map(p=> (p.textContent||'').trim()).join(' ').trim();
            if (content.length > 120) break;
          }
        }
        this.cachedContext = content || '';
        return this.cachedContext;
      } catch(e){ return ''; }
    }

    // --------------- helpers ---------------
    sleep(ms){ return new Promise(r=> setTimeout(r, ms)); }
    showAnswerBubble(text) {
      try {
        const ac = document.getElementById('answerContainer');
        const content = document.getElementById('answerContent');
        if (!ac || !content) return;
        content.textContent = text;
        ac.style.display = 'flex';
        ac.style.visibility = 'visible';
        ac.style.opacity = 1;
        ac.style.transform = 'translateY(-50%) scale(1)';
      } catch(e){}
    }

    // --------------- events ---------------
    setupEventListeners() {
      const launcher = document.getElementById('Launcher');
      const answerContainer = document.getElementById('answerContainer');
      const getAnswerButton = launcher ? launcher.querySelector('#getAnswerButton') : null;
      if (!launcher || !answerContainer || !getAnswerButton) return;

      const closeButton = launcher.querySelector('#closeButton');
      const closeAnswerButton = answerContainer.querySelector('#closeAnswerButton');
      this.applyStylesOnce('assessment-helper-styles', `
        #closeButton:hover, #closeAnswerButton:hover { color:#ff6b6b; opacity:1 !important; }
        #closeButton:active, #closeAnswerButton:active { color:#e05252; transform: scale(.95); }
        #getAnswerButton { position:relative; z-index:100001; transition: background .2s ease, transform .1s ease; }
        #getAnswerButton:hover { background:#1f1f1f !important; }
        #getAnswerButton:active { background:#4c4e5b !important; transform: scale(.98); }
        #getAnswerButton:disabled { opacity:.6; cursor:not-allowed; }
        .answerLauncher.show { opacity:1; visibility:visible; transform: translateY(-50%) scale(1); }
      `);

      if (typeof Draggabilly !== 'undefined') {
        try { new Draggabilly(launcher, { handle: '.drag-handle', delay: 50 }); } catch(e){}
      }
      const answerDragHandle = answerContainer.querySelector('.answer-drag-handle');
      if (answerDragHandle) {
        answerDragHandle.addEventListener('mousedown', (e)=>{
          e.preventDefault(); this.answerIsDragging = true;
          const rect = answerContainer.getBoundingClientRect();
          this.answerInitialX = e.clientX - rect.left;
          this.answerInitialY = e.clientY - rect.top;
          answerContainer.style.position = 'fixed';
        });
      }
      const stopDrag = ()=> this.answerIsDragging = false;
      document.addEventListener('mousemove', (e)=>{
        if (this.answerIsDragging && answerContainer) {
          e.preventDefault();
          const newX = e.clientX - this.answerInitialX;
          const newY = e.clientY - this.answerInitialY;
          answerContainer.style.left = `${newX}px`;
          answerContainer.style.top = `${newY}px`;
          answerContainer.style.right = '';
          answerContainer.style.bottom = '';
          answerContainer.style.transform = 'none';
        }
      });
      document.addEventListener('mouseup', stopDrag);
      document.addEventListener('mouseleave', stopDrag);

      if (closeButton) {
        closeButton.addEventListener('click', ()=>{
          try { if (window.__AssessmentHelperInstance) window.__AssessmentHelperInstance.stopProcessImmediate(); } catch(e){}
          launcher.style.opacity = 0;
          launcher.addEventListener('transitionend', function handler() {
            try {
              const launcherEl = document.getElementById('Launcher'); if (launcherEl && launcherEl.parentElement) launcherEl.parentElement.remove();
              const answerEl = document.getElementById('answerContainer'); if (answerEl && answerEl.parentElement) answerEl.parentElement.remove();
              try { window.__AssessmentHelperInstance = null; } catch(e){}
            } catch(e){}
            launcher.removeEventListener('transitionend', handler);
          }, { once: true });
        });
        closeButton.addEventListener('mousedown', ()=> (closeButton.style.transform='scale(.95)'));
        closeButton.addEventListener('mouseup', ()=> (closeButton.style.transform='scale(1)'));
      }
      if (closeAnswerButton) {
        closeAnswerButton.addEventListener('click', ()=>{
          answerContainer.style.opacity = 0;
          answerContainer.style.transform = 'translateY(-50%) scale(.8)';
          answerContainer.addEventListener('transitionend', function handler() {
            if (parseFloat(answerContainer.style.opacity) === 0) {
              answerContainer.style.display = 'none';
              answerContainer.style.visibility = 'hidden';
              answerContainer.style.transform = 'translateY(-50%) scale(1)';
              answerContainer.removeEventListener('transitionend', handler);
            }
          }, { once: true });
        });
        closeAnswerButton.addEventListener('mousedown', ()=> (closeAnswerButton.style.transform='scale(.95)'));
        closeAnswerButton.addEventListener('mouseup', ()=> (closeAnswerButton.style.transform='scale(1)'));
      }

      getAnswerButton.addEventListener('mouseenter', async ()=>{ try{ await this.handleHoverEnter(); }catch(e){} getAnswerButton.style.background='#1f1f1f'; });
      getAnswerButton.addEventListener('mouseleave', async ()=>{ try{ await this.handleHoverLeave(); }catch(e){} getAnswerButton.style.background='#151515'; });
      getAnswerButton.addEventListener('mousedown', ()=> (getAnswerButton.style.transform='scale(.98)'));
      getAnswerButton.addEventListener('mouseup', ()=> (getAnswerButton.style.transform='scale(1)'));

      // Toggle start/stop
      getAnswerButton.addEventListener('click', async ()=>{
        if (!this.isRunning) {
          this.isRunning = true;
          await this.startProcessUI();
          try { this.setEyeToFull(); } catch(e){}
          this.runSolverLoop();
        } else {
          this.stopProcessImmediate();
          await this.stopProcessUI();
        }
      });

      // Settings
      const settingsCog = document.getElementById('settingsCog');
      const settingsBack = document.getElementById('settingsBack');
      if (settingsCog) settingsCog.addEventListener('click', (e)=>{ e.preventDefault(); this.openSettingsMenu(); });
      if (settingsBack) settingsBack.addEventListener('click', (e)=>{ e.preventDefault(); this.backFromSettings(); });
    }

  }

  // start
  new AssessmentHelperMCQ();
})();
