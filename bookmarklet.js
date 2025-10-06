// Full AssessmentHelper — All features restored: MC, Writing, Agree/Disagree, AI settings, UI settings, no cloudflare
(function () {
    'use strict';
    try { console.clear(); } catch (e) {}
    console.log('[AssessmentHelper] injected');

    // Prevent double-instantiation: allow re-inject after full removal
    if (window.__AssessmentHelperInstance && window.__AssessmentHelperInstance._alive) {
        console.log('[AssessmentHelper] instance already running');
        return;
    }

    class AssessmentHelper {
        constructor() {
            this._alive = true;
            window.__AssessmentHelperInstance = this;

            // state
            this.answerIsDragging = false;
            this.answerInitialX = 0;
            this.answerInitialY = 0;
            this.cachedArticle = null;
            this.isFetchingAnswer = false;

            this.isRunning = false;
            this.currentAbortController = null;
            this._stoppedByWrite = false;

            this.eyeState = 'sleep';
            this.currentVideo = null;

            // Resource base for icons/gifs (user told me icons are in ARDARYUS/a3kbookmarklet/icons)
            this.assetBase = 'https://raw.githubusercontent.com/ARDARYUS/a3kbookmarklet/main/icons/';

            // Settings keys & defaults
            this.settingsKeys = {
                mc_wait: 'ah_mc_wait_ms',
                mc_random_pct: 'ah_mc_random_pct',
                ai_use_api: 'ah_ai_use_api',
                ai_url: 'ah_ai_groq_url',
                ai_key: 'ah_ai_groq_key',
                ai_model: 'ah_ai_groq_model',
                // writing settings
                w_min: 'ah_w_min_words',
                w_max: 'ah_w_max_words',
                w_level: 'ah_w_level',
                w_blacklist: 'ah_w_blacklist',
                w_lower: 'ah_w_lower',
                w_mood: 'ah_w_mood'
            };
            this.defaults = {
                mc_wait: 300,
                mc_random_pct: 0,
                ai_use_api: true,
                ai_url: 'https://api.groq.com/openai/v1/chat/completions',
                ai_model: 'llama-3.1-8b-instant',
                w_min: '',
                w_max: '',
                w_level: 'C1',
                w_blacklist: '',
                w_lower: false,
                w_mood: ''
            };

            // UI settings state
            this.settingsState = 'closed'; // closed | menu | mc | writing | ai

            // start after DOM ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.init());
            } else {
                this.init();
            }
        }

        // ---------- storage helpers ----------
        saveSetting(key, value) {
            try { localStorage.setItem(key, String(value)); } catch (e) {}
        }
        loadSetting(key, fallback) {
            try {
                const v = localStorage.getItem(key);
                if (v === null || v === undefined) return fallback;
                if (typeof fallback === 'boolean') return v === 'true';
                if (fallback === '') return v;
                const n = Number(v);
                return Number.isFinite(n) ? n : v;
            } catch (e) { return fallback; }
        }
        // getters
        getMCWait() { return Number(this.loadSetting(this.settingsKeys.mc_wait, this.defaults.mc_wait)) || this.defaults.mc_wait; }
        getMCRandomPct() { return Number(this.loadSetting(this.settingsKeys.mc_random_pct, this.defaults.mc_random_pct)) || this.defaults.mc_random_pct; }
        getAIUseAPI() { return this.loadSetting(this.settingsKeys.ai_use_api, this.defaults.ai_use_api); }
        getAIUrl() { return this.loadSetting(this.settingsKeys.ai_url, this.defaults.ai_url); }
        getAIKey() { return this.loadSetting(this.settingsKeys.ai_key, ''); }
        getAIModel() { return this.loadSetting(this.settingsKeys.ai_model, this.defaults.ai_model); }

        getWMin() { return String(this.loadSetting(this.settingsKeys.w_min, this.defaults.w_min)); }
        getWMax() { return String(this.loadSetting(this.settingsKeys.w_max, this.defaults.w_max)); }
        getWLevel() { return String(this.loadSetting(this.settingsKeys.w_level, this.defaults.w_level)); }
        getWBlacklist() { return String(this.loadSetting(this.settingsKeys.w_blacklist, this.defaults.w_blacklist)); }
        getWLower() { return this.loadSetting(this.settingsKeys.w_lower, this.defaults.w_lower); }
        getWMood() { return String(this.loadSetting(this.settingsKeys.w_mood, this.defaults.w_mood)); }

        resetMCWait() { this.saveSetting(this.settingsKeys.mc_wait, this.defaults.mc_wait); }
        resetMCRandom() { this.saveSetting(this.settingsKeys.mc_random_pct, this.defaults.mc_random_pct); }

        // ---------- resource & element helpers ----------
        getUrl(path) {
            if (!path) return '';
            if (/^https?:\/\//i.test(path)) return path;
            return this.assetBase + path.replace(/^icons\//, '');
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

        // ---------- initialization ----------
        async init() {
            try {
                // attempt to load optional libs
                await Promise.resolve(this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js')).catch(() => {});
                await Promise.resolve(this.loadScript('https://unpkg.com/draggabilly@3/dist/draggabilly.pkgd.min.js')).catch(() => {});

                this.itemMetadata = {
                    UI: this.createUI(),
                    answerUI: this.createAnswerUI()
                };
                this.playIntroAnimation();
            } catch (err) {
                try {
                    this.itemMetadata = {
                        UI: this.createUI(),
                        answerUI: this.createAnswerUI()
                    };
                    this.showUI(true);
                } catch (e) { /* fallback ignore */ }
            }
        }

        // ---------- UI creation ----------
        createUI() {
            const container = this.createEl('div');

            const launcher = this.createEl('div', {
                id: 'Launcher',
                className: 'Launcher',
                style:
                    "min-height:160px;opacity:0;visibility:hidden;transition:opacity 0.25s ease,width 0.25s ease;font-family:'Nunito',sans-serif;width:180px;height:240px;background:#010203;position:fixed;border-radius:12px;border:2px solid #0a0b0f;display:flex;flex-direction:column;align-items:center;color:white;font-size:16px;top:50%;left:20px;transform:translateY(-50%);z-index:99999;padding:16px;box-shadow:0 10px 8px rgba(0,0,0,0.2), 0 0 8px rgba(255,255,255,0.05);overflow:hidden;white-space:nowrap;"
            });

            const dragHandle = this.createEl('div', {
                className: 'drag-handle',
                style: 'width:100%;height:24px;cursor:move;background:transparent;position:absolute;top:0;'
            });

            const eyeWrapper = this.createEl('div', {
                id: 'helperEye',
                style:
                    'width:90px;height:90px;margin-top:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;transform-style:preserve-3d;transition:all 0.12s linear;will-change:transform,top,right,width,height;transform-origin:50% 40%;pointer-events:none;'
            });

            const uiImg = this.createEl('img', {
                id: 'helperEyeImg',
                src: this.getUrl('sleep.gif'),
                dataset: { idle: this.getUrl('idle.gif'), tilt: this.getUrl('full.gif') },
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
                style: 'position:absolute;top:8px;right:8px;background:none;border:none;color:white;font-size:18px;cursor:pointer;padding:2px 8px;transition:color 0.12s ease, transform 0.1s ease;opacity:0.7;z-index:100005'
            });

            // Main action button (styled like settings)
            const getAnswerButton = this.createEl('button', {
                id: 'getAnswerButton',
                style:
                    'background:#151515;border:1px solid rgba(255,255,255,0.04);color:white;padding:10px 12px;border-radius:8px;cursor:pointer;margin-top:18px;width:140px;height:64px;font-size:14px;transition:background 0.14s ease, transform 0.08s ease, box-shadow 0.12s;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;'
            });

            // spinner element inside button
            const spinner = this.createEl('div', {
                id: 'ah-spinner',
                style: 'width:22px;height:22px;border-radius:50%;border:3px solid rgba(255,255,255,0.12);border-top-color:#ffffff;display:none;animation:ah-spin 0.85s cubic-bezier(.4,.0,.2,1) infinite;'
            });

            const buttonTextSpan = this.createEl('span', { text: 'work smArt-er', id: 'getAnswerButtonText', style: 'font-size:14px;line-height:1;user-select:none;' });

            getAnswerButton.appendChild(spinner);
            getAnswerButton.appendChild(buttonTextSpan);

            const version = this.createEl('div', { id: 'ah-version', style: 'position:absolute;bottom:8px;right:8px;font-size:12px;opacity:0.9;z-index:100005', text: '1.0' });

            // Settings cog (bottom-left)
            const settingsCog = this.createEl('button', {
                id: 'settingsCog',
                title: 'Settings',
                innerHTML: '⚙',
                style: 'position:absolute;bottom:8px;left:8px;background:none;border:none;color:#cfcfcf;font-size:16px;cursor:pointer;opacity:0.95;padding:2px;transition:transform .12s;z-index:100005'
            });

            // Back arrow (hidden by default)
            const settingsBack = this.createEl('button', {
                id: 'settingsBack',
                title: 'Back',
                innerHTML: '⟵',
                style: 'position:absolute;bottom:8px;left:8px;background:none;border:none;color:#ff4d4d;font-size:18px;cursor:pointer;opacity:0;display:none;padding:2px;transition:opacity .12s;z-index:100005'
            });

            // Settings container
            const settingsPanel = this.createEl('div', {
                id: 'settingsPanel',
                style: 'position:absolute;top:48px;left:12px;right:12px;bottom:48px;display:none;flex-direction:column;align-items:flex-start;gap:8px;overflow:auto;padding-right:8px;'
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

            // spinner keyframes and small hover rules
            this.applyStylesOnce('assessment-helper-spinner-styles', `
                @keyframes ah-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                #getAnswerButton.running { background: #1e1e1e; box-shadow: 0 4px 12px rgba(0,0,0,0.35); }
                #getAnswerButton.running span { font-size:12px; opacity:0.95; }
                #settingsPanel input[type="number"] { width:100px; padding:6px; border-radius:6px; border:1px solid rgba(255,255,255,0.08); background:transparent; color:white; }
                #settingsPanel textarea, #settingsPanel input[type="text"] { width:100%; padding:6px; border-radius:6px; border:1px solid rgba(255,255,255,0.08); background:transparent; color:white; }
                #settingsPanel label { font-size:13px; margin-right:6px; display:block; }
                .ah-reset { cursor:pointer; margin-left:8px; opacity:0.8; font-size:14px; user-select:none; }
                .ah-section-title { font-weight:700; margin-top:4px; margin-bottom:6px; font-size:14px; }
                #settingsPanel button { transition: background 0.12s ease, transform 0.08s ease; }
                #settingsPanel button:hover { background:#222; transform: translateY(-1px); }
                #getAnswerButton:hover { background: #1f1f1f !important; transform: translateY(-1px); }
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
                    "outline:none;min-height:60px;transform:translateX(0px) translateY(-50%);opacity:0;visibility:hidden;transition:opacity 0.3s ease, transform 0.3s ease;font-family:'Nunito',sans-serif;width:60px;height:60px;background:#1c1e2b;position:fixed;border-radius:8px;display:flex;justify-content:center;align-items:center;color:white;font-size:24px;top:50%;left:220px;z-index:99998;padding:8px;box-shadow:0 4px 8px rgba(0,0,0,0.2);overflow:hidden;white-space:normal;display:none;"
            });

            const dragHandle = this.createEl('div', { className: 'answer-drag-handle', style: 'width:100%;height:24px;cursor:move;background:transparent;position:absolute;top:0;' });
            const closeButton = this.createEl('button', { id: 'closeAnswerButton', style: 'position:absolute;top:8px;right:8px;background:none;border:none;color:white;font-size:18px;cursor:pointer;padding:2px 8px;transition:color 0.2s ease, transform 0.1s ease;' });
            const answerContent = this.createEl('div', { id: 'answerContent', style: 'padding:0;margin:0;word-wrap:break-word;font-size:18px;font-weight:bold;display:flex;justify-content:center;align-items:center;width:100%;height:100%;' });

            answerContainer.appendChild(dragHandle);
            answerContainer.appendChild(closeButton);
            answerContainer.appendChild(answerContent);
            container.appendChild(answerContainer);
            return container;
        }

        // ---------- intro & show ----------
        playIntroAnimation() {
            if (typeof anime === 'undefined') {
                this.showUI();
                return;
            }
            const imageUrl = this.getUrl('eyebackground.gif');
            const introImgElement = this.createEl('img', {
                src: imageUrl,
                id: 'introLoaderImage',
                style: 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.5);width:100px;height:auto;border-radius:12px;box-shadow:0 4px 8px rgba(0,0,0,0.2);z-index:100001;opacity:0;'
            });
            document.body.appendChild(introImgElement);

            anime.timeline({
                easing: 'easeInOutQuad',
                duration: 800,
                complete: () => { try { introImgElement.remove(); } catch (e) {} this.showUI(); }
            })
            .add({ targets: introImgElement, opacity: [0, 1], scale: [0.5, 1], rotate: '1turn', duration: 1000, easing: 'easeOutExpo' })
            .add({ targets: introImgElement, translateY: '-=20', duration: 500, easing: 'easeInOutSine' })
            .add({ targets: introImgElement, translateY: '+=20', duration: 500, easing: 'easeInOutSine' })
            .add({ targets: introImgElement, opacity: 0, duration: 500, easing: 'linear' }, '+=500');
        }

        showUI(skipAnimation = false) {
            try { document.body.appendChild(this.itemMetadata.UI); document.body.appendChild(this.itemMetadata.answerUI); } catch (e) {}
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
            setTimeout(() => { alertContainer.style.opacity = 0; alertContainer.addEventListener('transitionend', () => alertContainer.remove()); }, 5000);
        }

        // ---------- article fetch ----------
        async fetchArticleContent() {
            try {
                const articleContainer = document.querySelector('#start-reading');
                let articleContent = '';
                if (articleContainer) {
                    const paragraphs = articleContainer.querySelectorAll('p');
                    articleContent = Array.from(paragraphs).map((p) => p.textContent.trim()).join(' ');
                }

                const questionContainer = document.querySelector('#activity-component-react') || document.querySelector('#question-text');
                let questionContent = '';
                if (questionContainer) questionContent = questionContainer.textContent.trim();

                let writingQuestion = '';
                try {
                    const xpath = '//*[@id="before-reading-thought"]/div[1]/p/div';
                    const result = document.evaluate(xpath, document, null, XPathResult.STRING_TYPE, null);
                    writingQuestion = (result && result.stringValue) ? result.stringValue.trim() : '';
                } catch (e) {
                    writingQuestion = '';
                }

                const combinedContent = `${articleContent}\n\n${questionContent}\n\n${writingQuestion}`;
                this.cachedArticle = combinedContent;
                return combinedContent;
            } catch (err) {
                return '';
            }
        }

        // ---------- AI call (only user API) ----------
        async fetchAnswer(queryContent, retryCount = 0) {
            const MAX_RETRIES = 2;
            const RETRY_DELAY_MS = 1000;
            try {
                // Validate API settings
                const useApi = this.getAIUseAPI();
                const url = this.getAIUrl();
                const key = this.getAIKey();
                const model = this.getAIModel() || this.defaults.ai_model;

                if (!useApi || !url || !key) {
                    const msg = 'AI API not configured. Enable "Use API" and provide URL/key in AI settings.';
                    console.warn('[AssessmentHelper] fetchAnswer aborted:', msg);
                    return `Error: ${msg}`;
                }

                // abort previous if any
                if (this.currentAbortController) {
                    try { this.currentAbortController.abort(); } catch (e) {}
                }
                this.currentAbortController = new AbortController();
                const signal = this.currentAbortController.signal;

                // Build payload — attempt chat completions structure
                const body = JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: queryContent }]
                });

                const resp = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + key
                    },
                    body,
                    signal
                });

                this.currentAbortController = null;

                if (!resp.ok) {
                    const text = await resp.text().catch(() => '');
                    if (resp.status >= 500 && retryCount < MAX_RETRIES) {
                        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                        return this.fetchAnswer(queryContent, retryCount + 1);
                    }
                    throw new Error(`API error ${resp.status}: ${text}`);
                }

                const data = await resp.json().catch(() => null);
                // Try to extract response in common shapes
                // groq/openai-like: data.choices[0].message.content or data.choices[0].text or data.response
                if (data) {
                    if (data.choices && data.choices[0]) {
                        const ch = data.choices[0];
                        const msg = (ch.message && ch.message.content) || ch.text || ch.delta && ch.delta.content;
                        if (msg) return String(msg).trim();
                    }
                    if (data.response) return String(data.response).trim();
                    if (data.answer) return String(data.answer).trim();
                }
                return 'No answer available';
            } catch (err) {
                if (err && err.name === 'AbortError') return '<<ABORTED>>';
                return `Error: ${err && err.message ? err.message : String(err)}`;
            }
        }

        // ---------- Eye helpers ----------
        setEyeToSleep() {
            if (this.eyeState === 'full') return;
            try {
                this.clearCurrentVideo();
                const img = document.getElementById('helperEyeImg');
                const video = document.getElementById('helperEyeVideo');
                if (!img || !video) return;
                video.style.display = 'none';
                img.style.display = 'block';
                img.src = this.getUrl('sleep.gif');
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
                img.src = this.getUrl('full.gif') + '?r=' + Date.now();
            } catch (err) {}
        }

        async handleHoverEnter() {
            if (this.eyeState === 'full') return;
            try {
                await this.playVideoOnce(this.getUrl('wakeup.webm'));
                if (this.eyeState === 'full') return;
                const img = document.getElementById('helperEyeImg');
                const video = document.getElementById('helperEyeVideo');
                if (!img || !video) return;
                video.style.display = 'none';
                img.style.display = 'block';
                img.src = this.getUrl('idle.gif') + '?r=' + Date.now();
                this.eyeState = 'idle';
            } catch (err) {}
        }

        async handleHoverLeave() {
            if (this.eyeState === 'full') return;
            try {
                await this.playVideoOnce(this.getUrl('gotosleep.webm'));
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

        // ---------- UI start/stop ----------
        async startProcessUI() {
            const btn = document.getElementById('getAnswerButton');
            const spinner = document.getElementById('ah-spinner');
            const label = document.getElementById('getAnswerButtonText');
            if (btn) btn.classList.add('running');
            if (spinner) spinner.style.display = 'block';
            if (label) label.textContent = 'stop.';
            try { console.log('[AssessmentHelper] started'); } catch (e) {}
        }

        async stopProcessUI() {
            const btn = document.getElementById('getAnswerButton');
            const spinner = document.getElementById('ah-spinner');
            const label = document.getElementById('getAnswerButtonText');
            if (btn) btn.classList.remove('running');
            if (spinner) spinner.style.display = 'none';
            if (label) label.textContent = 'work smArt-er';
            try { console.log('[AssessmentHelper] stopped'); } catch (e) {}

            try { await this.playVideoOnce(this.getUrl('gotosleep.webm')); } catch (e) {}
            this.setEyeToSleep();
        }

        stopProcessImmediate() {
            this.isRunning = false;
            if (this.currentAbortController) {
                try { this.currentAbortController.abort(); } catch (e) {}
                this.currentAbortController = null;
            }
        }

        // ---------- settings UI building ----------
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
                this._eyeOriginal = {
                    style: eye.getAttribute('style') || '',
                    parentDisplay: eye.style.display || ''
                };
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

            const mcBtn = this.createEl('button', {
                id: 'mcSettingsBtn',
                text: 'Multiple Choice Settings',
                style: 'padding:10px 12px;border-radius:8px;background:#151515;border:1px solid rgba(255,255,255,0.04);color:white;cursor:pointer;'
            });

            const wrBtn = this.createEl('button', {
                id: 'writingSettingsBtn',
                text: 'Writing Settings',
                style: 'padding:10px 12px;border-radius:8px;background:#151515;border:1px solid rgba(255,255,255,0.04);color:white;cursor:pointer;'
            });

            const aiBtn = this.createEl('button', {
                id: 'aiSettingsBtn',
                text: 'AI Settings',
                style: 'padding:10px 12px;border-radius:8px;background:#151515;border:1px solid rgba(255,255,255,0.04);color:white;cursor:pointer;'
            });

            panel.appendChild(mcBtn);
            panel.appendChild(wrBtn);
            panel.appendChild(aiBtn);

            mcBtn.addEventListener('click', (e) => { e.preventDefault(); this.openMCSettings(); });
            wrBtn.addEventListener('click', (e) => { e.preventDefault(); this.openWritingSettings(); });
            aiBtn.addEventListener('click', (e) => { e.preventDefault(); this.openAISettings(); });
        }

        openSettingsMenu() {
            const launcher = document.getElementById('Launcher');
            if (!launcher) return;
            const btn = document.getElementById('getAnswerButton');

            const expandRight = this._computeExpandRight();
            this._setLauncherWidthAndAnchor(360, expandRight);

            this._shrinkEyeToTopRight();

            if (btn) { btn.style.transition = 'opacity 0.12s'; btn.style.opacity = '0'; setTimeout(()=>btn.style.display='none',140); }

            const panel = document.getElementById('settingsPanel');
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
            const waitLabel = this.createEl('label', { text: 'Wait time (ms):', style: 'min-width:140px;' });
            const waitInput = this.createEl('input', { type: 'number', id: 'mcWaitInput', value: String(this.getMCWait()), style: '' });
            const waitReset = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Reset to default' });
            waitReset.addEventListener('click', () => { this.resetMCWait(); waitInput.value = String(this.getMCWait()); });
            waitInput.addEventListener('change', () => { const v = Number(waitInput.value) || this.defaults.mc_wait; this.saveSetting(this.settingsKeys.mc_wait, v); });

            waitRow.appendChild(waitLabel); waitRow.appendChild(waitInput); waitRow.appendChild(waitReset);
            panel.appendChild(waitRow);

            const probRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
            const probLabel = this.createEl('label', { text: 'Random answer %:', style: 'min-width:140px;' });
            const probInput = this.createEl('input', { type: 'number', id: 'mcRandomInput', value: String(this.getMCRandomPct()), min:0, max:100 });
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

            const note = this.createEl('div', { text: 'Tip: set random % to >0 if you want occasional wrong answers to mimic real users.', style: 'font-size:12px;opacity:0.8;margin-top:8px;' });
            panel.appendChild(note);
        }

        openWritingSettings() {
            const panel = document.getElementById('settingsPanel');
            const expandRight = this._computeExpandRight();
            this._setLauncherWidthAndAnchor(520, expandRight);
            this.settingsState = 'writing';
            if (!panel) return;
            panel.innerHTML = '';

            const title = this.createEl('div', { className: 'ah-section-title', text: 'Writing Settings' });
            panel.appendChild(title);

            // min words
            const minRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
            const minLabel = this.createEl('label', { text: 'Minimum words:', style: 'min-width:140px;' });
            const minInput = this.createEl('input', { type: 'number', id: 'wMinInput', value: String(this.getWMin()) });
            const minReset = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Reset' });
            minReset.addEventListener('click', () => { this.saveSetting(this.settingsKeys.w_min, ''); minInput.value = ''; });
            minInput.addEventListener('change', () => { this.saveSetting(this.settingsKeys.w_min, minInput.value.trim()); });

            minRow.appendChild(minLabel); minRow.appendChild(minInput); minRow.appendChild(minReset);
            panel.appendChild(minRow);

            // max words
            const maxRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
            const maxLabel = this.createEl('label', { text: 'Maximum words:', style: 'min-width:140px;' });
            const maxInput = this.createEl('input', { type: 'number', id: 'wMaxInput', value: String(this.getWMax()) });
            const maxReset = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Reset' });
            maxReset.addEventListener('click', () => { this.saveSetting(this.settingsKeys.w_max, ''); maxInput.value = ''; });
            maxInput.addEventListener('change', () => { this.saveSetting(this.settingsKeys.w_max, maxInput.value.trim()); });

            maxRow.appendChild(maxLabel); maxRow.appendChild(maxInput); maxRow.appendChild(maxReset);
            panel.appendChild(maxRow);

            // english level dropdown
            const levelRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
            const levelLabel = this.createEl('label', { text: 'English level:', style: 'min-width:140px;' });
            const levelSelect = this.createEl('select', { id: 'wLevelSelect' });
            ['A1','A2','B1','B2','C1','C2'].forEach(l => {
                const opt = document.createElement('option');
                opt.value = l;
                opt.text = l;
                if (l === this.getWLevel()) opt.selected = true;
                levelSelect.appendChild(opt);
            });
            levelSelect.addEventListener('change', () => this.saveSetting(this.settingsKeys.w_level, levelSelect.value));

            levelRow.appendChild(levelLabel); levelRow.appendChild(levelSelect);
            panel.appendChild(levelRow);

            // blacklist characters
            const blackRow = this.createEl('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-bottom:8px;width:100%;' });
            const blackLabel = this.createEl('label', { text: 'Blacklist characters (remove from AI output):', style: 'min-width:140px;' });
            const blackInput = this.createEl('input', { type: 'text', id: 'wBlacklist', value: this.getWBlacklist() });
            blackInput.addEventListener('change', () => this.saveSetting(this.settingsKeys.w_blacklist, blackInput.value || ''));
            blackRow.appendChild(blackLabel); blackRow.appendChild(blackInput);
            panel.appendChild(blackRow);

            // lowercase checkbox
            const lowerRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
            const lowerLabel = this.createEl('label', { text: 'Only lowercase output:', style: 'min-width:140px;' });
            const lowerInput = this.createEl('input', { type: 'checkbox', id: 'wLower' });
            lowerInput.checked = this.getWLower();
            lowerInput.addEventListener('change', () => this.saveSetting(this.settingsKeys.w_lower, lowerInput.checked));
            lowerRow.appendChild(lowerLabel); lowerRow.appendChild(lowerInput);
            panel.appendChild(lowerRow);

            // mood / style box
            const moodRow = this.createEl('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-bottom:8px;width:100%;' });
            const moodLabel = this.createEl('label', { text: 'Writing style / mood (appended to prompt):', style: 'min-width:140px;' });
            const moodInput = this.createEl('textarea', { id: 'wMood', rows: 3, text: this.getWMood() });
            moodInput.addEventListener('change', () => this.saveSetting(this.settingsKeys.w_mood, moodInput.value || ''));
            moodRow.appendChild(moodLabel); moodRow.appendChild(moodInput);
            panel.appendChild(moodRow);

            const note = this.createEl('div', { text: 'Settings are stored locally in your browser and applied client-side to AI output.', style: 'font-size:12px;opacity:0.8;margin-top:6px;' });
            panel.appendChild(note);
        }

        openAISettings() {
            const panel = document.getElementById('settingsPanel');
            const expandRight = this._computeExpandRight();
            this._setLauncherWidthAndAnchor(520, expandRight);
            this.settingsState = 'ai';
            if (!panel) return;
            panel.innerHTML = '';

            const title = this.createEl('div', { className: 'ah-section-title', text: 'AI Settings' });
            panel.appendChild(title);

            // Use API toggle
            const useRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
            const useLabel = this.createEl('label', { text: 'Use API method (must set URL & key):', style: 'min-width:140px;' });
            const useInput = this.createEl('input', { type: 'checkbox', id: 'aiUseApi' });
            useInput.checked = this.getAIUseAPI();
            useInput.addEventListener('change', () => this.saveSetting(this.settingsKeys.ai_use_api, useInput.checked));
            useRow.appendChild(useLabel); useRow.appendChild(useInput);
            panel.appendChild(useRow);

            // URL input (saved)
            const urlRow = this.createEl('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-bottom:8px;width:100%;' });
            const urlLabel = this.createEl('label', { text: 'API URL:', style: 'min-width:140px;' });
            const urlInput = this.createEl('input', { type: 'text', id: 'aiUrl', value: this.getAIUrl() });
            urlInput.addEventListener('change', () => this.saveSetting(this.settingsKeys.ai_url, urlInput.value.trim()));
            urlRow.appendChild(urlLabel); urlRow.appendChild(urlInput);
            panel.appendChild(urlRow);

            // Key input (sensitive, stored locally)
            const keyRow = this.createEl('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-bottom:8px;width:100%;' });
            const keyLabel = this.createEl('label', { text: 'API Key (stored locally):', style: 'min-width:140px;' });
            const keyInput = this.createEl('input', { type: 'text', id: 'aiKey', value: this.getAIKey() });
            keyInput.addEventListener('change', () => this.saveSetting(this.settingsKeys.ai_key, keyInput.value.trim()));
            keyRow.appendChild(keyLabel); keyRow.appendChild(keyInput);
            panel.appendChild(keyRow);

            // Model input
            const modelRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
            const modelLabel = this.createEl('label', { text: 'Model:', style: 'min-width:140px;' });
            const modelInput = this.createEl('input', { type: 'text', id: 'aiModel', value: this.getAIModel() });
            modelInput.addEventListener('change', () => this.saveSetting(this.settingsKeys.ai_model, modelInput.value.trim()));
            modelRow.appendChild(modelLabel); modelRow.appendChild(modelInput);
            panel.appendChild(modelRow);

            const note = this.createEl('div', { text: 'Default mode: API method using your URL/key. Keep these safe.', style: 'font-size:12px;opacity:0.85;margin-top:6px;' });
            panel.appendChild(note);
        }

        backFromSettings() {
            const launcher = document.getElementById('Launcher');
            const btn = document.getElementById('getAnswerButton');
            const settingsPanel = document.getElementById('settingsPanel');
            const settingsCog = document.getElementById('settingsCog');
            const settingsBack = document.getElementById('settingsBack');

            if (this.settingsState === 'mc' || this.settingsState === 'writing' || this.settingsState === 'ai') {
                // shrink to menu view
                const expandRight = this._computeExpandRight();
                this._setLauncherWidthAndAnchor(360, expandRight);
                this.settingsState = 'menu';
                this.buildSettingsMenu();
                return;
            }

            if (this.settingsState === 'menu') {
                // hide panel
                if (settingsPanel) { settingsPanel.style.display = 'none'; settingsPanel.innerHTML = ''; }
                // restore main button with fade
                if (btn) { btn.style.display = 'flex'; setTimeout(()=>btn.style.opacity='1',10); }
                // restore cog/back
                if (settingsBack) { settingsBack.style.opacity = '0'; setTimeout(()=>settingsBack.style.display='none',120); }
                if (settingsCog) settingsCog.style.display = 'block';
                // shrink launcher back to default 180
                const expandRight = this._computeExpandRight();
                this._setLauncherWidthAndAnchor(180, expandRight);
                // restore eye
                this._restoreEyeFromShrink();
                this.settingsState = 'closed';
                return;
            }
        }

        // ---------- event wiring & behavior ----------
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
                    .answerLauncher.show { opacity: 1; visibility: visible; transform: translateY(-50%) scale(1); display:flex !important; }
                `);

                if (typeof Draggabilly !== 'undefined') {
                    try { new Draggabilly(launcher, { handle: '.drag-handle', delay: 50 }); } catch (e) {}
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

                // CLOSE: remove DOM & clear singleton so re-inject works
                if (closeButton) {
                    closeButton.addEventListener('click', () => {
                        try {
                            const launcherEl = document.getElementById('Launcher');
                            if (launcherEl && launcherEl.parentNode) launcherEl.parentNode.removeChild(launcherEl);
                            const answerWrap = document.querySelector('#answerContainer') && document.querySelector('#answerContainer').parentNode;
                            if (answerWrap && answerWrap.parentNode) answerWrap.parentNode.removeChild(answerWrap);
                        } catch (e) {}
                        // clear instance
                        try { window.__AssessmentHelperInstance = null; } catch (e) {}
                        this._alive = false;
                    });
                    closeButton.addEventListener('mousedown', () => (closeButton.style.transform = 'scale(0.95)'));
                    closeButton.addEventListener('mouseup', () => (closeButton.style.transform = 'scale(1)'));
                }

                if (closeAnswerButton) {
                    closeAnswerButton.addEventListener('click', () => {
                        answerContainer.style.opacity = 0;
                        answerContainer.style.transform = 'translateY(-50%) scale(0.8)';
                        answerContainer.addEventListener('transitionend', function handler() {
                            try {
                                if (parseFloat(answerContainer.style.opacity) === 0) {
                                    answerContainer.style.display = 'none';
                                    answerContainer.style.visibility = 'hidden';
                                    answerContainer.style.transform = 'translateY(-50%) scale(1)';
                                }
                            } catch (e) {}
                            try { answerContainer.removeEventListener('transitionend', handler); } catch (e) {}
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
                        // Validate API configured
                        if (!this.getAIUseAPI() || !this.getAIUrl() || !this.getAIKey()) {
                            this.showAlert('AI not configured. Open AI Settings and provide URL & Key.', 'error');
                            return;
                        }
                        this.isRunning = true;
                        this._stoppedByWrite = false;
                        await this.startProcessUI();
                        try { this.setEyeToFull(); } catch (e) {}
                        this.runSolverLoop();
                    } else {
                        this.stopProcessImmediate();
                        await this.stopProcessUI();
                    }
                });

                // Settings wiring
                const settingsCog = document.getElementById('settingsCog');
                const settingsBack = document.getElementById('settingsBack');
                if (settingsCog) settingsCog.addEventListener('click', (e) => { e.preventDefault(); this.openSettingsMenu(); });
                if (settingsBack) settingsBack.addEventListener('click', (e) => { e.preventDefault(); this.backFromSettings(); });

            } catch (e) {
                console.error('[AssessmentHelper] setupEventListeners error', e);
            }
        }

        // ---------- utilities for writing postprocess ----------
        applyWritingPostProcess(text) {
            let out = String(text || '');

            // blacklist characters: remove all occurrences
            const blacklist = this.getWBlacklist() || '';
            if (blacklist && blacklist.length > 0) {
                // treat as literal characters to remove
                const uniqueChars = Array.from(new Set(blacklist.split('')));
                const regex = new RegExp('[' + uniqueChars.map(c => {
                    // escape regexp special
                    return c.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
                }).join('') + ']', 'g');
                out = out.replace(regex, '');
            }

            // lowercase if requested
            if (this.getWLower()) {
                out = out.toLowerCase();
            }

            return out;
        }

        buildWritingPromptSuffix() {
            const parts = [];
            const min = String(this.getWMin()).trim();
            const max = String(this.getWMax()).trim();
            if (min) parts.push(`Use minimum ${min} words.`);
            if (max) parts.push(`Use maximum ${max} words.`);
            const level = String(this.getWLevel()).trim();
            if (level) parts.push(`Use English level ${level} (CEFR).`);
            const mood = String(this.getWMood()).trim();
            if (mood) parts.push(mood);
            if (parts.length > 0) return parts.join(' ');
            return '';
        }

        // ---------- special Ready/Reflect handling ----------
        _isReadyOrReflectUrl() {
            const href = location.href || '';
            return href.includes('lesson/ready') || href.includes('lesson/reflect');
        }

        _readReadyReflectQuestion() {
            try {
                const xpath = '//*[@id="before-reading-poll"]/div[1]/p[2]/div/text()';
                const result = document.evaluate(xpath, document, null, XPathResult.STRING_TYPE, null);
                return result && result.stringValue ? result.stringValue.trim() : '';
            } catch (e) { return ''; }
        }

        _getReadyReflectRadioInputs() {
            try {
                const agreeXPath = '//*[@id="before-reading-poll"]/div[1]/fieldset/div/label[1]/span[1]/input';
                const disagreeXPath = '//*[@id="before-reading-poll"]/div[1]/fieldset/div/label[2]/span[1]/input';
                const agreeNode = document.evaluate(agreeXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                const disagreeNode = document.evaluate(disagreeXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                return { agree: agreeNode || null, disagree: disagreeNode || null };
            } catch (e) { return { agree: null, disagree: null }; }
        }

        // ---------- solver loop ----------
        async runSolverLoop() {
            const attemptOnce = async (excludedAnswers = []) => {
                if (!this.isRunning) return false;
                try {
                    let queryContent = await this.fetchArticleContent();

                    // special ready/reflect flow
                    if (this._isReadyOrReflectUrl()) {
                        const questionText = this._readReadyReflectQuestion();
                        const radios = this._getReadyReflectRadioInputs();
                        const tinyIframe = document.querySelector('.tox-edit-area__iframe');
                        const plainTextarea = document.querySelector('textarea');
                        const contentEditable = document.querySelector('[contenteditable="true"]');
                        const writingTarget = tinyIframe || plainTextarea || contentEditable || null;

                        // prepare prompt for agree/disagree decision
                        let prompt = `${queryContent}\n\nQuestion: ${questionText}\n\nIs the student likely to AGREE or DISAGREE with the statement? Provide just the single word "AGREE" or "DISAGREE". Then write a short reason in one paragraph.`;
                        const suffix = this.buildWritingPromptSuffix();
                        if (suffix) prompt += '\n\n' + suffix;

                        // Log what we sent (expandable)
                        try {
                            console.groupCollapsed('[AssessmentHelper] Sent (Ready/Reflect) payload');
                            console.log({ q: prompt, article: this.cachedArticle || null });
                            console.groupEnd();
                        } catch (e) {}

                        const aiReply = await this.fetchAnswer(prompt);
                        try {
                            console.groupCollapsed('[AssessmentHelper] Received (Ready/Reflect) answer');
                            console.log({ raw: aiReply });
                            console.groupEnd();
                        } catch (e) {}

                        if (!this.isRunning) return false;

                        // Interpret reply: check starts with AGREE/DISAGREE
                        const normalized = String(aiReply || '').trim();
                        const firstToken = normalized.split(/\s+/)[0].toUpperCase();
                        const chosen = (firstToken === 'AGREE' || firstToken === 'DISAGREE') ? firstToken : null;

                        // If radio exists, click it then write reason in tiny iframe if present
                        if ((radios.agree || radios.disagree) && chosen) {
                            try {
                                if (chosen === 'AGREE' && radios.agree) radios.agree.click();
                                if (chosen === 'DISAGREE' && radios.disagree) radios.disagree.click();
                            } catch (e) {}

                            // extract reason: remove the leading token word
                            let reason = normalized;
                            if (chosen) reason = normalized.replace(new RegExp('^' + chosen, 'i'), '').trim();
                            if (!reason) {
                                // if no reason included, ask the model for a short justification
                                const justPrompt = `${queryContent}\n\nQuestion: ${questionText}\n\nYou selected ${chosen}. Please give a short reason (one paragraph). ${this.buildWritingPromptSuffix() || ''}`;
                                const justReply = await this.fetchAnswer(justPrompt);
                                reason = String(justReply || '').trim();
                            }

                            // apply post-process
                            reason = this.applyWritingPostProcess(reason);

                            // write into tiny iframe or textarea
                            try {
                                if (tinyIframe) {
                                    const iframeDoc = tinyIframe.contentDocument || tinyIframe.contentWindow.document;
                                    if (iframeDoc) {
                                        iframeDoc.body.innerHTML = reason;
                                        setTimeout(() => {
                                            iframeDoc.body.innerHTML += " ";
                                            iframeDoc.body.dispatchEvent(new Event('input', { bubbles: true }));
                                        }, 400);
                                    }
                                } else if (plainTextarea) {
                                    plainTextarea.value = reason;
                                    plainTextarea.dispatchEvent(new Event('input', { bubbles: true }));
                                } else if (contentEditable) {
                                    contentEditable.innerHTML = reason;
                                    contentEditable.dispatchEvent(new Event('input', { bubbles: true }));
                                }
                            } catch (e) {}

                            // Do NOT submit — per user request
                            this._stoppedByWrite = true;
                            this.isRunning = false;
                            try { await this.stopProcessUI(); } catch (e) {}
                            return false;
                        } else {
                            // If no radios or can't interpret, fallback to writing into editor if present
                            if (writingTarget) {
                                // use aiReply as answer
                                let reason = this.applyWritingPostProcess(aiReply);

                                try {
                                    if (tinyIframe) {
                                        const iframeDoc = tinyIframe.contentDocument || tinyIframe.contentWindow.document;
                                        if (iframeDoc) {
                                            iframeDoc.body.innerHTML = reason;
                                            setTimeout(() => {
                                                iframeDoc.body.innerHTML += " ";
                                                iframeDoc.body.dispatchEvent(new Event('input', { bubbles: true }));
                                            }, 400);
                                        }
                                    } else if (plainTextarea) {
                                        plainTextarea.value = reason;
                                        plainTextarea.dispatchEvent(new Event('input', { bubbles: true }));
                                    } else if (contentEditable) {
                                        contentEditable.innerHTML = reason;
                                        contentEditable.dispatchEvent(new Event('input', { bubbles: true }));
                                    }
                                } catch (e) {}

                                this._stoppedByWrite = true;
                                this.isRunning = false;
                                try { await this.stopProcessUI(); } catch (e) {}
                                return false;
                            } else {
                                // no writing target nor radios — stop
                                this._stoppedByWrite = true;
                                this.isRunning = false;
                                try { await this.stopProcessUI(); } catch (e) {}
                                return false;
                            }
                        }
                    } // end ready/reflect flow

                    // Not ready/reflect: check for writing box (tinyMCE or textarea or contenteditable)
                    const tinyIframe = document.querySelector('.tox-edit-area__iframe');
                    const plainTextarea = document.querySelector('textarea');
                    const contentEditable = document.querySelector('[contenteditable="true"]');
                    const writingTarget = tinyIframe || plainTextarea || contentEditable || null;

                    if (writingTarget) {
                        // Building writing prompt
                        let prompt = `${queryContent}\n\nPlease provide a detailed written answer based on the above article and question.`;
                        const suffix = this.buildWritingPromptSuffix();
                        if (suffix) prompt += '\n\n' + suffix;

                        // log sent
                        try {
                            console.groupCollapsed('[AssessmentHelper] Sent (writing) payload');
                            console.log({ q: prompt, article: this.cachedArticle || null });
                            console.groupEnd();
                        } catch (e) {}

                        const answerText = await this.fetchAnswer(prompt);

                        try {
                            console.groupCollapsed('[AssessmentHelper] Received (writing) answer');
                            console.log({ raw: answerText });
                            console.groupEnd();
                        } catch (e) {}

                        if (!this.isRunning) return false;

                        let processed = this.applyWritingPostProcess(answerText);

                        try {
                            if (tinyIframe) {
                                const iframeDoc = tinyIframe.contentDocument || tinyIframe.contentWindow.document;
                                if (iframeDoc) {
                                    iframeDoc.body.innerHTML = processed;
                                    setTimeout(() => {
                                        iframeDoc.body.innerHTML += " ";
                                        iframeDoc.body.dispatchEvent(new Event('input', { bubbles: true }));
                                    }, 400);
                                } else {
                                    throw new Error('Unable to access iframe document');
                                }
                            } else if (plainTextarea) {
                                plainTextarea.value = processed;
                                plainTextarea.dispatchEvent(new Event('input', { bubbles: true }));
                            } else if (contentEditable) {
                                contentEditable.innerHTML = processed;
                                contentEditable.dispatchEvent(new Event('input', { bubbles: true }));
                            }

                            // stop after insertion
                            this._stoppedByWrite = true;
                            this.isRunning = false;
                            try { await this.stopProcessUI(); } catch (e) {}
                            return false;
                        } catch (e) {
                            const answerContainerEl = document.getElementById('answerContainer');
                            const answerContentEl = answerContainerEl ? answerContainerEl.querySelector('#answerContent') : null;
                            if (answerContentEl) answerContentEl.textContent = String(answerText || '');
                            if (answerContainerEl) { answerContainerEl.style.display = 'flex'; answerContainerEl.style.visibility = 'visible'; answerContainerEl.classList.add('show'); }
                            this._stoppedByWrite = true;
                            this.isRunning = false;
                            try { await this.stopProcessUI(); } catch (e2) {}
                            return false;
                        }
                    } else {
                        // Multiple choice flow
                        queryContent += "\n\nPROVIDE ONLY A ONE-LETTER ANSWER THAT'S IT NOTHING ELSE (A, B, C, or D).";
                        if (excludedAnswers.length > 0) queryContent += `\n\nDo not pick letter ${excludedAnswers.join(', ')}.`;

                        try {
                            console.groupCollapsed('[AssessmentHelper] Sent (MC) payload');
                            console.log({ q: queryContent, article: this.cachedArticle || null });
                            console.groupEnd();
                        } catch (e) {}

                        const randPct = this.getMCRandomPct();
                        let willRandom = false;
                        try { if (randPct > 0) willRandom = (Math.random() * 100) < randPct; } catch (e) { willRandom = false; }

                        let answer = null;
                        if (willRandom) {
                            const letters = ['A', 'B', 'C', 'D'].filter(l => !excludedAnswers.includes(l));
                            const options = document.querySelectorAll('[role="radio"]');
                            let chosenLetter = null;
                            if (options && options.length > 0) {
                                const available = letters.map(l => l.charCodeAt(0) - 'A'.charCodeAt(0)).filter(i => options[i]);
                                if (available.length > 0) {
                                    const idx = available[Math.floor(Math.random() * available.length)];
                                    chosenLetter = String.fromCharCode('A'.charCodeAt(0) + idx);
                                } else {
                                    chosenLetter = letters[Math.floor(Math.random() * letters.length)];
                                }
                            } else {
                                chosenLetter = letters[Math.floor(Math.random() * letters.length)];
                            }
                            answer = chosenLetter;
                            try {
                                console.groupCollapsed('[AssessmentHelper] Random MC decision');
                                console.log({ pct: randPct, chosen: chosenLetter });
                                console.groupEnd();
                            } catch (e) {}
                        } else {
                            answer = await this.fetchAnswer(queryContent);
                            try {
                                console.groupCollapsed('[AssessmentHelper] Received (MC) answer');
                                console.log({ raw: answer });
                                console.groupEnd();
                            } catch (e) {}
                        }

                        if (!this.isRunning) return false;

                        const normalized = (answer || '').trim().toUpperCase();
                        const answerContainerEl = document.getElementById('answerContainer');
                        const answerContentEl = answerContainerEl ? answerContainerEl.querySelector('#answerContent') : null;
                        if (answerContentEl) answerContentEl.textContent = normalized || answer;
                        if (answerContainerEl) { answerContainerEl.style.display = 'flex'; answerContainerEl.style.visibility = 'visible'; answerContainerEl.classList.add('show'); }

                        if (['A','B','C','D'].includes(normalized) && !excludedAnswers.includes(normalized)) {
                            const options = document.querySelectorAll('[role="radio"]');
                            const index = normalized.charCodeAt(0) - 'A'.charCodeAt(0);
                            if (options[index]) {
                                options[index].click();
                                await new Promise(r => setTimeout(r, 500));
                                if (!this.isRunning) return false;
                                const submitButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Submit');
                                if (submitButton) {
                                    submitButton.click();
                                    await new Promise(r => setTimeout(r, 1000));
                                    if (!this.isRunning) return false;
                                    const nextButton = document.getElementById('feedbackActivityFormBtn');
                                    if (nextButton) {
                                        const buttonText = nextButton.textContent.trim();
                                        nextButton.click();
                                        if (buttonText === 'Try again') {
                                            await new Promise(r => setTimeout(r, 1000));
                                            if (!this.isRunning) return false;
                                            return await attemptOnce([...excludedAnswers, normalized]);
                                        } else {
                                            await new Promise(r => setTimeout(r, 1500));
                                            const newQuestionRadio = document.querySelector('[role="radio"]');
                                            const newSubmitButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Submit');
                                            if (newSubmitButton && newQuestionRadio) {
                                                if (!this.isRunning) return false;
                                                return true;
                                            } else {
                                                if (answerContentEl) answerContentEl.textContent = 'Processing complete or no more questions found.';
                                                return false;
                                            }
                                        }
                                    } else {
                                        if (answerContentEl) answerContentEl.textContent = 'Submit processed, but next step button not found.';
                                        return false;
                                    }
                                } else {
                                    if (answerContentEl) answerContentEl.textContent = 'Error: Submit button not found.';
                                    return false;
                                }
                            } else {
                                if (answerContentEl) answerContentEl.textContent = `Error: Option ${normalized} not found on page.`;
                                return false;
                            }
                        } else {
                            if (answerContentEl) answerContentEl.textContent = `Model returned: ${answer || 'No valid single letter'}`;
                            return false;
                        }
                    }
                } catch (err) {
                    if (String(err && err.message || '').toLowerCase().includes('aborted') || (String(err) === 'Error: <<ABORTED>>')) {
                        return false;
                    }
                    const answerContainerEl = document.getElementById('answerContainer');
                    const answerContentEl = answerContainerEl ? answerContainerEl.querySelector('#answerContent') : null;
                    if (answerContentEl) answerContentEl.textContent = `Error: ${err && err.message ? err.message : String(err)}`;
                    if (answerContainerEl) { answerContainerEl.style.display = 'flex'; answerContainerEl.style.visibility = 'visible'; answerContainerEl.classList.add('show'); }
                    return false;
                }
            };

            try {
                while (this.isRunning) {
                    const cont = await attemptOnce();
                    if (!this.isRunning) break;
                    if (!cont) break;
                    const waitMs = Number(this.getMCWait()) || this.defaults.mc_wait;
                    await new Promise(r => setTimeout(r, waitMs));
                }
            } finally {
                if (!this._stoppedByWrite) {
                    this.isRunning = false;
                    const spinnerEl = document.getElementById('ah-spinner');
                    if (spinnerEl) spinnerEl.style.display = 'none';
                    try { await this.playVideoOnce(this.getUrl('gotosleep.webm')); } catch (e) {}
                    this.setEyeToSleep();
                    try { console.log('[AssessmentHelper] stopped'); } catch (e) {}
                    const label = document.getElementById('getAnswerButtonText');
                    if (label) label.textContent = 'work smArt-er';
                    const btn = document.getElementById('getAnswerButton');
                    if (btn) btn.classList.remove('running');
                } else {
                    this._stoppedByWrite = false;
                }
            }
        }
    }

    // instantiate
    try {
        const instance = new AssessmentHelper();
        console.log('[AssessmentHelper] instantiated');
    } catch (e) {
        console.error('[AssessmentHelper] failed to instantiate', e);
    }
})();
