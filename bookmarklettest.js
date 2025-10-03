// Full AssessmentHelper with AI Settings + Groq chat-completion support
(function () {
    try { console.clear(); } catch (e) {}
    console.log('[AssessmentHelper] injected');

    try {
        if (document.getElementById('Launcher')) {
            return;
        }
    } catch (e) {}

    class AssessmentHelper {
        constructor() {
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

            this.animeScriptUrl = 'https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js';
            this.draggabillyScriptUrl = 'https://unpkg.com/draggabilly@3/dist/draggabilly.pkgd.min.js';

            // cloudflare URL (default "url method")
            this.askEndpoint = 'https://f-ghos-insights-pressed.trycloudflare.com/ask';
            this.dataEndpoint = 'https://f-ghos-insights-pressed.trycloudflare.com/data';

            this.assetBase = 'https://raw.githubusercontent.com/ARDARYUS/a3kbookmarklet/main/icons/';

            // Settings keys & defaults
            this.settingsKeys = {
                mc_wait: 'ah_mc_wait_ms',
                mc_random_pct: 'ah_mc_random_pct',
                ai_use_api: 'ah_ai_use_api',
                ai_groq_url: 'ah_ai_groq_url',
                ai_groq_key: 'ah_ai_groq_key',
                ai_groq_model: 'ah_ai_groq_model'
            };
            this.defaults = {
                mc_wait: 300,
                mc_random_pct: 0,
                ai_groq_model: 'llama-3.1-8b-instant',
                // default storage for groq url if user chooses API - empty by default
                ai_groq_url: ''
            };

            // UI state for settings: 'closed' | 'menu' | 'mc' | 'writing' | 'ai'
            this.settingsState = 'closed';

            // store original eye style so we can restore after settings
            this._eyeOriginal = null;

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.init());
            } else {
                this.init();
            }
        }

        // -------- utility: settings storage --------
        saveSetting(key, value) {
            try { localStorage.setItem(key, String(value)); } catch (e) {}
        }
        loadSetting(key, fallback) {
            try {
                const v = localStorage.getItem(key);
                if (v === null || v === undefined) return fallback;
                // boolean stored as "true"/"false" handled by caller
                return v;
            } catch (e) { return fallback; }
        }
        loadNumberSetting(key, fallback) {
            try {
                const v = localStorage.getItem(key);
                if (v === null || v === undefined) return fallback;
                const n = Number(v);
                return Number.isFinite(n) ? n : fallback;
            } catch (e) { return fallback; }
        }

        getMCWait() { return this.loadNumberSetting(this.settingsKeys.mc_wait, this.defaults.mc_wait); }
        getMCRandomPct() { return this.loadNumberSetting(this.settingsKeys.mc_random_pct, this.defaults.mc_random_pct); }
        resetMCWait() { this.saveSetting(this.settingsKeys.mc_wait, this.defaults.mc_wait); }
        resetMCRandom() { this.saveSetting(this.settingsKeys.mc_random_pct, this.defaults.mc_random_pct); }

        // AI settings helpers
        setUseGroqApi(b) { this.saveSetting(this.settingsKeys.ai_use_api, b ? 'true' : 'false'); }
        getUseGroqApi() {
            const v = this.loadSetting(this.settingsKeys.ai_use_api, 'false');
            return String(v) === 'true';
        }
        setGroqUrl(u) { try { this.saveSetting(this.settingsKeys.ai_groq_url, u || ''); } catch (e) {} }
        getGroqUrl() { return this.loadSetting(this.settingsKeys.ai_groq_url, this.defaults.ai_groq_url) || ''; }
        setGroqKey(k) { try { this.saveSetting(this.settingsKeys.ai_groq_key, k || ''); } catch (e) {} }
        getGroqKey() { return this.loadSetting(this.settingsKeys.ai_groq_key, '') || ''; }
        setGroqModel(m) { try { this.saveSetting(this.settingsKeys.ai_groq_model, m || this.defaults.ai_groq_model); } catch (e) {} }
        getGroqModel() { return this.loadSetting(this.settingsKeys.ai_groq_model, this.defaults.ai_groq_model) || this.defaults.ai_groq_model; }

        // -------- resources & element helpers --------
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

        // -------- init / UI creation --------
        async init() {
            try {
                await Promise.resolve(this.loadScript(this.animeScriptUrl)).catch(() => {});
                await Promise.resolve(this.loadScript(this.draggabillyScriptUrl)).catch(() => {});

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
                } catch (e) {}
            }
        }

        createUI() {
            const container = this.createEl('div');

            const launcher = this.createEl('div', {
                id: 'Launcher',
                className: 'Launcher',
                style:
                    "min-height:160px;opacity:0;visibility:hidden;transition:opacity 0.25s ease,width 0.25s ease,font-size .12s ease;font-family:'Nunito',sans-serif;width:180px;height:240px;background:#010203;position:fixed;border-radius:12px;border:2px solid #0a0b0f;display:flex;flex-direction:column;align-items:center;color:white;font-size:16px;top:50%;right:20px;transform:translateY(-50%);z-index:99999;padding:16px;box-shadow:0 10px 8px rgba(0,0,0,0.2), 0 0 8px rgba(255,255,255,0.05);overflow:hidden;white-space:nowrap;"
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

            // Main action button
            const getAnswerButton = this.createEl('button', {
                id: 'getAnswerButton',
                style:
                    'background:#151515;border:1px solid rgba(255,255,255,0.04);color:white;padding:10px 12px;border-radius:8px;cursor:pointer;margin-top:18px;width:140px;height:64px;font-size:14px;transition:background 0.14s ease, transform 0.08s ease, box-shadow 0.12s;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;'
            });

            const spinner = this.createEl('div', {
                id: 'ah-spinner',
                style: 'width:22px;height:22px;border-radius:50%;border:3px solid rgba(255,255,255,0.12);border-top-color:#ffffff;display:none;animation:ah-spin 0.85s cubic-bezier(.4,.0,.2,1) infinite;'
            });

            const buttonTextSpan = this.createEl('span', { text: 'work smArt-er', id: 'getAnswerButtonText', style: 'font-size:14px;line-height:1;user-select:none;' });

            getAnswerButton.appendChild(spinner);
            getAnswerButton.appendChild(buttonTextSpan);

            const version = this.createEl('div', { id: 'ah-version', style: 'position:absolute;bottom:8px;right:8px;font-size:12px;opacity:0.9;z-index:100005', text: '1.0' });

            // SETTINGS COG (bottom-left)
            const settingsCog = this.createEl('button', {
                id: 'settingsCog',
                title: 'Settings',
                innerHTML: '⚙',
                style: 'position:absolute;bottom:8px;left:8px;background:none;border:none;color:#cfcfcf;font-size:16px;cursor:pointer;opacity:0.85;padding:2px;transition:transform .12s;z-index:100005'
            });

            // BACK ARROW (same spot, initially hidden)
            const settingsBack = this.createEl('button', {
                id: 'settingsBack',
                title: 'Back',
                innerHTML: '⟵',
                style: 'position:absolute;bottom:8px;left:8px;background:none;border:none;color:#ff4d4d;font-size:18px;cursor:pointer;opacity:0;display:none;padding:2px;transition:opacity .12s;z-index:100005'
            });

            // Settings menu container (hidden by default)
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

            // spinner keyframes & minor styles + hover rules for buttons & settings
            this.applyStylesOnce('assessment-helper-spinner-styles', `
                @keyframes ah-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                #getAnswerButton.running { background: #1e1e1e; box-shadow: 0 4px 12px rgba(0,0,0,0.35); }
                #getAnswerButton.running span { font-size:12px; opacity:0.95; }
                #settingsPanel input[type="number"] { width:80px; padding:4px; border-radius:6px; border:1px solid rgba(255,255,255,0.08); background:transparent; color:white; }
                #settingsPanel input[type="text"], #settingsPanel input[type="password"] { width:220px; padding:6px; border-radius:6px; border:1px solid rgba(255,255,255,0.08); background:transparent; color:white; }
                #settingsPanel label { font-size:13px; margin-right:6px; }
                .ah-reset { cursor:pointer; margin-left:8px; opacity:0.8; font-size:14px; user-select:none; }
                .ah-section-title { font-weight:700; margin-top:4px; margin-bottom:6px; font-size:14px; }
                #settingsPanel button { transition: background 0.12s ease, transform 0.08s ease; }
                #settingsPanel button:hover { background:#222; transform: translateY(-1px); }
                #getAnswerButton:hover { background: #1f1f1f !important; transform: translateY(-1px); }
            `);

            return container;
        }

        createAnswerUI() {
            const container = this.createEl('div');
            const answerContainer = this.createEl('div', {
                id: 'answerContainer',
                className: 'answerLauncher',
                style:
                    "outline:none;min-height:60px;transform:translateX(0px) translateY(-50%);opacity:0;visibility:hidden;transition:opacity 0.3s ease, transform 0.3s ease;font-family:'Nunito',sans-serif;width:60px;height:60px;background:#1c1e2b;position:fixed;border-radius:8px;display:flex;justify-content:center;align-items:center;color:white;font-size:24px;top:50%;right:220px;z-index:99998;padding:8px;box-shadow:0 4px 8px rgba(0,0,0,0.2);overflow:hidden;white-space:normal;"
            });

            const dragHandle = this.createEl('div', { className: 'answer-drag-handle', style: 'width:100%;height:24px;cursor:move;background:transparent;position:absolute;top:0;' });
            const closeButton = this.createEl('button', { id: 'closeAnswerButton', style: 'position:absolute;top:8px;right:8px;background:none;border:none;color:white;font-size:18px;cursor:pointer;padding:2px 8px;transition:color 0.2s ease, transform 0.1s ease;' });
            const answerContent = this.createEl('div', { id: 'answerContent', style: 'padding:0;margin:0;word-wrap:break-word;font-size:24px;font-weight:bold;display:flex;justify-content:center;align-items:center;width:100%;height:100%;' });

            answerContainer.appendChild(dragHandle);
            answerContainer.appendChild(closeButton);
            answerContainer.appendChild(answerContent);
            container.appendChild(answerContainer);
            return container;
        }

        // -------- intro & show UI --------
        playIntroAnimation() {
            if (typeof anime === 'undefined') {
                this.showUI();
                return;
            }
            const imageUrl = this.getUrl('icons/eyebackground.gif');
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

        // -------- fetch article / answer --------
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

        // Unified fetchAnswer: either URL method (cloudflare) or Groq chat-completion API
        async fetchAnswer(queryContent, retryCount = 0) {
            const MAX_RETRIES = 3, RETRY_DELAY_MS = 1000;
            try {
                // abort previous
                if (this.currentAbortController) {
                    try { this.currentAbortController.abort(); } catch (e) {}
                }
                this.currentAbortController = new AbortController();
                const signal = this.currentAbortController.signal;

                // If user chose API method, use Groq chat-completion style
                if (this.getUseGroqApi()) {
                    const groqUrl = this.getGroqUrl();
                    const groqKey = this.getGroqKey();
                    const groqModel = this.getGroqModel() || this.defaults.ai_groq_model;

                    if (!groqUrl || !groqKey) {
                        this.currentAbortController = null;
                        return 'Error: Groq API URL or Key not configured.';
                    }

                    const body = {
                        model: groqModel,
                        messages: [
                            { role: 'user', content: queryContent }
                        ],
                        max_tokens: 1024,
                        temperature: 0.0
                    };

                    const response = await fetch(groqUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${groqKey}`
                        },
                        body: JSON.stringify(body),
                        signal
                    });

                    this.currentAbortController = null;

                    if (!response.ok) {
                        const text = await response.text().catch(() => '');
                        if (response.status === 500 && text.includes("429 You exceeded your current quota") && retryCount < MAX_RETRIES) {
                            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                            return this.fetchAnswer(queryContent, retryCount + 1);
                        }
                        throw new Error(`API error ${response.status}: ${text}`);
                    }

                    const data = await response.json().catch(() => null);

                    // Attempt to extract text from common response shapes:
                    let text = null;
                    if (data && typeof data === 'object') {
                        if (data.output_text && typeof data.output_text === 'string') text = data.output_text;
                        else if (typeof data.output === 'string') text = data.output;
                        else if (data.response && typeof data.response === 'string') text = data.response;
                        else if (data.answer && typeof data.answer === 'string') text = data.answer;
                    }

                    if (!text && data && Array.isArray(data.choices) && data.choices.length > 0) {
                        const c0 = data.choices[0];
                        if (c0.message && (c0.message.content || c0.message.content_text)) {
                            if (typeof c0.message.content === 'string') text = c0.message.content;
                            else if (Array.isArray(c0.message.content)) {
                                text = c0.message.content.map(p => (p.text || p.content || '')).join('');
                            } else if (typeof c0.message.content_text === 'string') {
                                text = c0.message.content_text;
                            }
                        } else if (c0.text) {
                            text = c0.text;
                        } else if (c0.output && typeof c0.output === 'string') {
                            text = c0.output;
                        }
                    }

                    if (!text && data && Array.isArray(data.output)) {
                        try {
                            text = data.output.map(item => {
                                if (!item) return '';
                                if (typeof item === 'string') return item;
                                if (item.content && typeof item.content === 'string') return item.content;
                                if (item.content && Array.isArray(item.content)) {
                                    return item.content.map(c => (c.text || c.content || '')).join('');
                                }
                                return '';
                            }).join('\n');
                            if (text === '') text = null;
                        } catch (e) { text = null; }
                    }

                    if (!text && data && typeof data === 'string') text = data;

                    if (!text) {
                        try {
                            text = data ? JSON.stringify(data) : 'No answer available';
                        } catch (e) {
                            text = 'No answer available';
                        }
                    }

                    return String(text).trim();
                }

                // Otherwise: URL method (cloudflare / original endpoint)
                const response = await fetch(this.askEndpoint, {
                    method: 'POST',
                    cache: 'no-cache',
                    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                    body: JSON.stringify({ q: queryContent, article: this.cachedArticle || null }),
                    signal
                });

                this.currentAbortController = null;

                if (!response.ok) {
                    const text = await response.text().catch(() => '');
                    if (response.status === 500 && text.includes("429 You exceeded your current quota") && retryCount < MAX_RETRIES) {
                        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                        return this.fetchAnswer(queryContent, retryCount + 1);
                    }
                    throw new Error(`API error ${response.status}: ${text}`);
                }
                const data = await response.json().catch(() => null);
                return data && (data.response || data.answer) ? String(data.response || data.answer).trim() : 'No answer available';
            } catch (err) {
                if (err && err.name === 'AbortError') return '<<ABORTED>>';
                return `Error: ${err && err.message ? err.message : String(err)}`;
            }
        }

        // -------- Eye helpers --------
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

        // -------- UI start/stop --------
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

        // -------- Settings UI flows with directional expansion & eye shrink --------
        _computeExpandRight() {
            const launcher = document.getElementById('Launcher');
            if (!launcher) return true;
            const rect = launcher.getBoundingClientRect();
            const distanceToLeft = rect.left;
            const distanceToRight = window.innerWidth - rect.right;
            // If closer to left edge, expand right; otherwise expand left.
            return distanceToLeft <= distanceToRight;
        }

        _setLauncherWidthAndAnchor(widthPx, expandRight) {
            const launcher = document.getElementById('Launcher');
            if (!launcher) return;
            const rect = launcher.getBoundingClientRect();
            if (expandRight) {
                // Fix left and expand to the right
                if (!launcher.style.left || launcher.style.left === '') {
                    launcher.style.left = `${rect.left}px`;
                }
                launcher.style.right = 'auto';
                launcher.style.width = `${widthPx}px`;
            } else {
                // Fix right and expand to the left
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
            const waitLabel = this.createEl('label', { text: 'Wait time (ms):', style: 'min-width:120px;' });
            const waitInput = this.createEl('input', { type: 'number', id: 'mcWaitInput', value: String(this.getMCWait()), style: '' });
            const waitReset = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Reset to default' });
            waitReset.addEventListener('click', () => { this.resetMCWait(); waitInput.value = String(this.getMCWait()); });
            waitInput.addEventListener('change', () => { const v = Number(waitInput.value) || this.defaults.mc_wait; this.saveSetting(this.settingsKeys.mc_wait, v); });

            waitRow.appendChild(waitLabel); waitRow.appendChild(waitInput); waitRow.appendChild(waitReset);
            panel.appendChild(waitRow);

            const probRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
            const probLabel = this.createEl('label', { text: 'Random answer %:', style: 'min-width:120px;' });
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

            const placeholder = this.createEl('div', { text: 'No settings available yet for writing. This area is reserved.', style: 'font-size:13px;opacity:0.85;margin-top:6px;' });
            panel.appendChild(placeholder);
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

            // Show the default fixed URL (cloudflare) and the toggle
            const defaultUrlRow = this.createEl('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-bottom:8px;' });
            const defaultLabel = this.createEl('label', { text: 'Default (URL method) endpoint (fixed):', style: 'font-size:12px;opacity:0.85;' });
            const defaultUrlDisplay = this.createEl('div', { text: this.askEndpoint, style: 'font-size:12px;opacity:0.9;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.04);background:transparent;word-break:break-all;' });
            defaultUrlRow.appendChild(defaultLabel);
            defaultUrlRow.appendChild(defaultUrlDisplay);
            panel.appendChild(defaultUrlRow);

            // Toggle to use API method instead of URL method
            const toggleRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
            const toggleLabel = this.createEl('label', { text: 'Use API method (Groq/chat-completion):', style: 'min-width:200px;' });
            const toggleInput = this.createEl('input', { type: 'checkbox', id: 'aiUseApiCheckbox' });
            const toggleHint = this.createEl('span', { text: '(if OFF, URL method used)', style: 'font-size:12px;opacity:0.8;' });

            // set checkbox from storage
            toggleInput.checked = !!this.getUseGroqApi();
            toggleInput.addEventListener('change', () => {
                this.setUseGroqApi(toggleInput.checked);
                // rebuild to show/hide API fields
                this.openAISettings();
            });

            toggleRow.appendChild(toggleLabel); toggleRow.appendChild(toggleInput); toggleRow.appendChild(toggleHint);
            panel.appendChild(toggleRow);

            // API config area (shown only if toggleInput.checked)
            const apiArea = this.createEl('div', { id: 'aiApiArea', style: toggleInput.checked ? 'display:flex;flex-direction:column;gap:8px;' : 'display:none;' });

            // API URL field
            const apiUrlRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;' });
            const apiUrlLabel = this.createEl('label', { text: 'API URL (Groq endpoint):', style: 'min-width:140px;' });
            const apiUrlInput = this.createEl('input', { type: 'text', id: 'aiGroqUrlInput', value: this.getGroqUrl() || '', placeholder: 'https://api.groq.cloud/v1/...' });
            const apiUrlReset = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Clear' });
            apiUrlReset.addEventListener('click', () => { apiUrlInput.value = ''; this.setGroqUrl(''); });

            apiUrlRow.appendChild(apiUrlLabel); apiUrlRow.appendChild(apiUrlInput); apiUrlRow.appendChild(apiUrlReset);
            apiArea.appendChild(apiUrlRow);

            // API Key field (stored locally)
            const apiKeyRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;' });
            const apiKeyLabel = this.createEl('label', { text: 'API Key:', style: 'min-width:140px;' });
            const apiKeyInput = this.createEl('input', { type: 'password', id: 'aiGroqKeyInput', value: this.getGroqKey() || '', placeholder: 'paste API key (stored locally)' });
            const apiKeyReset = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Clear' });
            apiKeyReset.addEventListener('click', () => { apiKeyInput.value = ''; this.setGroqKey(''); });

            apiKeyRow.appendChild(apiKeyLabel); apiKeyRow.appendChild(apiKeyInput); apiKeyRow.appendChild(apiKeyReset);
            apiArea.appendChild(apiKeyRow);

            // Model selection (default 'llama-3.1-8b-instant')
            const modelRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;' });
            const modelLabel = this.createEl('label', { text: 'Model:', style: 'min-width:140px;' });
            const modelInput = this.createEl('input', { type: 'text', id: 'aiGroqModelInput', value: this.getGroqModel() || this.defaults.ai_groq_model });
            const modelReset = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Reset to default' });
            modelReset.addEventListener('click', () => { modelInput.value = this.defaults.ai_groq_model; this.setGroqModel(this.defaults.ai_groq_model); });

            modelRow.appendChild(modelLabel); modelRow.appendChild(modelInput); modelRow.appendChild(modelReset);
            apiArea.appendChild(modelRow);

            // Save button for API settings
            const apiSaveRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:8px;' });
            const apiSaveBtn = this.createEl('button', { text: 'Save AI settings', style: 'padding:8px 10px;border-radius:8px;background:#151515;border:1px solid rgba(255,255,255,0.04);color:white;cursor:pointer;' });
            apiSaveBtn.addEventListener('click', () => {
                const urlVal = (apiUrlInput.value || '').trim();
                const keyVal = (apiKeyInput.value || '').trim();
                const modelVal = (modelInput.value || '').trim() || this.defaults.ai_groq_model;
                this.setGroqUrl(urlVal);
                this.setGroqKey(keyVal);
                this.setGroqModel(modelVal);
                // persist toggle state already saved; give feedback
                this.showAlert('AI settings saved (locally).');
            });

            apiSaveRow.appendChild(apiSaveBtn);
            apiArea.appendChild(apiSaveRow);

            panel.appendChild(apiArea);
        }

        backFromSettings() {
            const launcher = document.getElementById('Launcher');
            const eye = document.getElementById('helperEye');
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
                // restore main button
                if (btn) { btn.style.display = 'flex'; setTimeout(()=>btn.style.opacity='1',10); }
                // restore cog/back
                if (settingsBack) { settingsBack.style.opacity = '0'; setTimeout(()=>settingsBack.style.display='none',120); }
                if (settingsCog) settingsCog.style.display = 'block';
                const expandRight = this._computeExpandRight();
                this._setLauncherWidthAndAnchor(180, expandRight);
                this._restoreEyeFromShrink();
                this.settingsState = 'closed';
                return;
            }
        }

        // -------- event wiring & behavior (includes settings triggers & random MC logic) --------
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
                        launcher.style.opacity = 0;
                        launcher.addEventListener('transitionend', function handler() {
                            if (parseFloat(launcher.style.opacity) === 0) {
                                launcher.style.visibility = 'hidden';
                                launcher.removeEventListener('transitionend', handler);
                            }
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
                        this._stoppedByWrite = false;
                        await this.startProcessUI();
                        try { this.setEyeToFull(); } catch (e) {}
                        this.runSolverLoop();
                    } else {
                        this.stopProcessImmediate();
                        await this.stopProcessUI();
                    }
                });

                // Settings cog/back wiring
                const settingsCog = document.getElementById('settingsCog');
                const settingsBack = document.getElementById('settingsBack');
                if (settingsCog) settingsCog.addEventListener('click', (e) => { e.preventDefault(); this.openSettingsMenu(); });
                if (settingsBack) settingsBack.addEventListener('click', (e) => { e.preventDefault(); this.backFromSettings(); });

            } catch (e) {}
        }

        // -------- solver loop (uses settings & random MC) --------
        async runSolverLoop() {
            const attemptOnce = async (excludedAnswers = []) => {
                if (!this.isRunning) return false;
                try {
                    let queryContent = await this.fetchArticleContent();

                    // Detect writing target: prefer TinyMCE iframe, then textarea, then contenteditable
                    const tinyIframe = document.querySelector('.tox-edit-area__iframe');
                    const plainTextarea = document.querySelector('textarea');
                    const contentEditable = document.querySelector('[contenteditable="true"]');

                    const writingTarget = tinyIframe || plainTextarea || contentEditable || null;

                    if (writingTarget) {
                        queryContent += "\n\nPlease provide a detailed written answer based on the above article and question.";

                        try {
                            console.groupCollapsed('[AssessmentHelper] Sent (writing) payload');
                            console.log('q:', queryContent);
                            console.log('article:', this.cachedArticle || null);
                            console.groupEnd();
                        } catch (e) {}

                        try {
                            console.groupCollapsed('[AssessmentHelper] Writing target');
                            if (tinyIframe) console.log('target: TinyMCE iframe', tinyIframe);
                            else if (plainTextarea) console.log('target: textarea', plainTextarea);
                            else if (contentEditable) console.log('target: contenteditable', contentEditable);
                            console.groupEnd();
                        } catch (e) {}

                        const answerText = await this.fetchAnswer(queryContent);

                        try {
                            console.groupCollapsed('[AssessmentHelper] Received (writing) answer');
                            console.log(answerText);
                            console.groupEnd();
                        } catch (e) {}

                        if (!this.isRunning) return false;

                        try {
                            if (tinyIframe) {
                                const iframeDoc = tinyIframe.contentDocument || tinyIframe.contentWindow.document;
                                if (iframeDoc) {
                                    iframeDoc.body.innerHTML = answerText;
                                    setTimeout(() => {
                                        iframeDoc.body.innerHTML += " ";
                                        const inputEvent = new Event('input', { bubbles: true });
                                        iframeDoc.body.dispatchEvent(inputEvent);
                                    }, 500);
                                } else {
                                    throw new Error('Unable to access iframe document');
                                }
                            } else if (plainTextarea) {
                                plainTextarea.value = answerText;
                                plainTextarea.dispatchEvent(new Event('input', { bubbles: true }));
                            } else if (contentEditable) {
                                contentEditable.innerHTML = answerText;
                                contentEditable.dispatchEvent(new Event('input', { bubbles: true }));
                            }

                            // stop after write insertion
                            this._stoppedByWrite = true;
                            this.isRunning = false;
                            try { await this.stopProcessUI(); } catch (e) {}
                            return false;
                        } catch (e) {
                            const answerContainerEl = document.getElementById('answerContainer');
                            const answerContentEl = answerContainerEl ? answerContainerEl.querySelector('#answerContent') : null;
                            if (answerContentEl) answerContentEl.textContent = (typeof answerText === 'string' ? answerText : String(answerText));
                            if (answerContainerEl) { answerContainerEl.style.display = 'flex'; answerContainerEl.style.visibility = 'visible'; answerContainerEl.classList.add('show'); }
                            this._stoppedByWrite = true;
                            this.isRunning = false;
                            try { await this.stopProcessUI(); } catch (e2) {}
                            return false;
                        }
                    } else {
                        queryContent += "\n\nPROVIDE ONLY A ONE-LETTER ANSWER THAT'S IT NOTHING ELSE (A, B, C, or D).";
                        if (excludedAnswers.length > 0) queryContent += `\n\nDo not pick letter ${excludedAnswers.join(', ')}.`;

                        try {
                            console.groupCollapsed('[AssessmentHelper] Sent (MC) payload');
                            console.log('q:', queryContent);
                            console.log('article:', this.cachedArticle || null);
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
                                console.log('Random decision triggered (pct):', randPct);
                                console.log('Chosen letter:', chosenLetter);
                                console.groupEnd();
                            } catch (e) {}
                        } else {
                            answer = await this.fetchAnswer(queryContent);
                            try {
                                console.groupCollapsed('[AssessmentHelper] Received (MC) answer');
                                console.log(answer);
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
                    try { await this.playVideoOnce(this.getUrl('icons/gotosleep.webm')); } catch (e) {}
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

    try { new AssessmentHelper(); } catch (e) {}
})();
