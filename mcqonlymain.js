
// AssessmentHelper — MCQ-Only (GroqCloud, single API)
// Full UI preserved: launcher, eye animations, draggable panels, settings (MCQ + Groq only).
// Writing features, Cloudflare proxy, multi-key juggling removed.
// Restored verbose console logs for debugging.
// Save as: AssessmentHelper-MCQ.js
(function () {
  try { console.clear(); } catch (e) {}
  console.log('[AssessmentHelper] injected: MCQ-only GroqCloud build');

  // Prevent duplicate injection
  if (document.getElementById('Launcher')) {
    console.log('[AssessmentHelper] Launcher already present; aborting second inject.');
    return;
  }

  class AssessmentHelper {
    constructor() {
      // public pointer for debugging
      window.__AssessmentHelperInstance = this;

      // UI/drag state
      this.answerIsDragging = false;
      this.answerInitialX = 0;
      this.answerInitialY = 0;

      this.isRunning = false;
      this.currentAbortController = null;

      // Eye state
      this.eyeState = 'sleep';
      this.currentVideo = null;

      // External libs
      this.animeScriptUrl = 'https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js';
      this.draggabillyScriptUrl = 'https://unpkg.com/draggabilly@3/dist/draggabilly.pkgd.min.js';

      // Assets
      this.assetBase = 'https://raw.githubusercontent.com/ARDARYUS/a3kbookmarklet/main/icons/';

      // Settings (MCQ + Groq-only)
      this.settingsKeys = {
        mc_wait: 'ah_mc_wait_ms',
        mc_random_pct: 'ah_mc_random_pct',
        ai_groq_url: 'ah_ai_groq_url',
        ai_groq_key: 'ah_ai_groq_key',
        ai_groq_model: 'ah_ai_groq_model'
      };
      this.defaults = {
        mc_wait: 1000,
        mc_random_pct: 0,
        ai_groq_url: 'https://api.groq.com/openai/v1/chat/completions',
        ai_groq_model: 'llama-3.1-8b-instant'
      };

      // Settings UI state
      this.settingsState = 'closed';
      this._eyeOriginal = null;

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.init());
      } else {
        this.init();
      }
    }

    // ---------------- Utilities / Settings ----------------
    log(msg, data) {
      try { console.log(`[AssessmentHelper] ${msg}`, data ?? ''); } catch (e) {}
    }
    warn(msg, data) {
      try { console.warn(`[AssessmentHelper] ${msg}`, data ?? ''); } catch (e) {}
    }
    error(msg, data) {
      try { console.error(`[AssessmentHelper] ${msg}`, data ?? ''); } catch (e) {}
    }

    saveSetting(key, value) { try { localStorage.setItem(key, String(value)); } catch (e) {} }
    loadSetting(key, fallback) { try { const v = localStorage.getItem(key); return (v == null ? fallback : v); } catch (e) { return fallback; } }

    getMCWait() { return Number(localStorage.getItem(this.settingsKeys.mc_wait) || this.defaults.mc_wait); }
    getMCRandomPct() { return Number(localStorage.getItem(this.settingsKeys.mc_random_pct) || this.defaults.mc_random_pct); }
    resetMCWait() { this.saveSetting(this.settingsKeys.mc_wait, this.defaults.mc_wait); }
    resetMCRandom() { this.saveSetting(this.settingsKeys.mc_random_pct, this.defaults.mc_random_pct); }

    getGroqUrl() { return this.loadSetting(this.settingsKeys.ai_groq_url, this.defaults.ai_groq_url); }
    getGroqModel() { return this.loadSetting(this.settingsKeys.ai_groq_model, this.defaults.ai_groq_model); }
    getGroqKey() { return this.loadSetting(this.settingsKeys.ai_groq_key, ''); }

    // ---------------- DOM helpers ----------------
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

    loadScript(url) {
      return new Promise((resolve, reject) => {
        const existing = Array.from(document.getElementsByTagName('script')).find(s => s.src && s.src.indexOf(url) !== -1);
        if (existing) return resolve();
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => resolve();
        script.onerror = () => { script.remove(); reject(new Error('Failed to load ' + url)); };
        document.head.appendChild(script);
      });
    }

    // ---------------- Init & UI ----------------
    async init() {
      try {
        await Promise.resolve(this.loadScript(this.animeScriptUrl)).catch(() => this.warn('anime.js failed to load'));
        await Promise.resolve(this.loadScript(this.draggabillyScriptUrl)).catch(() => this.warn('draggabilly failed to load'));
        this.itemMetadata = { UI: this.createUI(), answerUI: this.createAnswerUI() };
        this.playIntroAnimation();
      } catch (err) {
        this.error('init failed; falling back to direct showUI', err);
        try {
          this.itemMetadata = { UI: this.createUI(), answerUI: this.createAnswerUI() };
          this.showUI(true);
        } catch (e) {}
      }
    }

    createUI() {
      const container = this.createEl('div');
      const launcher = this.createEl('div', {
        id: 'Launcher',
        className: 'Launcher',
        style:
          "min-height:160px;opacity:0;visibility:hidden;transition:opacity 0.25s ease,width 0.25s ease,font-size .12s ease;font-family:'Nunito',sans-serif;width:180px;height:240px;background:#010203;position:fixed;border-radius:12px;border:2px solid #0a0b0f;display:flex;flex-direction:column;align-items:center;color:white;font-size:16px;top:50%;left:20px;transform:translateY(-50%);z-index:99999;padding:16px;box-shadow:0 10px 8px rgba(0,0,0,0.2), 0 0 8px rgba(255,255,255,0.05);overflow:hidden;white-space:nowrap;"
      });

      const dragHandle = this.createEl('div', { className: 'drag-handle', style: 'width:100%;height:24px;cursor:move;background:transparent;position:absolute;top:0;' });

      const eyeWrapper = this.createEl('div', {
        id: 'helperEye',
        style:
          'width:90px;height:90px;margin-top:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;transform-style:preserve-3d;transition:all 0.12s linear;will-change:transform,top,right,width,height;transform-origin:50% 40%;pointer-events:none;'
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
        autoplay: false,
        loop: false,
        muted: true,
        playsInline: true,
        preload: 'auto'
      });

      eyeWrapper.appendChild(uiImg);
      eyeWrapper.appendChild(uiVideo);

      const closeButton = this.createEl('button', {
        id: 'closeButton',
        text: '\u00D7',
        style: 'position:absolute;top:8px;right:8px;background:none;border:none;color:white;font-size:18px;cursor:pointer;padding:2px 8px;transition:color 0.12s ease, transform 0.1s ease;opacity:0.5;z-index:100005;'
      });

      const getAnswerButton = this.createEl('button', {
        id: 'getAnswerButton',
        style:
          'background:#151515;border:1px solid rgba(255,255,255,0.04);color:white;padding:10px 12px;border-radius:8px;cursor:pointer;margin-top:18px;width:140px;height:64px;font-size:14px;transition:background 0.14s ease, transform 0.08s ease, box-shadow 0.12s;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;'
      });

      const spinner = this.createEl('div', { id: 'ah-spinner', style: 'width:22px;height:22px;border-radius:50%;border:3px solid rgba(255,255,255,0.12);border-top-color:#ffffff;display:none;animation:ah-spin 0.85s cubic-bezier(.4,.0,.2,1) infinite;' });
      const buttonTextSpan = this.createEl('span', { text: 'work smArt-er', id: 'getAnswerButtonText', style: 'font-size:14px;line-height:1;user-select:none;' });
      getAnswerButton.appendChild(spinner);
      getAnswerButton.appendChild(buttonTextSpan);

      const version = this.createEl('div', { id: 'ah-version', style: 'position:absolute;bottom:8px;right:8px;font-size:12px;opacity:0.9;z-index:100005', text: 'MCQ' });

      const settingsCog = this.createEl('button', { id: 'settingsCog', title: 'Settings', innerHTML: '⚙', style: 'position:absolute;bottom:8px;left:8px;background:none;border:none;color:#cfcfcf;font-size:16px;cursor:pointer;opacity:0.85;padding:2px;transition:transform .12s;z-index:100005' });
      const settingsBack = this.createEl('button', { id: 'settingsBack', title: 'Back', innerHTML: '⟵', style: 'position:absolute;bottom:8px;left:8px;background:none;border:none;color:#ff4d4d;font-size:18px;cursor:pointer;opacity:0;display:none;padding:2px;transition:opacity .12s;z-index:100005' });

      const settingsPanel = this.createEl('div', { id: 'settingsPanel', style: 'position:absolute;top:48px;left:12px;right:12px;bottom:48px;display:none;flex-direction:column;align-items:flex-start;gap:8px;overflow:auto;' });

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
        @keyframes ah-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        #getAnswerButton.running { background: #1e1e1e; box-shadow: 0 4px 12px rgba(0,0,0,0.35); }
        #getAnswerButton.running span { font-size:12px; opacity:0.95; }
        #settingsPanel input[type="number"], #settingsPanel input[type="text"] { width:80px; padding:4px; border-radius:6px; border:1px solid rgba(255,255,255,0.08); background:transparent; color:white; }
        #settingsPanel label { font-size:13px; margin-right:6px; }
        .ah-reset { cursor:pointer; margin-left:8px; opacity:0.8; font-size:14px; user-select:none; }
        .ah-section-title { font-weight:700; margin-top:4px; margin-bottom:6px; font-size:14px; }
        #settingsPanel button { transition: background 0.12s ease, transform 0.08s ease; }
        #settingsPanel button:hover { background:#222; transform: translateY(-1px); }
        #getAnswerButton:hover { background: #1f1f1f !important; transform: translateY(-1px); }
        #settingsCog { transition: transform 0.12s ease, opacity 0.12s ease; }
        #settingsCog:hover { transform: rotate(22.5deg); }
      `);

      return container;
    }

    createAnswerUI() {
      const container = this.createEl('div');
      const answerContainer = this.createEl('div', {
        id: 'answerContainer',
        className: 'answerLauncher',
        style:
          "outline:none;min-height:60px;transform:translateX(0px) translateY(-50%);opacity:0;visibility:hidden;transition:opacity 0.3s ease, transform 0.3s ease;font-family:'Nunito',sans-serif;width:120px;height:80px;background:#1c1e2b;position:fixed;border-radius:8px;display:flex;justify-content:center;align-items:center;color:white;font-size:28px;top:50%;right:220px;z-index:99998;padding:8px;box-shadow:0 4px 8px rgba(0,0,0,0.2);overflow:hidden;white-space:normal;"
      });

      const dragHandle = this.createEl('div', { className: 'answer-drag-handle', style: 'width:100%;height:24px;cursor:move;background:transparent;position:absolute;top:0;' });
      const closeButton = this.createEl('button', { id: 'closeAnswerButton', style: 'position:absolute;top:8px;right:8px;background:none;border:none;color:white;font-size:18px;cursor:pointer;padding:2px 8px;transition:color 0.2s ease, transform 0.1s ease;' });
      const answerContent = this.createEl('div', { id: 'answerContent', style: 'padding:0;margin:0;word-wrap:break-word;font-size:28px;font-weight:bold;display:flex;justify-content:center;align-items:center;width:100%;height:100%;' });

      answerContainer.appendChild(dragHandle);
      answerContainer.appendChild(closeButton);
      answerContainer.appendChild(answerContent);
      container.appendChild(answerContainer);
      return container;
    }

    playIntroAnimation() {
      if (typeof anime === 'undefined') { this.showUI(); return; }
      const imageUrl = this.getUrl('icons/eyebackground.gif');
      const introImgElement = this.createEl('img', { src: imageUrl, id: 'introLoaderImage', style: 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.5);width:100px;height:auto;border-radius:12px;box-shadow:0 4px 8px rgba(0,0,0,0.2);z-index:100001;opacity:0;' });
      document.body.appendChild(introImgElement);

      anime.timeline({ easing: 'easeInOutQuad', duration: 800, complete: () => { try { introImgElement.remove(); } catch (e) {} this.showUI(); } })
        .add({ targets: introImgElement, opacity: [0, 1], scale: [0.5, 1], rotate: '1turn', duration: 1000, easing: 'easeOutExpo' })
        .add({ targets: introImgElement, translateY: '-=20', duration: 500, easing: 'easeInOutSine' })
        .add({ targets: introImgElement, translateY: '+=20', duration: 500, easing: 'easeInOutSine' })
        .add({ targets: introImgElement, opacity: 0, duration: 500, easing: 'linear' }, '+=500');
    }

    showUI(skipAnimation = false) {
      try { document.body.appendChild(this.itemMetadata.UI); document.body.appendChild(this.itemMetadata.answerUI); } catch (e) { this.error('showUI append failed', e); }
      const launcher = document.getElementById('Launcher');
      if (!launcher) { this.setupEventListeners(); return; }
      if (skipAnimation) {
        launcher.style.visibility = 'visible';
        launcher.style.opacity = 1;
        this.setupEventListeners();
      } else {
        launcher.style.visibility = 'visible';
        setTimeout(() => (launcher.style.opacity = 1), 10);
        setTimeout(() => this.setupEventListeners(), 200);
      }
    }

    showAlert(message, type = 'info') {
      const alertContainer = this.createEl('div', {
        style: `position:fixed;top:20px;left:50%;transform:translateX(-50%);background-color:${type === 'error' ? '#dc3545' : '#007bff'};color:white;padding:15px 25px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.2);z-index:100000;opacity:0;transition:opacity 0.5s ease-in-out;font-family:'Nunito',sans-serif;font-size:16px;max-width:80%;text-align:center;`
      });
      alertContainer.textContent = message;
      document.body.appendChild(alertContainer);
      setTimeout(() => (alertContainer.style.opacity = 1), 10);
      setTimeout(() => { alertContainer.style.opacity = 0; alertContainer.addEventListener('transitionend', () => alertContainer.remove()); }, 2500);
    }

    // ---------------- Content (MCQ only) ----------------
    async fetchArticleContent() {
      try {
        const articleContainer = document.querySelector('#start-reading');
        let articleContent = '';
        if (articleContainer) {
          const paragraphs = articleContainer.querySelectorAll('p');
          articleContent = Array.from(paragraphs).map((p) => p.textContent.trim()).join(' ');
        }
        const questionContainer = document.querySelector('#activity-component-react') || document.querySelector('#question-text') || document.querySelector('.question-text');
        const questionContent = questionContainer ? questionContainer.textContent.trim() : '';

        const combinedContent = `${articleContent}\n\n${questionContent}`.trim();
        return combinedContent || questionContent || articleContent || '';
      } catch (err) {
        this.warn('fetchArticleContent error', err);
        return '';
      }
    }

    // ---------------- Groq: single API call ----------------
    async fetchAnswer(queryContent, retryCount = 0) {
      const MAX_RETRIES = 2, RETRY_DELAY_MS = 1000;
      try {
        if (this.currentAbortController) {
          try { this.currentAbortController.abort(); } catch (e) {}
        }
        this.currentAbortController = new AbortController();
        const signal = this.currentAbortController.signal;

        const groqUrl = this.getGroqUrl();
        const groqModel = this.getGroqModel();
        const groqKey = this.getGroqKey();
        if (!groqKey) throw new Error('Missing Groq API key (set it in Settings > AI Settings).');

        const payload = {
          model: groqModel,
          messages: [
            { role: 'system', content: 'You answer multiple-choice questions. Reply with ONLY a single capital letter: A, B, C, D, or E. No punctuation, no words.' },
            { role: 'user', content: (queryContent || '') }
          ],
          max_tokens: 4,
          temperature: 0
        };
        this.log('fetchAnswer payload', payload);

        const response = await fetch(groqUrl, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + groqKey
          },
          body: JSON.stringify(payload),
          signal
        });

        this.currentAbortController = null;

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          const isTransient = response.status === 429 || response.status >= 500;
          this.warn(`API non-OK (${response.status})`, text);
          if (isTransient && retryCount < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            return this.fetchAnswer(queryContent, retryCount + 1);
          }
          throw new Error(`API error ${response.status}: ${text}`);
        }

        const data = await response.json().catch(() => null);
        this.log('fetchAnswer raw response', data);
        let content = '';
        if (data && Array.isArray(data.choices) && data.choices.length) {
          const c = data.choices[0];
          if (c.message && (c.message.content || c.message.role)) content = String(c.message.content || '').trim();
          else if (c.text) content = String(c.text).trim();
          else if (c.delta && c.delta.content) content = String(c.delta.content).trim();
        } else if (typeof data === 'string') content = data.trim();
        else if (data && (data.output || data.answer || data.result)) content = String(data.output || data.answer || data.result).trim();

        // Enforce single letter A–E
        const letterMatch = (content || '').match(/[A-E]/i);
        const letter = letterMatch ? letterMatch[0].toUpperCase() : '';
        this.log('parsed letter', { content, letter });
        return letter || '';
      } catch (err) {
        if (err && err.name === 'AbortError') return '<<ABORTED>>';
        this.error('fetchAnswer error', err);
        return '';
      }
    }

    // ---------------- Eye helpers ----------------
    setEyeToSleep() {
      if (this.eyeState === 'full') return;
      try {
        this.clearCurrentVideo();
        const img = document.getElementById('helperEyeImg');
        const video = document.getElementById('helperEyeVideo');
        if (!img || !video) return;
        video.style.display = 'none';
        img.style.display = 'block';
        img.src = this.getUrl('icons/sleep.gif');
        this.eyeState = 'sleep';
        img.style.opacity = '1';
      } catch (err) {}
    }

    setEyeToFull() {
      try {
        this.eyeState = 'full';
        this.clearCurrentVideo();
        const img = document.getElementById('helperEyeImg');
        const video = document.getElementById('helperEyeVideo');
        if (!img || !video) return;
        video.style.display = 'none';
        img.style.display = 'block';
        img.src = this.getUrl('icons/full.gif') + '?r=' + Date.now();
      } catch (err) {}
    }

    async handleHoverEnter() {
      if (this.eyeState === 'full') return;
      try {
        await this.playVideoOnce(this.getUrl('icons/wakeup.webm'));
        if (this.eyeState === 'full') return;
        const img = document.getElementById('helperEyeImg');
        const video = document.getElementById('helperEyeVideo');
        if (!img || !video) return;
        video.style.display = 'none';
        img.style.display = 'block';
        img.src = this.getUrl('icons/idle.gif') + '?r=' + Date.now();
        this.eyeState = 'idle';
      } catch (err) {}
    }

    async handleHoverLeave() {
      if (this.eyeState === 'full') return;
      try {
        await this.playVideoOnce(this.getUrl('icons/gotosleep.webm'));
        if (this.eyeState === 'full') return;
        this.setEyeToSleep();
      } catch (err) {}
    }

    playVideoOnce(src) {
      return new Promise((resolve) => {
        try {
          const video = document.getElementById('helperEyeVideo');
          const img = document.getElementById('helperEyeImg');
          if (!video || !img) { resolve(); return; }
          this.clearCurrentVideo();
          video.src = src;
          video.loop = false;
          video.muted = true;
          video.playsInline = true;
          video.preload = 'auto';
          video.style.display = 'block';
          img.style.display = 'none';
          this.currentVideo = video;

          if (src.indexOf('wakeup') !== -1) this.eyeState = 'waking';
          else if (src.indexOf('gotosleep') !== -1) this.eyeState = 'going-to-sleep';
          else this.eyeState = 'waking';

          const onEnded = () => {
            if (this.currentVideo === video) this.currentVideo = null;
            video.removeEventListener('ended', onEnded);
            video.removeEventListener('error', onError);
            setTimeout(() => resolve(), 8);
          };
          const onError = () => {
            if (this.currentVideo === video) this.currentVideo = null;
            video.removeEventListener('error', onError);
            video.removeEventListener('ended', onEnded);
            resolve();
          };

          video.addEventListener('ended', onEnded);
          video.addEventListener('error', onError);

          const playPromise = video.play();
          if (playPromise && typeof playPromise.then === 'function') {
            playPromise.catch(() => { video.removeEventListener('ended', onEnded); video.removeEventListener('error', onError); this.currentVideo = null; setTimeout(() => resolve(), 250); });
          }
        } catch (err) { resolve(); }
      });
    }

    clearCurrentVideo() {
      try {
        const video = document.getElementById('helperEyeVideo');
        const img = document.getElementById('helperEyeImg');
        if (!video || !img) return;
        try { if (!video.paused) video.pause(); } catch (e) {}
        try { video.removeAttribute('src'); video.load(); } catch (e) {}
        video.style.display = 'none';
        img.style.display = 'block';
        this.currentVideo = null;
      } catch (err) {}
    }

    // ---------------- Start/Stop UI ----------------
    async startProcessUI() {
      const btn = document.getElementById('getAnswerButton');
      const spinner = document.getElementById('ah-spinner');
      const label = document.getElementById('getAnswerButtonText');
      if (btn) btn.classList.add('running');
      if (spinner) spinner.style.display = 'block';
      if (label) label.textContent = 'stop.';
      this.log('started');
    }

    async stopProcessUI() {
      const btn = document.getElementById('getAnswerButton');
      const spinner = document.getElementById('ah-spinner');
      const label = document.getElementById('getAnswerButtonText');
      if (btn) btn.classList.remove('running');
      if (spinner) spinner.style.display = 'none';
      if (label) label.textContent = 'work smArt-er';
      this.log('stopped');
      try { await this.playVideoOnce(this.getUrl('icons/gotosleep.webm')); } catch (e) {}
      this.setEyeToSleep();
    }

    stopProcessImmediate() {
      this.isRunning = false;
      if (this.currentAbortController) {
        try { this.currentAbortController.abort(); } catch (e) {}
        this.currentAbortController = null;
      }
    }

    // ---------------- Settings UI (menu/mc/ai) ----------------
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
      if (expandRight) {
        launcher.style.left = `${rect.left}px`;
        launcher.style.right = 'auto';
        launcher.style.width = `${widthPx}px`;
      } else {
        const rightCss = Math.round(window.innerWidth - rect.right);
        launcher.style.right = `${rightCss}px`;
        launcher.style.left = 'auto';
        launcher.style.width = `${widthPx}px`;
      }
    }

    _shrinkEyeToTopRight() {
      const eye = document.getElementById('helperEye');
      if (!eye) return;
      if (!this._eyeOriginal) {
        this._eyeOriginal = { style: eye.getAttribute('style') || '', parentDisplay: eye.style.display || '' };
      }
      eye.style.display = 'flex';
      eye.style.position = 'absolute';
      eye.style.top = '12px';
      eye.style.right = '44px';
      eye.style.width = '48px';
      eye.style.height = '48px';
      eye.style.marginTop = '0';
      eye.style.zIndex = '100004';
      const img = document.getElementById('helperEyeImg');
      if (img) img.style.width = '100%';
    }

    _restoreEyeFromShrink() {
      const eye = document.getElementById('helperEye');
      if (!eye) return;
      if (this._eyeOriginal) {
        eye.setAttribute('style', this._eyeOriginal.style);
        this._eyeOriginal = null;
      } else {
        eye.style.position = '';
        eye.style.top = '';
        eye.style.right = '';
        eye.style.width = '90px';
        eye.style.height = '90px';
        eye.style.marginTop = '32px';
        eye.style.zIndex = '';
        const img = document.getElementById('helperEyeImg');
        if (img) img.style.width = '100%';
      }
    }

    buildSettingsMenu() {
      const panel = document.getElementById('settingsPanel');
      if (!panel) return;
      panel.innerHTML = '';

      const title = this.createEl('div', { className: 'ah-section-title', text: 'Settings' });
      panel.appendChild(title);

      const mcBtn = this.createEl('button', { id: 'mcSettingsBtn', text: 'Multiple Choice Settings', style: 'padding:10px 12px;border-radius:8px;background:#151515;border:1px solid rgba(255,255,255,0.04);color:white;cursor:pointer;' });
      const aiBtn = this.createEl('button', { id: 'aiSettingsBtn', text: 'AI Settings (GroqCloud)', style: 'padding:10px 12px;border-radius:8px;background:#151515;border:1px solid rgba(255,255,255,0.04);color:white;cursor:pointer;' });

      panel.appendChild(mcBtn);
      panel.appendChild(aiBtn);

      mcBtn.addEventListener('click', (e) => { e.preventDefault(); this.openMCSettings(); });
      aiBtn.addEventListener('click', (e) => { e.preventDefault(); this.openAISettings(); });
    }

    openSettingsMenu() {
      const btn = document.getElementById('getAnswerButton');
      const panel = document.getElementById('settingsPanel');
      const expandRight = this._computeExpandRight();
      this._setLauncherWidthAndAnchor(360, expandRight);
      this._shrinkEyeToTopRight();
      if (btn) { btn.style.transition = 'opacity 0.12s'; btn.style.opacity = '0'; setTimeout(() => btn.style.display = 'none', 140); }
      if (panel) { panel.style.display = 'flex'; panel.style.opacity = '1'; }
      const settingsCog = document.getElementById('settingsCog');
      const settingsBack = document.getElementById('settingsBack');
      if (settingsCog) settingsCog.style.display = 'none';
      if (settingsBack) { settingsBack.style.display = 'block'; settingsBack.style.opacity = '1'; }
      this.settingsState = 'menu';
      this.buildSettingsMenu();
    }

    openMCSettings() {
      const panel = document.getElementById('settingsPanel');
      const expandRight = this._computeExpandRight();
      this._setLauncherWidthAndAnchor(520, expandRight);
      if (!panel) return;
      panel.innerHTML = '';
      this.settingsState = 'mc';

      const title = this.createEl('div', { className: 'ah-section-title', text: 'Multiple Choice Settings' });
      panel.appendChild(title);

      const waitRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
      const waitLabel = this.createEl('label', { text: 'Wait time (ms):', style: 'min-width:120px;' });
      const waitInput = this.createEl('input', { type: 'number', id: 'mcWaitInput', value: String(this.getMCWait()), style: '' });
      const waitReset = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Reset to default' });
      waitReset.addEventListener('click', () => { this.resetMCWait(); waitInput.value = String(this.getMCWait()); });
      waitInput.addEventListener('change', () => { const v = Number(waitInput.value) || this.defaults.mc_wait; this.saveSetting(this.settingsKeys.mc_wait, v); });
      waitRow.appendChild(waitLabel); waitRow.appendChild(waitInput); waitRow.appendChild(waitReset);
      panel.appendChild(waitRow);

      const probRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
      const probLabel = this.createEl('label', { text: 'Random answer %:', style: 'min-width:120px;' });
      const probInput = this.createEl('input', { type: 'number', id: 'mcRandomInput', value: String(this.getMCRandomPct()), min: 0, max: 100 });
      const probReset = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Reset to default' });
      probReset.addEventListener('click', () => { this.resetMCRandom(); probInput.value = String(this.getMCRandomPct()); });
      probInput.addEventListener('change', () => {
        let v = Number(probInput.value);
        if (!Number.isFinite(v) || v < 0) v = 0;
        if (v > 100) v = 100;
        this.saveSetting(this.settingsKeys.mc_random_pct, v);
        probInput.value = String(v);
      });
      probRow.appendChild(probLabel); probRow.appendChild(probInput); probRow.appendChild(probReset);
      panel.appendChild(probRow);

      const note = this.createEl('div', { text: 'Tip: set random % > 0 to mimic occasional wrong answers.', style: 'font-size:12px;opacity:0.8;margin-top:8px;' });
      panel.appendChild(note);
    }

    openAISettings() {
      const panel = document.getElementById('settingsPanel');
      const expandRight = this._computeExpandRight();
      this._setLauncherWidthAndAnchor(520, expandRight);
      this.settingsState = 'ai';
      if (!panel) return;
      panel.innerHTML = '';

      const title = this.createEl('div', { className: 'ah-section-title', text: 'AI Settings (GroqCloud)' });
      panel.appendChild(title);

      // URL
      const urlRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%;' });
      const urlLabel = this.createEl('label', { text: 'Groq URL:', style: 'min-width:160px;' });
      const urlInput = this.createEl('input', { type: 'text', id: 'aiGroqUrlInput', value: this.getGroqUrl(), style: 'flex:1;padding:6px;border:1px solid #ccc;border-radius:4px;' });
      const urlReset = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Reset to default' });
      urlReset.addEventListener('click', () => { urlInput.value = this.defaults.ai_groq_url; this.saveSetting(this.settingsKeys.ai_groq_url, urlInput.value); });
      urlInput.addEventListener('change', () => this.saveSetting(this.settingsKeys.ai_groq_url, urlInput.value || ''));
      urlRow.appendChild(urlLabel); urlRow.appendChild(urlInput); urlRow.appendChild(urlReset);
      panel.appendChild(urlRow);

      // Model
      const modelRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%;' });
      const modelLabel = this.createEl('label', { text: 'Model:', style: 'min-width:160px;' });
      const modelInput = this.createEl('input', { type: 'text', id: 'aiGroqModelInput', value: this.getGroqModel(), style: 'flex:1;padding:6px;border:1px solid #ccc;border-radius:4px;' });
      modelInput.addEventListener('change', () => this.saveSetting(this.settingsKeys.ai_groq_model, modelInput.value || this.defaults.ai_groq_model));
      modelRow.appendChild(modelLabel); modelRow.appendChild(modelInput);
      panel.appendChild(modelRow);

      // API Key
      const keyRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%;' });
      const keyLabel = this.createEl('label', { text: 'API key:', style: 'min-width:160px;' });
      const keyInput = this.createEl('input', { type: 'text', id: 'aiGroqKeyInput', value: this.getGroqKey(), style: 'flex:1;padding:6px;border:1px solid #ccc;border-radius:4px;' });
      const keyClear = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Clear' });
      keyClear.addEventListener('click', () => { keyInput.value = ''; this.saveSetting(this.settingsKeys.ai_groq_key, ''); });
      keyInput.addEventListener('change', () => this.saveSetting(this.settingsKeys.ai_groq_key, keyInput.value || ''));
      keyRow.appendChild(keyLabel); keyRow.appendChild(keyInput); keyRow.appendChild(keyClear);
      panel.appendChild(keyRow);
    }

    backFromSettings() {
      const btn = document.getElementById('getAnswerButton');
      const settingsPanel = document.getElementById('settingsPanel');
      const settingsCog = document.getElementById('settingsCog');
      const settingsBack = document.getElementById('settingsBack');

      if (this.settingsState === 'mc' || this.settingsState === 'ai') {
        const expandRight = this._computeExpandRight();
        this._setLauncherWidthAndAnchor(360, expandRight);
        this.settingsState = 'menu';
        this.buildSettingsMenu();
        return;
      }

      if (this.settingsState === 'menu') {
        if (settingsPanel) { settingsPanel.style.display = 'none'; settingsPanel.innerHTML = ''; }
        if (btn) { btn.style.display = 'flex'; setTimeout(() => btn.style.opacity = '1', 10); }
        if (settingsBack) { settingsBack.style.opacity = '0'; setTimeout(() => settingsBack.style.display = 'none', 120); }
        if (settingsCog) settingsCog.style.display = 'block';
        const expandRight = this._computeExpandRight();
        this._setLauncherWidthAndAnchor(180, expandRight);
        this._restoreEyeFromShrink();
        this.settingsState = 'closed';
        return;
      }
    }

    // ---------------- Event wiring ----------------
    setupEventListeners() {
      try {
        const launcher = document.getElementById('Launcher');
        const answerContainer = document.getElementById('answerContainer');
        const getAnswerButton = launcher ? launcher.querySelector('#getAnswerButton') : null;
        if (!launcher || !answerContainer || !getAnswerButton) return;

        const closeButton = launcher.querySelector('#closeButton');
        const closeAnswerButton = answerContainer.querySelector('#closeAnswerButton');

        this.applyStylesOnce('assessment-helper-styles', `
          #closeButton:hover, #closeAnswerButton:hover { color: #ff6b6b; opacity: 1 !important; }
          #closeButton:active, #closeAnswerButton:active { color: #e05252; transform: scale(0.95); }
          #getAnswerButton { position: relative; z-index: 100001; transition: background 0.2s ease, transform 0.1s ease; }
          #getAnswerButton:hover { background: #1f1f1f !important; }
          #getAnswerButton:active { background: #4c4e5b !important; transform: scale(0.98); }
          #getAnswerButton:disabled { opacity: 0.6; cursor: not-allowed; }
          .answerLauncher.show { opacity: 1; visibility: visible; transform: translateY(-50%) scale(1); }
        `);

        if (typeof Draggabilly !== 'undefined') {
          try { new Draggabilly(launcher, { handle: '.drag-handle', delay: 50 }); } catch (e) {}
          try { new Draggabilly(answerContainer, { handle: '.answer-drag-handle', delay: 50 }); } catch (e) {}
        }

        const answerDragHandle = answerContainer.querySelector('.answer-drag-handle');
        if (answerDragHandle) {
          answerDragHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.answerIsDragging = true;
            const rect = answerContainer.getBoundingClientRect();
            this.answerInitialX = e.clientX - rect.left;
            this.answerInitialY = e.clientY - rect.top;
            answerContainer.style.position = 'fixed';
          });
        }

        document.addEventListener('mousemove', (e) => {
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
        const stopDrag = () => (this.answerIsDragging = false);
        document.addEventListener('mouseup', stopDrag);
        document.addEventListener('mouseleave', stopDrag);

        if (closeButton) {
          closeButton.addEventListener('click', () => {
            try {
              if (window.__AssessmentHelperInstance && typeof window.__AssessmentHelperInstance.stopProcessImmediate === 'function') {
                try { window.__AssessmentHelperInstance.stopProcessImmediate(); } catch (e) {}
              }
            } catch (e) {}
            launcher.style.opacity = 0;
            launcher.addEventListener('transitionend', function handler() {
              try {
                const launcherEl = document.getElementById('Launcher');
                if (launcherEl && launcherEl.parentElement) launcherEl.parentElement.remove();
                const answerEl = document.getElementById('answerContainer');
                if (answerEl && answerEl.parentElement) answerEl.parentElement.remove();
                try { window.__AssessmentHelperInstance = null; } catch (e) {}
              } catch (e) {}
              launcher.removeEventListener('transitionend', handler);
            }, { once: true });
          });
          closeButton.addEventListener('mousedown', () => (closeButton.style.transform = 'scale(0.95)'));
          closeButton.addEventListener('mouseup', () => (closeButton.style.transform = 'scale(1)'));
        }

        if (closeAnswerButton) {
          closeAnswerButton.addEventListener('click', () => {
            answerContainer.style.opacity = 0;
            answerContainer.style.transform = 'translateY(-50%) scale(0.8)';
            answerContainer.addEventListener('transitionend', function handler() {
              if (parseFloat(answerContainer.style.opacity) === 0) {
                answerContainer.style.display = 'none';
                answerContainer.style.visibility = 'hidden';
                answerContainer.style.transform = 'translateY(-50%) scale(1)';
                answerContainer.removeEventListener('transitionend', handler);
              }
            }, { once: true });
          });
          closeAnswerButton.addEventListener('mousedown', () => (closeAnswerButton.style.transform = 'scale(0.95)'));
          closeAnswerButton.addEventListener('mouseup', () => (closeAnswerButton.style.transform = 'scale(1)'));
        }

        getAnswerButton.addEventListener('mouseenter', async () => { try { await this.handleHoverEnter(); } catch (e) {} getAnswerButton.style.background = '#1f1f1f'; });
        getAnswerButton.addEventListener('mouseleave', async () => { try { await this.handleHoverLeave(); } catch (e) {} getAnswerButton.style.background = '#151515'; });
        getAnswerButton.addEventListener('mousedown', () => (getAnswerButton.style.transform = 'scale(0.98)'));
        getAnswerButton.addEventListener('mouseup', () => (getAnswerButton.style.transform = 'scale(1)'));

        // Toggle start/stop
        getAnswerButton.addEventListener('click', async () => {
          if (!this.isRunning) {
            this.isRunning = true;
            await this.startProcessUI();
            try { this.setEyeToFull(); } catch (e) {}
            this.runSolverLoop();
          } else {
            this.stopProcessImmediate();
            await this.stopProcessUI();
          }
        });

        const settingsCog = document.getElementById('settingsCog');
        const settingsBack = document.getElementById('settingsBack');
        if (settingsCog) settingsCog.addEventListener('click', (e) => { e.preventDefault(); this.openSettingsMenu(); });
        if (settingsBack) settingsBack.addEventListener('click', (e) => { e.preventDefault(); this.backFromSettings(); });
      } catch (err) { this.error('setupEventListeners failed', err); }
    }

    // ---------------- MCQ mechanics ----------------
    async runSolverLoop() {
      const answerContainer = document.getElementById('answerContainer');
      const answerContent = document.getElementById('answerContent');
      if (answerContainer) { answerContainer.style.display = 'flex'; answerContainer.style.visibility = 'visible'; answerContainer.classList.add('show'); answerContainer.style.opacity = '1'; }

      while (this.isRunning) {
        try {
          const waitMs = this.getMCWait();
          const randomPct = this.getMCRandomPct();
          this.log('loop tick', { waitMs, randomPct });

          // 1) Gather context
          const context = await this.fetchArticleContent();
          if (!context) {
            this.warn('No context found; skipping to next');
            if (answerContent) answerContent.textContent = '?';
            await this._sleep(waitMs);
            this._tryGoNext();
            continue;
          }

          // 2) Compute answer
          let resultLetter = '';
          if (randomPct > 0 && Math.random() * 100 < randomPct) {
            const letters = ['A','B','C','D','E'];
            resultLetter = letters[Math.floor(Math.random()*letters.length)];
            this.log('randomized letter', resultLetter);
          } else {
            const raw = await this.fetchAnswer(context);
            resultLetter = (raw || '').trim().charAt(0).toUpperCase();
          }

          // Sanity: only A–E
          if (!/^[A-E]$/.test(resultLetter)) {
            this.warn('AI did not return A–E; showing raw and skipping click', resultLetter);
            if (answerContent) answerContent.textContent = (resultLetter || '?');
            await this._sleep(waitMs);
            this._tryGoNext();
            continue;
          }

          // 3) Show letter prominently
          if (answerContent) answerContent.textContent = resultLetter;
          this.log('final letter', resultLetter);

          // 4) Try selecting the corresponding choice & submit
          this._selectChoiceByLetter(resultLetter);
          await this._sleep(300);
          this._trySubmit();

          // 5) Wait, then go next
          await this._sleep(waitMs);
          this._tryGoNext();
        } catch (err) {
          this.error('loop error', err);
          if (answerContent) answerContent.textContent = '!';
          await this._sleep(500);
        }
      }

      await this.stopProcessUI();
    }

    _selectChoiceByLetter(letter) {
      // A=0, B=1, ...
      const idx = letter.charCodeAt(0) - 65;
      this.log('attempt select index', idx);

      // Strategy 1: radios by order
      const radios = Array.from(document.querySelectorAll('input[type="radio"]')).filter(r => !r.disabled);
      if (radios.length >= idx + 1) {
        const r = radios[idx];
        try {
          // Prefer clicking label for better site compatibility
          if (r.id) {
            const lab = document.querySelector(`label[for="${CSS.escape(r.id)}"]`);
            if (lab) { lab.click(); this.log('clicked label for radio', r.id); return true; }
          }
          r.click();
          this.log('clicked radio', r);
          return true;
        } catch (e) {}
      }

      // Strategy 2: list items / options
      const optionCandidates = Array.from(document.querySelectorAll('[role="radio"], [role="option"], li.choice, .option, .mcq-option, .answer, .choice'));
      if (optionCandidates.length >= idx + 1) {
        try { optionCandidates[idx].click(); this.log('clicked option candidate', optionCandidates[idx]); return true; } catch (e) {}
      }

      // Strategy 3: labels containing letter marker like "A)", "B."
      const labelCandidates = Array.from(document.querySelectorAll('label')).filter(l => /^[A-E][).]\s*/i.test((l.textContent || '').trim()));
      if (labelCandidates.length >= idx + 1) {
        try { labelCandidates[idx].click(); this.log('clicked labeled option', labelCandidates[idx]); return true; } catch (e) {}
      }

      this.warn('failed to select choice by letter', letter);
      return false;
    }

    _trySubmit() {
      const submitSelectors = [
        'button[type="submit"]',
        'button.submit',
        'button[aria-label="Submit"]',
        'button:has(span:contains("Submit"))',
        '#submit', '.submit-button',
        'button.primary', 'button.next'
      ];
      for (const sel of submitSelectors) {
        try {
          const el = this._querySmart(sel);
          if (el) { el.click(); this.log('clicked submit', sel); return true; }
        } catch (e) {}
      }
      return false;
    }

    _tryGoNext() {
      const selectors = [
        'button.next', 'button[aria-label="Next"]', 'button:has(span:contains("Next"))',
        '#next', '.next-button', 'a.next', 'a[rel="next"]'
      ];
      for (const sel of selectors) {
        try {
          const el = this._querySmart(sel);
          if (el) { el.click(); this.log('clicked next', sel); return true; }
        } catch (e) {}
      }
      return false;
    }

    _querySmart(selector) {
      try { return document.querySelector(selector); } catch (e) { return null; }
    }

    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  }

  // Instantiate
  new AssessmentHelper();
})();
