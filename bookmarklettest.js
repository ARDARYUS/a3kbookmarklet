// AssessmentHelper — Ready/Reflect: click radio but do NOT submit; then write justification in TinyMCE or other editor
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
            // inside constructor(), near the top
            window.__AssessmentHelperInstance = this;
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

            this.askEndpoint = 'https://f-ghost-insights-pressed.trycloudflare.com/ask';
            this.assetBase = 'https://raw.githubusercontent.com/ARDARYUS/a3kbookmarklet/main/icons/';

            // Settings keys & defaults
            this.settingsKeys = {
                mc_wait: 'ah_mc_wait_ms',
                mc_random_pct: 'ah_mc_random_pct',
                w_min: 'ah_w_min',
                w_max: 'ah_w_max',
                w_level: 'ah_w_level',
                w_blacklist: 'ah_w_blacklist',
                w_lowercase: 'ah_w_lowercase',
                w_mood: 'ah_w_mood',
                ai_use_api: 'ah_ai_use_api',
                ai_groq_url: 'ah_ai_groq_url',
                ai_groq_key: 'ah_ai_groq_key',
                ai_groq_model: 'ah_ai_groq_model',
                ai_cf_url: 'ah_ai_cf_url'
            };
            this.defaults = {
                mc_wait: 300,
                mc_random_pct: 0,
                w_min: '',
                w_max: '',
                w_level: 'C1',
                w_blacklist: '',
                w_lowercase: false,
                w_mood: ''
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
                return v;
            } catch (e) { return fallback; }
        }

        getMCWait() { return Number(localStorage.getItem(this.settingsKeys.mc_wait) || this.defaults.mc_wait); }
        getMCRandomPct() { return Number(localStorage.getItem(this.settingsKeys.mc_random_pct) || this.defaults.mc_random_pct); }
        resetMCWait() { this.saveSetting(this.settingsKeys.mc_wait, this.defaults.mc_wait); }
        resetMCRandom() { this.saveSetting(this.settingsKeys.mc_random_pct, this.defaults.mc_random_pct); }

        getWMin() { const v = localStorage.getItem(this.settingsKeys.w_min); return v === null ? '' : v; }
        getWMax() { const v = localStorage.getItem(this.settingsKeys.w_max); return v === null ? '' : v; }
        getWLevel() { return localStorage.getItem(this.settingsKeys.w_level) || this.defaults.w_level; }
        getWBlacklist() { return localStorage.getItem(this.settingsKeys.w_blacklist) || this.defaults.w_blacklist; }
        getWLowercase() { return (localStorage.getItem(this.settingsKeys.w_lowercase) === 'true'); }
        getWMood() { return localStorage.getItem(this.settingsKeys.w_mood) || this.defaults.w_mood; }
        resetWToDefaults() {
            this.saveSetting(this.settingsKeys.w_min, '');
            this.saveSetting(this.settingsKeys.w_max, '');
            this.saveSetting(this.settingsKeys.w_level, this.defaults.w_level);
            this.saveSetting(this.settingsKeys.w_blacklist, '');
            this.saveSetting(this.settingsKeys.w_lowercase, this.defaults.w_lowercase ? 'true' : 'false');
            this.saveSetting(this.settingsKeys.w_mood, '');
        }

        // getter for configured Cloudflare proxy URL (with fallback)
        getCFUrl() {
            try {
                return (this.settingsKeys && localStorage.getItem(this.settingsKeys.ai_cf_url))
                    || localStorage.getItem('ah_ai_cf_url')
                    || this.askEndpoint;
            } catch (e) {
                return this.askEndpoint;
            }
        }

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
            } catch (e) {}

            // create main UI
            try {
                // If we already appended markup earlier, abort
                if (document.getElementById('Launcher')) return;

                const container = document.createElement('div');
                container.id = 'AHHolder';
                container.style = 'position:fixed;z-index:2147483646;right:12px;bottom:12px;font-family:Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;';
                document.body.appendChild(container);

                // build minimal launcher UI
                const launcher = this.createEl('div', { id: 'Launcher', style: 'width:180px;height:76px;border-radius:12px;background:linear-gradient(180deg,#111,#0b0b0b);box-shadow:0 10px 30px rgba(0,0,0,0.6);position:relative;padding:12px;display:flex;flex-direction:column;align-items:center;gap:6px;opacity:0;visibility:hidden;transition:opacity 0.24s ease;' });

                const dragHandle = this.createEl('div', { className: 'drag-handle', style: 'position:absolute;left:8px;top:8px;width:10px;height:10px;cursor:move;opacity:0.6;' });
                const eyeWrapper = this.createEl('div', { id: 'eyeWrapper', style: 'width:90px;height:90px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:linear-gradient(180deg,#0f0f0f,#131313);position:absolute;left:6px;top:-40px;' });
                const eye = this.createEl('div', { id: 'helperEye', style: 'width:90px;height:90px;border-radius:12px;background:transparent;display:flex;align-items:center;justify-content:center;overflow:hidden;' });
                const eyeImg = this.createEl('img', { id: 'helperEyeImg', src: this.getUrl('icons/idle.png'), style: 'width:100%;height:100%;object-fit:contain;display:block;' });
                const eyeVid = this.createEl('video', { id: 'helperEyeVideo', style: 'display:none;width:100%;height:100%;object-fit:contain;', muted: true });
                eye.appendChild(eyeImg);
                eye.appendChild(eyeVid);
                eyeWrapper.appendChild(eye);

                const closeButton = this.createEl('button', { id: 'closeButton', text: '✕', style: 'position:absolute;top:8px;right:8px;background:transparent;border:none;color:#fff;cursor:pointer;font-size:12px;' });
                closeButton.title = 'Close';

                const getAnswerButton = this.createEl('button', { id: 'getAnswerButton', style: 'width:100%;padding:8px;border-radius:8px;border:none;cursor:pointer;background:#151515;color:#fff;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;' });
                const getAnswerButtonText = this.createEl('span', { id: 'getAnswerButtonText', text: 'work smArt-er' });
                getAnswerButton.appendChild(getAnswerButtonText);
                // spinner
                const spinner = this.createEl('div', { id: 'ah-spinner', style: 'width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,0.08);border-top-color:#fff;display:none;position:absolute;right:12px;top:14px;animation:ah-spin 0.8s linear infinite;' });

                const version = this.createEl('div', { text: 'v' + (this.version || ''), style: 'font-size:10px;color:#aaa;position:absolute;bottom:6px;right:6px;' });
                const settingsCog = this.createEl('button', { id: 'settingsCog', text: '⚙', style: 'position:absolute;top:8px;left:8px;background:transparent;border:none;color:#fff;cursor:pointer;font-size:12px;' });
                const settingsBack = this.createEl('button', { id: 'settingsBack', text: '←', style: 'position:absolute;top:8px;left:8px;background:transparent;border:none;color:#fff;cursor:pointer;font-size:12px;display:none;' });

                const settingsPanel = this.createEl('div', { id: 'settingsPanel', style: 'position:absolute;top:96px;left:12px;right:auto;width:360px;max-height:60vh;padding:12px;border-radius:10px;background:rgba(20,20,20,0.96);box-shadow:0 10px 30px rgba(0,0,0,0.5);display:flex;flex-direction:column;align-items:flex-start;gap:8px;overflow:auto;display:none;' });

                launcher.appendChild(dragHandle);
                launcher.appendChild(eyeWrapper);
                launcher.appendChild(closeButton);
                launcher.appendChild(getAnswerButton);
                launcher.appendChild(spinner);
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
                    #settingsPanel input[type="number"] { width:80px; }
                    #settingsPanel input[type="text"] { width:100%; }
                    #settingsPanel { color: #ddd; font-size:13px; padding:10px 12px; border-radius:10px; background: rgba(10,10,10,0.98); min-width:360px; max-width:480px; flex-direction:column;align-items:flex-start;gap:8px;overflow:auto; }
                    #settingsPanel input, #settingsPanel textarea { background: rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.04); padding:8px; border-radius:8px; color:inherit; outline:none; }
                    #settingsPanel label { font-size:13px; margin-right:6px; }
                    .ah-reset { cursor:pointer; margin-left:8px; opacity:0.8; font-size:14px; user-select:none; }
                    .ah-section-title { font-weight:700; margin-top:4px; margin-bottom:6px; font-size:14px; }
                    #settingsPanel button { transition: background 0.12s ease, transform 0.08s ease; }
                    #settingsPanel button:hover { background:#222; transform: translateY(-1px); }
                    #getAnswerButton:hover { background: #1f1f1f !important; transform: translateY(-1px); }
                    #settingsCog { transition: transform 0.12s ease, opacity 0.12s ease; }
                `);

                // populate basic settings panel menu
                const panel = settingsPanel;

                const generalTitle = this.createEl('div', { className: 'ah-section-title', text: 'General settings' });
                panel.appendChild(generalTitle);

                const mcRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
                const mcLabel = this.createEl('label', { text: 'MC wait (ms):', style: 'min-width:160px;' });
                const mcInput = this.createEl('input', { type: 'number', value: localStorage.getItem(this.settingsKeys.mc_wait) || this.defaults.mc_wait });
                mcRow.appendChild(mcLabel); mcRow.appendChild(mcInput); panel.appendChild(mcRow);

                const mcRandRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
                const mcRandLabel = this.createEl('label', { text: 'MC random %:', style: 'min-width:160px;' });
                const mcRandInput = this.createEl('input', { type: 'number', value: localStorage.getItem(this.settingsKeys.mc_random_pct) || this.defaults.mc_random_pct });
                mcRandRow.appendChild(mcRandLabel); mcRandRow.appendChild(mcRandInput); panel.appendChild(mcRandRow);

                const writeTitle = this.createEl('div', { className: 'ah-section-title', text: 'Text generation' });
                panel.appendChild(writeTitle);

                const wminRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
                const wminLabel = this.createEl('label', { text: 'Min words:', style: 'min-width:160px;' });
                const wminInput = this.createEl('input', { type: 'number', value: localStorage.getItem(this.settingsKeys.w_min) || this.defaults.w_min });
                wminRow.appendChild(wminLabel); wminRow.appendChild(wminInput); panel.appendChild(wminRow);

                const wmaxRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' });
                const wmaxLabel = this.createEl('label', { text: 'Max words:', style: 'min-width:160px;' });
                const wmaxInput = this.createEl('input', { type: 'number', value: localStorage.getItem(this.settingsKeys.w_max) || this.defaults.w_max });
                wmaxRow.appendChild(wmaxLabel); wmaxRow.appendChild(wmaxInput); panel.appendChild(wmaxRow);

                const aiTitle = this.createEl('div', { className: 'ah-section-title', text: 'AI & Model settings' });
                panel.appendChild(aiTitle);

                const methodRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%;' });
                const methodLabel = this.createEl('label', { text: 'Use external API (Groq):', style: 'min-width:160px;' });
                const methodToggle = this.createEl('input', { type: 'checkbox' });
                methodToggle.checked = (localStorage.getItem(this.settingsKeys.ai_use_api) === 'true');
                methodRow.appendChild(methodLabel); methodRow.appendChild(methodToggle); panel.appendChild(methodRow);

                const urlRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%;' });
                const urlLabel = this.createEl('label', { text: 'Groq URL:', style: 'min-width:160px;' });
                const urlInput = this.createEl('input', { type: 'text', id: 'aiGroqUrlInput', value: localStorage.getItem(this.settingsKeys.ai_groq_url) || '//api.groq.com/openai/v1/chat/completions', style: 'flex:1;' });
                const urlReset = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Reset to default' });
                urlReset.addEventListener('click', () => { urlInput.value = '//api.groq.com/openai/v1/chat/completions'; this.saveSetting(this.settingsKeys.ai_groq_url, urlInput.value); });
                urlRow.appendChild(urlLabel); urlRow.appendChild(urlInput); urlRow.appendChild(urlReset);
                panel.appendChild(urlRow);

            // Cloudflare proxy URL row (editable)
            const cfRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%;' });
            const cfLabel = this.createEl('label', { text: 'Cloudflare proxy URL:', style: 'min-width:160px;' });
            const cfInput = this.createEl('input', {
                type: 'text',
                id: 'aiCfUrlInput',
                value: (localStorage.getItem(this.settingsKeys.ai_cf_url) || this.askEndpoint),
                style: 'flex:1;',
            });
            const cfReset = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Reset to default' });
            cfReset.addEventListener('click', () => {
                cfInput.value = this.askEndpoint;
                this.saveSetting(this.settingsKeys.ai_cf_url, cfInput.value);
            });

            cfRow.appendChild(cfLabel); cfRow.appendChild(cfInput); cfRow.appendChild(cfReset);
            panel.appendChild(cfRow);

                const keyRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%;' });
                const keyLabel = this.createEl('label', { text: 'Groq API key:', style: 'min-width:160px;' });
                const keyInput = this.createEl('input', { type: 'text', id: 'aiGroqKeyInput', value: localStorage.getItem(this.settingsKeys.ai_groq_key) || '' });
                const keyReset = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Reset' });
                keyReset.addEventListener('click', () => { keyInput.value = ''; this.saveSetting(this.settingsKeys.ai_groq_key, ''); });
                keyRow.appendChild(keyLabel); keyRow.appendChild(keyInput); keyRow.appendChild(keyReset);
                panel.appendChild(keyRow);

                const modelRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%;' });
                const modelLabel = this.createEl('label', { text: 'Model:', style: 'min-width:160px;' });
                const modelInput = this.createEl('input', { type: 'text', id: 'aiGroqModelInput', value: localStorage.getItem(this.settingsKeys.ai_groq_model) || 'llama-3.1-8b-instant' });
                modelRow.appendChild(modelLabel); modelRow.appendChild(modelInput); panel.appendChild(modelRow);

                const saveBtn = this.createEl('button', { text: 'Save settings', style: 'padding:8px 12px;border-radius:8px;background:#111;color:#fff;border:none;cursor:pointer;' });
                panel.appendChild(saveBtn);

                // wiring of settings controls to storage
                methodToggle.addEventListener('change', () => { this.saveSetting(this.settingsKeys.ai_use_api, methodToggle.checked ? 'true' : 'false'); });
                urlInput.addEventListener('change', () => { this.saveSetting(this.settingsKeys.ai_groq_url, urlInput.value || ''); });
                keyInput.addEventListener('change', () => { this.saveSetting(this.settingsKeys.ai_groq_key, keyInput.value || ''); });
                modelInput.addEventListener('change', () => { this.saveSetting(this.settingsKeys.ai_groq_model, modelInput.value || 'llama-3.1-8b-instant'); });

                // ensure saved defaults persisted
                this.saveSetting(this.settingsKeys.ai_groq_url, urlInput.value);
            // save Cloudflare URL
            this.saveSetting(this.settingsKeys.ai_cf_url, cfInput ? cfInput.value : this.askEndpoint);
            this.saveSetting(this.settingsKeys.ai_groq_model, modelInput.value);
            if (keyInput.value) this.saveSetting(this.settingsKeys.ai_groq_key, keyInput.value);

                // event wiring for interactive controls
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

                    // --- READY / REFLECT special handling ---
                    try {
                        const href = (window.location && window.location.href) ? window.location.href : '';
                        if (href.includes('/lesson/ready') || href.includes('/lesson/reflect')) {
                            // Try to read the question via the provided XPath:
                            let readyQuestion = '';
                            try {
                                const xpathQ = '//*[@id="before-reading-poll"]/div[1]/p[2]/div/text()';
                                const res = document.evaluate(xpathQ, document, null, XPathResult.STRING_TYPE, null);
                                readyQuestion = (res && res.stringValue) ? res.stringValue.trim() : '';
                            } catch (e) {
                                readyQuestion = '';
                            }

                            // fallback options if not found
                            if (!readyQuestion) {
                                try {
                                    const altXpath = '//*[@id="before-reading-poll"]/div[1]/p[2]/div';
                                    const node = document.evaluate(altXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                                    if (node) readyQuestion = (node.textContent || '').trim();
                                } catch (e) {}
                            }
                            if (!readyQuestion) {
                                try {
                                    const fallbackNode = document.querySelector('#before-reading-poll p:nth-of-type(2) div') || document.querySelector('#before-reading-poll p div');
                                    if (fallbackNode) readyQuestion = (fallbackNode.textContent || '').trim();
                                } catch (e) {}
                            }

                            if (readyQuestion) {
                                try {
                                    console.groupCollapsed('[AssessmentHelper] Ready/Reflect detected — question fetched');
                                    console.log(readyQuestion);
                                    console.groupEnd();
                                } catch (e) {}

                                // Check for radio inputs specified by XPaths
                                const agreeXpath = '//*[@id="before-reading-poll"]/div[1]/fieldset/div/label[1]/span[1]/input';
                                const disagreeXpath = '//*[@id="before-reading-poll"]/div[1]/fieldset/div/label[2]/span[1]/input';
                                let agreeNode = null, disagreeNode = null;
                                try {
                                    agreeNode = document.evaluate(agreeXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                                } catch (e) { agreeNode = null; }
                                try {
                                    disagreeNode = document.evaluate(disagreeXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                                } catch (e) { disagreeNode = null; }

                                // If radio buttons exist — decide and click but DO NOT submit
                                if (agreeNode || disagreeNode) {
                                    const prompt = `${readyQuestion}\n\nDecide whether you AGREE or DISAGREE with this statement. Respond with exactly one word: AGREE or DISAGREE.`;
                                    try {
                                        console.groupCollapsed('[AssessmentHelper] Sent (Ready/Reflect classification) payload');
                                        console.log('q:', prompt);
                                        console.log('article:', this.cachedArticle || null);
                                        console.groupEnd();
                                    } catch (e) {}

                                    const classification = await this.fetchAnswer(prompt);
                                    try {
                                        console.groupCollapsed('[AssessmentHelper] Received (Ready/Reflect) classification');
                                        console.log(classification);
                                        console.groupEnd();
                                    } catch (e) {}

                                    const normalized = (String(classification || '')).trim().toUpperCase();
                                    let pickAgree = false;
                                    if (normalized.indexOf('AGREE') !== -1 && normalized.indexOf('DISAGREE') === -1) pickAgree = true;
                                    else if (normalized.indexOf('DISAGREE') !== -1 && normalized.indexOf('AGREE') === -1) pickAgree = false;
                                    else {
                                        if (normalized.startsWith('A')) pickAgree = true;
                                        else if (normalized.startsWith('D')) pickAgree = false;
                                        else pickAgree = true;
                                    }

                                    // Click the radio for AGREE or DISAGREE (if available)
                                    try {
                                        if (pickAgree && agreeNode) {
                                            agreeNode.click();
                                            console.log('[AssessmentHelper] Clicked: agree');
                                        } else if (!pickAgree && disagreeNode) {
                                            disagreeNode.click();
                                            console.log('[AssessmentHelper] Clicked: disagree');
                                        } else {
                                            console.log('[AssessmentHelper] Radio target missing for chosen option.');
                                        }
                                    } catch (e) {
                                        console.log('[AssessmentHelper] Error clicking radio:', e && e.message);
                                    }

                                    // --- build justification prompt that uses the user's writing settings ---
                                    const level = this.getWLevel();
                                    const minWords = this.getWMin();
                                    const maxWords = this.getWMax();
                                    const mood = this.getWMood();

                                    const starter = pickAgree ? 'I agree because' : 'I disagree because';
                                    let justificationPrompt = `${readyQuestion}\n\n${starter} `;

                                    // Add constraints
                                    if (level) justificationPrompt += `Use English level ${level}. `;
                                    if (minWords && maxWords) {
                                        justificationPrompt += `Use a minimum of ${minWords} words and a maximum of ${maxWords} words. `;
                                    } else if (minWords) {
                                        justificationPrompt += `Use a minimum of ${minWords} words. `;
                                    } else if (maxWords) {
                                        justificationPrompt += `Use a maximum of ${maxWords} words. `;
                                    }
                                    if (mood) justificationPrompt += `${mood} `;

                                    // Final instruction: produce a short justification paragraph starting with the starter
                                    justificationPrompt += `Provide a concise justification starting with "${starter}" and keep it as one coherent paragraph. Respond only with the justification (no extra commentary).`;

                                    try {
                                        console.groupCollapsed('[AssessmentHelper] Sent (Ready/Reflect justification) payload');
                                        console.log('q:', justificationPrompt);
                                        console.groupEnd();
                                    } catch (e) {}

                                    const justificationText = await this.fetchAnswer(justificationPrompt);

                                    // post-process — apply blacklist / lowercase
                                    let processed = String(justificationText || '');
                                    try {
                                        const blacklist = this.getWBlacklist() || '';
                                        if (blacklist && blacklist.length > 0) {
                                            const escaped = blacklist.split('').map(ch => ch.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
                                            if (escaped) {
                                                const re = new RegExp(escaped, 'g');
                                                processed = processed.replace(re, '');
                                            }
                                        }
                                    } catch (e) {
                                        try {
                                            const blacklist = this.getWBlacklist() || '';
                                            for (let i = 0; i < blacklist.length; i++) {
                                                const ch = blacklist[i];
                                                processed = processed.split(ch).join('');
                                            }
                                        } catch (e2) {}
                                    }

                                    if (this.getWLowercase()) processed = processed.toLowerCase();

                                    // Insert the justification into TinyMCE iframe if present, else textarea/contenteditable
                                    try {
                                        const tinyIframeLocal = document.querySelector('.tox-edit-area__iframe');
                                        const plainTextareaLocal = document.querySelector('textarea');
                                        const contentEditableLocal = document.querySelector('[contenteditable="true"]');

                                        if (tinyIframeLocal) {
                                            const iframeDoc = tinyIframeLocal.contentDocument || tinyIframeLocal.contentWindow.document;
                                            if (iframeDoc) {
                                                iframeDoc.body.innerHTML = processed;
                                                setTimeout(() => {
                                                    iframeDoc.body.innerHTML += " ";
                                                    const inputEvent = new Event('input', { bubbles: true });
                                                    iframeDoc.body.dispatchEvent(inputEvent);
                                                }, 500);
                                            } else {
                                                throw new Error('Unable to access iframe document');
                                            }
                                        } else if (plainTextareaLocal) {
                                            plainTextareaLocal.value = processed;
                                            plainTextareaLocal.dispatchEvent(new Event('input', { bubbles: true }));
                                        } else if (contentEditableLocal) {
                                            contentEditableLocal.innerHTML = processed;
                                            contentEditableLocal.dispatchEvent(new Event('input', { bubbles: true }));
                                        } else {
                                            const answerContainerEl = document.getElementById('answerContainer');
                                            const answerContentEl = answerContainerEl ? answerContainerEl.querySelector('#answerContent') : null;
                                            if (answerContentEl) answerContentEl.textContent = processed;
                                            if (answerContainerEl) { answerContainerEl.style.display = 'flex'; answerContainerEl.style.visibility = 'visible'; answerContainerEl.classList.add('show'); }
                                        }

                                        // stop after insertion
                                        this._stoppedByWrite = true;
                                        this.isRunning = false;
                                        try { await this.stopProcessUI(); } catch (e) {}
                                        return false;
                                    } catch (e) {
                                        const answerContainerEl = document.getElementById('answerContainer');
                                        const answerContentEl = answerContainerEl ? answerContainerEl.querySelector('#answerContent') : null;
                                        if (answerContentEl) answerContentEl.textContent = (typeof processed === 'string' ? processed : String(processed));
                                        if (answerContainerEl) { answerContainerEl.style.display = 'flex'; answerContainerEl.style.visibility = 'visible'; answerContainerEl.classList.add('show'); }
                                        this._stoppedByWrite = true;
                                        this.isRunning = false;
                                        try { await this.stopProcessUI(); } catch (e2) {}
                                        return false;
                                    }
                                }
                            } catch (e) {
                                console.warn('[AssessmentHelper] Ready/Reflect handler error', e && e.message);
                            }

                            // Normal writing detection (non-ready/reflect)
                            if (tinyIframe || plainTextarea || contentEditable) {
                                let queryContentWriting = queryContent + "\n\nPlease provide a detailed written answer based on the above article and question.";
                                // append the user's writing settings
                                const level = this.getWLevel();
                                const minWords = this.getWMin();
                                const maxWords = this.getWMax();
                                const mood = this.getWMood();
                                if (level) queryContentWriting += ` Use English level ${level}.`;
                                if (minWords && maxWords) queryContentWriting += ` Use minimum ${minWords} words and maximum ${maxWords} words.`;
                                else if (minWords) queryContentWriting += ` Use minimum ${minWords} words.`;
                                else if (maxWords) queryContentWriting += ` Use maximum ${maxWords} words.`;
                                if (mood) queryContentWriting += ` ${mood}`;

                                try {
                                    console.groupCollapsed('[AssessmentHelper] Sent (writing) payload');
                                    console.log('q:', queryContentWriting);
                                    console.log('article:', this.cachedArticle || null);
                                    console.groupEnd();
                                } catch (e) {}

                                const answerText = await this.fetchAnswer(queryContentWriting);

                                try {
                                    console.groupCollapsed('[AssessmentHelper] Received (writing) answer');
                                    console.log(answerText);
                                    console.groupEnd();
                                } catch (e) {}

                                if (!this.isRunning) return false;

                                // post-process client-side blacklist / lowercase
                                let processed = String(answerText || '');
                                try {
                                    const blacklist = this.getWBlacklist() || '';
                                    if (blacklist && blacklist.length > 0) {
                                        const escaped = blacklist.split('').map(ch => ch.replace(/[-\/\\^$*+?.()|[\\]{}]/g, '\\$&')).join('|');
                                        if (escaped) {
                                            const re = new RegExp(escaped, 'g');
                                            processed = processed.replace(re, '');
                                        }
                                    }
                                } catch (e) {
                                    try {
                                        const blacklist = this.getWBlacklist() || '';
                                        for (let i = 0; i < blacklist.length; i++) {
                                            const ch = blacklist[i];
                                            processed = processed.split(ch).join('');
                                        }
                                    } catch (e2) {}
                                }

                                if (this.getWLowercase()) processed = processed.toLowerCase();

                                try {
                                    if (tinyIframe) {
                                        const iframeDoc = tinyIframe.contentDocument || tinyIframe.contentWindow.document;
                                        if (iframeDoc) {
                                            iframeDoc.body.innerHTML = processed;
                                            setTimeout(() => {
                                                iframeDoc.body.innerHTML += " ";
                                                const inputEvent = new Event('input', { bubbles: true });
                                                iframeDoc.body.dispatchEvent(inputEvent);
                                            }, 500);
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

                                    // stop after write insertion
                                    this._stoppedByWrite = true;
                                    this.isRunning = false;
                                    try { await this.stopProcessUI(); } catch (e) {}
                                    return false;
                                } catch (e) {
                                    const answerContainerEl = document.getElementById('answerContainer');
                                    const answerContentEl = answerContainerEl ? answerContainerEl.querySelector('#answerContent') : null;
                                    if (answerContentEl) answerContentEl.textContent = (typeof processed === 'string' ? processed : String(processed));
                                    if (answerContainerEl) { answerContainerEl.style.display = 'flex'; answerContainerEl.style.visibility = 'visible'; answerContainerEl.classList.add('show'); }
                                    this._stoppedByWrite = true;
                                    this.isRunning = false;
                                    try { await this.stopProcessUI(); } catch (e2) {}
                                    return false;
                                }
                            } else {
                                // Multiple choice mode (unchanged)
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
            };

            try { new AssessmentHelper(); } catch (e) {}
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

async fetchAnswer(queryContent, retryCount = 0) {
    const MAX_RETRIES = 3, RETRY_DELAY_MS = 1000;
    try {
        // abort any pending request
        if (this.currentAbortController) {
            try { this.currentAbortController.abort(); } catch (e) {}
        }
        this.currentAbortController = new AbortController();
        const signal = this.currentAbortController.signal;

        // Determine whether to use direct provider API (from settings or legacy localStorage keys)
        let useDirectApi = false;
        try {
            useDirectApi = (this.settingsKeys && localStorage.getItem(this.settingsKeys.ai_use_api) === 'true')
                || localStorage.getItem('ah_ai_use_api') === 'true';
        } catch (e) {
            useDirectApi = false;
        }

        let response;

        if (useDirectApi) {
            // read groq/openai settings (try both settingsKeys and legacy keys)
            const groqUrl = (this.settingsKeys && localStorage.getItem(this.settingsKeys.ai_groq_url))
                || localStorage.getItem('ah_ai_groq_url')
                || 'https://api.groq.com/openai/v1/chat/completions';

            const groqKey = (this.settingsKeys && localStorage.getItem(this.settingsKeys.ai_groq_key))
                || localStorage.getItem('ah_ai_groq_key') || '';

            const groqModel = (this.settingsKeys && localStorage.getItem(this.settingsKeys.ai_groq_model))
                || localStorage.getItem('ah_ai_groq_model')
                || 'llama-3.1-8b-instant';

            // Build OpenAI-style chat payload
            const chatPayload = {
                model: groqModel,
                messages: [
                    { role: 'user', content: (queryContent || '') + (this.cachedArticle ? `\n\nArticle:\n${this.cachedArticle}` : '') }
                ],
                max_tokens: 1024
            };

            response = await fetch(groqUrl, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    ...(groqKey ? { 'Authorization': 'Bearer ' + groqKey } : {})
                },
                body: JSON.stringify(chatPayload),
                signal
            });
        } else {
            // original proxy flow (Cloudflare endpoint)
            const cfUrl = (this.settingsKeys && localStorage.getItem(this.settingsKeys.ai_cf_url))
                    || localStorage.getItem('ah_ai_cf_url')
                    || this.askEndpoint;

                response = await fetch(cfUrl, {
                method: 'POST',
                cache: 'no-cache',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: queryContent, article: this.cachedArticle || null }),
                signal
            });
        }

        // clear current abort controller reference
        this.currentAbortController = null;

        // handle non-OK responses with retry logic for transient/server errors or quota responses
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            const status = response.status;
            const isQuotaOrRate = /quota|exceeded|rate limit|429/i.test(text) || status === 429 || status === 500;
            if (isQuotaOrRate && retryCount < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                return this.fetchAnswer(queryContent, retryCount + 1);
            }
            throw new Error(`API error ${status}: ${text}`);
        }

        // parse response JSON (robust across proxy-style and OpenAI/Groq-style responses)
        const data = await response.json().catch(() => null);

        if (data) {
            // OpenAI/Groq chat-completions style: { choices: [ { message: { content: "..." } } ] }
            if (Array.isArray(data.choices) && data.choices.length) {
                const c = data.choices[0];
                if (c.message && (c.message.content || c.message.role)) {
                    return String(c.message.content || c.text || '').trim();
                }
                if (c.text) return String(c.text).trim();
                if (c.delta && c.delta.content) return String(c.delta.content).trim();
            }

            // Some providers return 'output' or 'result' arrays/strings
            if (data.output) {
                if (typeof data.output === 'string') return data.output.trim();
                if (Array.isArray(data.output) && data.output.length) return String(data.output[0]).trim();
            }

            // Proxy-style fallback fields
            if (data.response || data.answer) return String(data.response || data.answer).trim();
            if (data.result) return String(data.result).trim();

            // finally, if the entire body is a string-ish, return it
            if (typeof data === 'string') return data.trim();
        }

        return 'No answer available';
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

        _setEyeToSmall() {
            try {
                const img = document.getElementById('helperEyeImg');
                if (!img) return;
                img.src = this.getUrl('icons/idle-small.png');
            } catch (err) {}
        }

        setEyeToFull() {
            try {
                const img = document.getElementById('helperEyeImg');
                if (!img) return;
                img.src = this.getUrl('icons/awake.png');
                this.eyeState = 'full';
            } catch (err) {}
        }

        _restoreEyeFromShrink() {
            const eye = document.getElementById('helperEye');
            if (!eye) return;
            if (this._eyeOriginal) {
                // restore style string (safe)
                eye.setAttribute('style', this._eyeOriginal.style);
                this._eyeOriginal = null;
            } else {
                // fallback restore approximate layout
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
            const eye = document.getElementById('helperEye');
            const btn = document.getElementById('getAnswerButton');

            // compute direction and set width to menu-size
            const expandRight = this._computeExpandRight();
            this._setLauncherWidthAndAnchor(360, expandRight);
            // shrink eye to top-right
            this._shrinkEyeToTopRight();
            this.settingsState = 'menu';
            this.buildSettingsMenu();

            const panel = document.getElementById('settingsPanel');
            if (panel) panel.style.display = 'block';
            try { document.getElementById('settingsCog').style.display = 'none'; } catch (e) {}
            try { const back = document.getElementById('settingsBack'); back.style.display = 'block'; back.style.opacity = 1; } catch (e) {}
        }

        // rest of UI wiring, events, drag behavior, etc. kept intact as originally present...
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
                launcher.style.left = `${rect.left}px`;
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
            // Save original once
            if (!this._eyeOriginal) {
                this._eyeOriginal = {
                    style: eye.getAttribute('style') || '',
                    parentDisplay: eye.style.display || ''
                };
            }
            // Shrink and move under the X, inside the launcher
            eye.style.display = 'flex';
            eye.style.position = 'absolute';
            eye.style.top = '12px';
            eye.style.right = '44px';
            eye.style.width = '48px';
            eye.style.height = '48px';
            eye.style.marginTop = '0';
            eye.style.zIndex = '100004';
            // also shrink internal img
            const img = document.getElementById('helperEyeImg');
            if (img) img.style.width = '100%';
        }

        _restoreEyeFromShrink() {
            const eye = document.getElementById('helperEye');
            if (!eye) return;
            if (this._eyeOriginal) {
                // restore style string (safe)
                eye.setAttribute('style', this._eyeOriginal.style);
                this._eyeOriginal = null;
            } else {
                // fallback restore approximate layout
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
                        try {
                            // stop any running solver immediately and abort fetches
                            if (window.__AssessmentHelperInstance && typeof window.__AssessmentHelperInstance.stopProcessImmediate === 'function') {
                                try { window.__AssessmentHelperInstance.stopProcessImmediate(); } catch (e) {}
                            }
                        } catch (e) {}

                        // fade out
                        launcher.style.opacity = 0;

                        // remove DOM nodes after fade completes, and clear global reference
                        launcher.addEventListener('transitionend', function handler() {
                            try {
                                // remove the whole container that holds the launcher
                                const launcherEl = document.getElementById('Launcher');
                                if (launcherEl && launcherEl.parentElement) launcherEl.parentElement.remove();

                                // remove answer UI container's parent (if present)
                                const answerEl = document.getElementById('answerContainer');
                                if (answerEl && answerEl.parentElement) answerEl.parentElement.remove();

                                // clear any global pointer to instance
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
                launcher.style.left = `${rect.left}px`;
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
            // Save original once
            if (!this._eyeOriginal) {
                this._eyeOriginal = {
                    style: eye.getAttribute('style') || '',
                    parentDisplay: eye.style.display || ''
                };
            }
            // Shrink and move under the X, inside the launcher
            eye.style.display = 'flex';
            eye.style.position = 'absolute';
            eye.style.top = '12px';
            eye.style.right = '44px';
            eye.style.width = '48px';
            eye.style.height = '48px';
            eye.style.marginTop = '0';
            eye.style.zIndex = '100004';
            // also shrink internal img
            const img = document.getElementById('helperEyeImg');
            if (img) img.style.width = '100%';
        }

        _restoreEyeFromShrink() {
            const eye = document.getElementById('helperEye');
            if (!eye) return;
            if (this._eyeOriginal) {
                // restore style string (safe)
                eye.setAttribute('style', this._eyeOriginal.style);
                this._eyeOriginal = null;
            } else {
                // fallback restore approximate layout
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

        openAISettings() {
            const panel = document.getElementById('settingsPanel');
            if (!panel) return;
            panel.innerHTML = '';
            const title = this.createEl('div', { className: 'ah-section-title', text: 'AI Settings' });
            panel.appendChild(title);

            const useApiRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%;' });
            const labelUse = this.createEl('label', { text: 'Use Groq (direct API):', style: 'min-width:160px;' });
            const inputUse = this.createEl('input', { type: 'checkbox' });
            inputUse.checked = (localStorage.getItem(this.settingsKeys.ai_use_api) === 'true');
            useApiRow.appendChild(labelUse); useApiRow.appendChild(inputUse);
            panel.appendChild(useApiRow);

            const urlRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%;' });
            const urlLabel = this.createEl('label', { text: 'Groq URL:', style: 'min-width:160px;' });
            const urlInput = this.createEl('input', { type: 'text', id: 'aiGroqUrlInput', value: localStorage.getItem(this.settingsKeys.ai_groq_url) || '//api.groq.com/openai/v1/chat/completions', style: 'flex:1;' });
            const urlReset = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Reset to default' });
            urlReset.addEventListener('click', () => { urlInput.value = '//api.groq.com/openai/v1/chat/completions'; this.saveSetting(this.settingsKeys.ai_groq_url, urlInput.value); });
            urlRow.appendChild(urlLabel); urlRow.appendChild(urlInput); urlRow.appendChild(urlReset);
            panel.appendChild(urlRow);

            // Cloudflare proxy URL row (editable) for AI Settings page as well
            const cfRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%;' });
            const cfLabel = this.createEl('label', { text: 'Cloudflare proxy URL:', style: 'min-width:160px;' });
            const cfInput = this.createEl('input', {
                type: 'text',
                id: 'aiCfUrlInput2',
                value: (localStorage.getItem(this.settingsKeys.ai_cf_url) || this.askEndpoint),
                style: 'flex:1;',
            });
            const cfReset = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Reset to default' });
            cfReset.addEventListener('click', () => {
                cfInput.value = this.askEndpoint;
                this.saveSetting(this.settingsKeys.ai_cf_url, cfInput.value);
            });
            cfRow.appendChild(cfLabel); cfRow.appendChild(cfInput); cfRow.appendChild(cfReset);
            panel.appendChild(cfRow);

            const keyRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%;' });
            const keyLabel = this.createEl('label', { text: 'Groq API key:', style: 'min-width:160px;' });
            const keyInput = this.createEl('input', { type: 'text', id: 'aiGroqKeyInput2', value: localStorage.getItem(this.settingsKeys.ai_groq_key) || '' });
            const keyReset = this.createEl('span', { className: 'ah-reset', text: '↺', title: 'Reset' });
            keyReset.addEventListener('click', () => { keyInput.value = ''; this.saveSetting(this.settingsKeys.ai_groq_key, ''); });
            keyRow.appendChild(keyLabel); keyRow.appendChild(keyInput); keyRow.appendChild(keyReset);
            panel.appendChild(keyRow);

            const modelRow = this.createEl('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%;' });
            const modelLabel = this.createEl('label', { text: 'Model:', style: 'min-width:160px;' });
            const modelInput = this.createEl('input', { type: 'text', id: 'aiGroqModelInput2', value: localStorage.getItem(this.settingsKeys.ai_groq_model) || 'llama-3.1-8b-instant' });
            modelRow.appendChild(modelLabel); modelRow.appendChild(modelInput); panel.appendChild(modelRow);

            const saveBtn = this.createEl('button', { text: 'Save', style: 'padding:8px 12px;border-radius:8px;background:#111;color:#fff;border:none;cursor:pointer;' });
            saveBtn.addEventListener('click', () => {
                this.saveSetting(this.settingsKeys.ai_use_api, inputUse.checked ? 'true' : 'false');
                this.saveSetting(this.settingsKeys.ai_groq_url, urlInput.value || '');
                this.saveSetting(this.settingsKeys.ai_groq_key, keyInput.value || '');
                this.saveSetting(this.settingsKeys.ai_groq_model, modelInput.value || '');
                this.saveSetting(this.settingsKeys.ai_cf_url, cfInput.value || this.askEndpoint);
                this.showAlert('AI settings saved', 'info');
            });
            panel.appendChild(saveBtn);
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
                // shrink launcher back (decide anchor based on current rect — restore to default 180)
                const expandRight = this._computeExpandRight();
                this._setLauncherWidthAndAnchor(180, expandRight);
                // restore eye full size & original placement
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
                        try {
                            // stop any running solver immediately and abort fetches
                            if (window.__AssessmentHelperInstance && typeof window.__AssessmentHelperInstance.stopProcessImmediate === 'function') {
                                try { window.__AssessmentHelperInstance.stopProcessImmediate(); } catch (e) {}
                            }
                        } catch (e) {}

                        // fade out
                        launcher.style.opacity = 0;

                        // remove DOM nodes after fade completes, and clear global reference
                        launcher.addEventListener('transitionend', function handler() {
                            try {
                                // remove the whole container that holds the launcher
                                const launcherEl = document.getElementById('Launcher');
                                if (launcherEl && launcherEl.parentElement) launcherEl.parentElement.remove();

                                // remove answer UI container's parent (if present)
                                const answerEl = document.getElementById('answerContainer');
                                if (answerEl && answerEl.parentElement) answerEl.parentElement.remove();

                                // clear any global pointer to instance
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

                    // --- READY / REFLECT special handling ---
                    try {
                        const href = (window.location && window.location.href) ? window.location.href : '';
                        if (href.includes('/lesson/ready') || href.includes('/lesson/reflect')) {
                            // Try to read the question via the provided XPath:
                            let readyQuestion = '';
                            try {
                                const xpathQ = '//*[@id="before-reading-poll"]/div[1]/p[2]/div/text()';
                                const res = document.evaluate(xpathQ, document, null, XPathResult.STRING_TYPE, null);
                                readyQuestion = (res && res.stringValue) ? res.stringValue.trim() : '';
                            } catch (e) {
                                readyQuestion = '';
                            }

                            // fallback options if not found
                            if (!readyQuestion) {
                                try {
                                    const altXpath = '//*[@id="before-reading-poll"]/div[1]/p[2]/div';
                                    const node = document.evaluate(altXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                                    if (node) readyQuestion = (node.textContent || '').trim();
                                } catch (e) {}
                            }
                            if (!readyQuestion) {
                                try {
                                    const fallbackNode = document.querySelector('#before-reading-poll p:nth-of-type(2) div') || document.querySelector('#before-reading-poll p div');
                                    if (fallbackNode) readyQuestion = (fallbackNode.textContent || '').trim();
                                } catch (e) {}
                            }

                            if (readyQuestion) {
                                try {
                                    console.groupCollapsed('[AssessmentHelper] Ready/Reflect detected — question fetched');
                                    console.log(readyQuestion);
                                    console.groupEnd();
                                } catch (e) {}

                                // Check for radio inputs specified by XPaths
                                const agreeXpath = '//*[@id="before-reading-poll"]/div[1]/fieldset/div/label[1]/span[1]/input';
                                const disagreeXpath = '//*[@id="before-reading-poll"]/div[1]/fieldset/div/label[2]/span[1]/input';
                                let agreeNode = null, disagreeNode = null;
                                try {
                                    agreeNode = document.evaluate(agreeXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                                } catch (e) { agreeNode = null; }
                                try {
                                    disagreeNode = document.evaluate(disagreeXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                                } catch (e) { disagreeNode = null; }

                                // If radio buttons exist — decide and click but DO NOT submit
                                if (agreeNode || disagreeNode) {
                                    const prompt = `${readyQuestion}\n\nDecide whether you AGREE or DISAGREE with this statement. Respond with exactly one word: AGREE or DISAGREE.`;
                                    try {
                                        console.groupCollapsed('[AssessmentHelper] Sent (Ready/Reflect classification) payload');
                                        console.log('q:', prompt);
                                        console.log('article:', this.cachedArticle || null);
                                        console.groupEnd();
                                    } catch (e) {}

                                    const classification = await this.fetchAnswer(prompt);
                                    try {
                                        console.groupCollapsed('[AssessmentHelper] Received (Ready/Reflect) classification');
                                        console.log(classification);
                                        console.groupEnd();
                                    } catch (e) {}

                                    const normalized = (String(classification || '')).trim().toUpperCase();
                                    let pickAgree = false;
                                    if (normalized.indexOf('AGREE') !== -1 && normalized.indexOf('DISAGREE') === -1) pickAgree = true;
                                    else if (normalized.indexOf('DISAGREE') !== -1 && normalized.indexOf('AGREE') === -1) pickAgree = false;
                                    else {
                                        if (normalized.startsWith('A')) pickAgree = true;
                                        else if (normalized.startsWith('D')) pickAgree = false;
                                        else pickAgree = true;
                                    }

                                    // Click the radio for AGREE or DISAGREE (if available)
                                    try {
                                        if (pickAgree && agreeNode) {
                                            agreeNode.click();
                                            console.log('[AssessmentHelper] Clicked: agree');
                                        } else if (!pickAgree && disagreeNode) {
                                            disagreeNode.click();
                                            console.log('[AssessmentHelper] Clicked: disagree');
                                        } else {
                                            console.log('[AssessmentHelper] Radio target missing for chosen option.');
                                        }
                                    } catch (e) {
                                        console.log('[AssessmentHelper] Error clicking radio:', e && e.message);
                                    }

                                    // --- build justification prompt that uses the user's writing settings ---
                                    const level = this.getWLevel();
                                    const minWords = this.getWMin();
                                    const maxWords = this.getWMax();
                                    const mood = this.getWMood();

                                    const starter = pickAgree ? 'I agree because' : 'I disagree because';
                                    let justificationPrompt = `${readyQuestion}\n\n${starter} `;

                                    // Add constraints
                                    if (level) justificationPrompt += `Use English level ${level}. `;
                                    if (minWords && maxWords) {
                                        justificationPrompt += `Use a minimum of ${minWords} words and a maximum of ${maxWords} words. `;
                                    } else if (minWords) {
                                        justificationPrompt += `Use a minimum of ${minWords} words. `;
                                    } else if (maxWords) {
                                        justificationPrompt += `Use a maximum of ${maxWords} words. `;
                                    }
                                    if (mood) justificationPrompt += `${mood} `;

                                    // Final instruction: produce a short justification paragraph starting with the starter
                                    justificationPrompt += `Provide a concise justification starting with "${starter}" and keep it as one coherent paragraph. Respond only with the justification (no extra commentary).`;

                                    try {
                                        console.groupCollapsed('[AssessmentHelper] Sent (Ready/Reflect justification) payload');
                                        console.log('q:', justificationPrompt);
                                        console.groupEnd();
                                    } catch (e) {}

                                    const justificationText = await this.fetchAnswer(justificationPrompt);

                                    // post-process — apply blacklist / lowercase
                                    let processed = String(justificationText || '');
                                    try {
                                        const blacklist = this.getWBlacklist() || '';
                                        if (blacklist && blacklist.length > 0) {
                                            const escaped = blacklist.split('').map(ch => ch.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
                                            if (escaped) {
                                                const re = new RegExp(escaped, 'g');
                                                processed = processed.replace(re, '');
                                            }
                                        }
                                    } catch (e) {
                                        try {
                                            const blacklist = this.getWBlacklist() || '';
                                            for (let i = 0; i < blacklist.length; i++) {
                                                const ch = blacklist[i];
                                                processed = processed.split(ch).join('');
                                            }
                                        } catch (e2) {}
                                    }

                                    if (this.getWLowercase()) processed = processed.toLowerCase();

                                    // Insert the justification into TinyMCE iframe if present, else textarea/contenteditable
                                    try {
                                        const tinyIframeLocal = document.querySelector('.tox-edit-area__iframe');
                                        const plainTextareaLocal = document.querySelector('textarea');
                                        const contentEditableLocal = document.querySelector('[contenteditable="true"]');

                                        if (tinyIframeLocal) {
                                            const iframeDoc = tinyIframeLocal.contentDocument || tinyIframeLocal.contentWindow.document;
                                            if (iframeDoc) {
                                                iframeDoc.body.innerHTML = processed;
                                                setTimeout(() => {
                                                    iframeDoc.body.innerHTML += " ";
                                                    const inputEvent = new Event('input', { bubbles: true });
                                                    iframeDoc.body.dispatchEvent(inputEvent);
                                                }, 300);
                                            } else {
                                                throw new Error('Unable to access iframe document');
                                            }
                                        } else if (plainTextareaLocal) {
                                            plainTextareaLocal.value = processed;
                                            plainTextareaLocal.dispatchEvent(new Event('input', { bubbles: true }));
                                        } else if (contentEditableLocal) {
                                            contentEditableLocal.innerHTML = processed;
                                            contentEditableLocal.dispatchEvent(new Event('input', { bubbles: true }));
                                        } else {
                                            // fallback show in bubble
                                            const answerContainerEl = document.getElementById('answerContainer');
                                            const answerContentEl = answerContainerEl ? answerContainerEl.querySelector('#answerContent') : null;
                                            if (answerContentEl) answerContentEl.textContent = processed;
                                            if (answerContainerEl) { answerContainerEl.style.display = 'flex'; answerContainerEl.style.visibility = 'visible'; answerContainerEl.classList.add('show'); }
                                        }

                                        // NOTE: do NOT submit automatically; leave radio selected and justification typed.
                                        // Stop processing (as user requested)
                                        this._stoppedByWrite = true;
                                        this.isRunning = false;
                                        try { await this.stopProcessUI(); } catch (e) {}
                                        return false;

                                    } catch (e) {
                                        // If insertion failed, show the processed text in the bubble
                                        const answerContainerEl = document.getElementById('answerContainer');
                                        const answerContentEl = answerContainerEl ? answerContainerEl.querySelector('#answerContent') : null;
                                        if (answerContentEl) answerContentEl.textContent = processed;
                                        if (answerContainerEl) { answerContainerEl.style.display = 'flex'; answerContainerEl.style.visibility = 'visible'; answerContainerEl.classList.add('show'); }

                                        this._stoppedByWrite = true;
                                        this.isRunning = false;
                                        try { await this.stopProcessUI(); } catch (e2) {}
                                        return false;
                                    }
                                } // end radios exist

                                // else — no radios present, treat as writing target
                                {
                                    let writingPrompt = `Please provide a detailed written answer based on the following question: ${readyQuestion}`;
                                    const level = this.getWLevel();
                                    const minWords = this.getWMin();
                                    const maxWords = this.getWMax();
                                    const mood = this.getWMood();
                                    if (level) writingPrompt += ` Use English level ${level}.`;
                                    if (minWords && maxWords) {
                                        writingPrompt += ` Use minimum ${minWords} words and maximum ${maxWords} words.`;
                                    } else if (minWords) {
                                        writingPrompt += ` Use minimum ${minWords} words.`;
                                    } else if (maxWords) {
                                        writingPrompt += ` Use maximum ${maxWords} words.`;
                                    }
                                    if (mood) writingPrompt += ` ${mood}`;

                                    try {
                                        console.groupCollapsed('[AssessmentHelper] Sent (Ready/Reflect writing) payload');
                                        console.log('q:', writingPrompt);
                                        console.groupEnd();
                                    } catch (e) {}

                                    const answerTextRaw = await this.fetchAnswer(writingPrompt);

                                    let answerTextProcessed = String(answerTextRaw || '');
                                    try {
                                        const blacklist = this.getWBlacklist() || '';
                                        if (blacklist && blacklist.length > 0) {
                                            const chars = blacklist.split('').map(ch => ch.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
                                            if (chars.length > 0) {
                                                const re = new RegExp(chars, 'g');
                                                answerTextProcessed = answerTextProcessed.replace(re, '');
                                            }
                                        }
                                    } catch (e) {
                                        try {
                                            const blacklist = this.getWBlacklist() || '';
                                            for (let i = 0; i < blacklist.length; i++) {
                                                const ch = blacklist[i];
                                                answerTextProcessed = answerTextProcessed.split(ch).join('');
                                            }
                                        } catch (e2) {}
                                    }

                                    if (this.getWLowercase()) {
                                        answerTextProcessed = answerTextProcessed.toLowerCase();
                                    }

                                    try {
                                        console.groupCollapsed('[AssessmentHelper] Received (Ready/Reflect writing) answer (processed)');
                                        console.log(answerTextProcessed);
                                        console.groupEnd();
                                    } catch (e) {}

                                    // Insert into editor/textarea/contentEditable
                                    try {
                                        const tinyIframeLocal = document.querySelector('.tox-edit-area__iframe');
                                        const plainTextareaLocal = document.querySelector('textarea');
                                        const contentEditableLocal = document.querySelector('[contenteditable="true"]');

                                        if (tinyIframeLocal) {
                                            const iframeDoc = tinyIframeLocal.contentDocument || tinyIframeLocal.contentWindow.document;
                                            if (iframeDoc) {
                                                iframeDoc.body.innerHTML = answerTextProcessed;
                                                setTimeout(() => {
                                                    iframeDoc.body.innerHTML += " ";
                                                    const inputEvent = new Event('input', { bubbles: true });
                                                    iframeDoc.body.dispatchEvent(inputEvent);
                                                }, 300);
                                            } else {
                                                throw new Error('Unable to access iframe document');
                                            }
                                        } else if (plainTextareaLocal) {
                                            plainTextareaLocal.value = answerTextProcessed;
                                            plainTextareaLocal.dispatchEvent(new Event('input', { bubbles: true }));
                                        } else if (contentEditableLocal) {
                                            contentEditableLocal.innerHTML = answerTextProcessed;
                                            contentEditableLocal.dispatchEvent(new Event('input', { bubbles: true }));
                                        } else {
                                            const answerContainerEl = document.getElementById('answerContainer');
                                            const answerContentEl = answerContainerEl ? answerContainerEl.querySelector('#answerContent') : null;
                                            if (answerContentEl) answerContentEl.textContent = answerTextProcessed;
                                            if (answerContainerEl) { answerContainerEl.style.display = 'flex'; answerContainerEl.style.visibility = 'visible'; answerContainerEl.classList.add('show'); }
                                        }

                                        // stop after insertion
                                        this._stoppedByWrite = true;
                                        this.isRunning = false;
                                        try { await this.stopProcessUI(); } catch (e) {}
                                        return false;
                                    } catch (e) {
                                        const answerContainerEl = document.getElementById('answerContainer');
                                        const answerContentEl = answerContainerEl ? answerContainerEl.querySelector('#answerContent') : null;
                                        if (answerContentEl) answerContentEl.textContent = (typeof answerTextProcessed === 'string' ? answerTextProcessed : String(answerTextProcessed));
                                        if (answerContainerEl) { answerContainerEl.style.display = 'flex'; answerContainerEl.style.visibility = 'visible'; answerContainerEl.classList.add('show'); }
                                        this._stoppedByWrite = true;
                                        this.isRunning = false;
                                        try { await this.stopProcessUI(); } catch (e2) {}
                                        return false;
                                    }
                                }
                            } // end if readyQuestion exists
                        } // end ready/reflect URL check
                    } catch (e) {
                        console.warn('[AssessmentHelper] Ready/Reflect handler error', e && e.message);
                    }

                    // Normal writing detection (non-ready/reflect)
                    if (tinyIframe || plainTextarea || contentEditable) {
                        let queryContentWriting = queryContent + "\n\nPlease provide a detailed written answer based on the above article and question.";
                        // append the user's writing settings
                        const level = this.getWLevel();
                        const minWords = this.getWMin();
                        const maxWords = this.getWMax();
                        const mood = this.getWMood();
                        if (level) queryContentWriting += ` Use English level ${level}.`;
                        if (minWords && maxWords) queryContentWriting += ` Use minimum ${minWords} words and maximum ${maxWords} words.`;
                        else if (minWords) queryContentWriting += ` Use minimum ${minWords} words.`;
                        else if (maxWords) queryContentWriting += ` Use maximum ${maxWords} words.`;
                        if (mood) queryContentWriting += ` ${mood}`;

                        try {
                            console.groupCollapsed('[AssessmentHelper] Sent (writing) payload');
                            console.log('q:', queryContentWriting);
                            console.log('article:', this.cachedArticle || null);
                            console.groupEnd();
                        } catch (e) {}

                        const answerText = await this.fetchAnswer(queryContentWriting);

                        try {
                            console.groupCollapsed('[AssessmentHelper] Received (writing) answer');
                            console.log(answerText);
                            console.groupEnd();
                        } catch (e) {}

                        if (!this.isRunning) return false;

                        // post-process client-side blacklist / lowercase
                        let processed = String(answerText || '');
                        try {
                            const blacklist = this.getWBlacklist() || '';
                            if (blacklist && blacklist.length > 0) {
                                const escaped = blacklist.split('').map(ch => ch.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
                                if (escaped) {
                                    const re = new RegExp(escaped, 'g');
                                    processed = processed.replace(re, '');
                                }
                            }
                        } catch (e) {
                            try {
                                const blacklist = this.getWBlacklist() || '';
                                for (let i = 0; i < blacklist.length; i++) {
                                    const ch = blacklist[i];
                                    processed = processed.split(ch).join('');
                                }
                            } catch (e2) {}
                        }

                        if (this.getWLowercase()) processed = processed.toLowerCase();

                        try {
                            if (tinyIframe) {
                                const iframeDoc = tinyIframe.contentDocument || tinyIframe.contentWindow.document;
                                if (iframeDoc) {
                                    iframeDoc.body.innerHTML = processed;
                                    setTimeout(() => {
                                        iframeDoc.body.innerHTML += " ";
                                        const inputEvent = new Event('input', { bubbles: true });
                                        iframeDoc.body.dispatchEvent(inputEvent);
                                    }, 500);
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

                            // stop after write insertion
                            this._stoppedByWrite = true;
                            this.isRunning = false;
                            try { await this.stopProcessUI(); } catch (e) {}
                            return false;
                        } catch (e) {
                            const answerContainerEl = document.getElementById('answerContainer');
                            const answerContentEl = answerContainerEl ? answerContainerEl.querySelector('#answerContent') : null;
                            if (answerContentEl) answerContentEl.textContent = (typeof processed === 'string' ? processed : String(processed));
                            if (answerContainerEl) { answerContainerEl.style.display = 'flex'; answerContainerEl.style.visibility = 'visible'; answerContainerEl.classList.add('show'); }
                            this._stoppedByWrite = true;
                            this.isRunning = false;
                            try { await this.stopProcessUI(); } catch (e2) {}
                            return false;
                        }
                    } else {
                        // Multiple choice mode (unchanged)
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
