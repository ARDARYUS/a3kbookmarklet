// Bookmarklet-friendly AssessmentHelper (full file) — updated endpoints
// - UI / eye behavior taken from your extension's content.js
// - No star effect, no Discord code
// - No personal/device/profile scraping (no UA/os/browser/mobile detection)
// - Keeps article scraping, sends article+question to /ask, receives answers, automates MC selection & navigation
// - Minimal event logging kept: timestamp + click count + page URL (no personal device info)
// - Dynamically loads anime.js and draggabilly if needed
// - Eye assets loaded from ARDARYUS/a3kbookmarklet/icons (raw.githubusercontent)

(function () {
    // Top-level guard
    try {
        if (document.getElementById('Launcher')) return;
    } catch (err) {}

    class AssessmentHelper {
        constructor() {
            // state
            this.answerIsDragging = false;
            this.answerInitialX = 0;
            this.answerInitialY = 0;
            this.cachedArticle = null;
            this.isFetchingAnswer = false;

            // Eye / video state
            this.eyeState = 'sleep';
            this.currentVideo = null;

            // External libs
            this.animeScriptUrl = 'https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js';
            this.draggabillyScriptUrl = 'https://unpkg.com/draggabilly@3/dist/draggabilly.pkgd.min.js';

            // Backend endpoints (REPLACED with your new Cloudflare host)
            this.dataEndpoint = 'https://f-ghost-insights-pressed.trycloudflare.com/data';
            this.askEndpoint = 'https://f-ghost-insights-pressed.trycloudflare.com/ask';

            // Asset base (raw GitHub)
            this.assetBase = 'https://raw.githubusercontent.com/ARDARYUS/a3kbookmarklet/main/icons/';

            // Ensure DOM ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.init());
            } else {
                this.init();
            }
        }

        /* ---------- util / assets ---------- */
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
                // Check if already loaded
                const existing = Array.from(document.getElementsByTagName('script')).find(s => s.src && s.src.indexOf(url) !== -1);
                if (existing) return resolve();
                const script = document.createElement('script');
                script.src = url;
                script.onload = () => resolve();
                script.onerror = () => { script.remove(); reject(new Error('Failed to load ' + url)); };
                document.head.appendChild(script);
            });
        }

        /* ---------- lifecycle ---------- */
        async init() {
            try {
                // Try to load libs but don't block UI if they fail
                await Promise.resolve(this.loadScript(this.animeScriptUrl)).catch(() => {});
                await Promise.resolve(this.loadScript(this.draggabillyScriptUrl)).catch(() => {});

                this.itemMetadata = {
                    UI: this.createUI(),
                    answerUI: this.createAnswerUI()
                };

                this.playIntroAnimation();
            } catch (err) {
                // fallback: show UI without intro
                try {
                    this.itemMetadata = {
                        UI: this.createUI(),
                        answerUI: this.createAnswerUI()
                    };
                    this.showUI(true);
                } catch (e) {}
            }
        }

        /* ---------- UI creation (mirrors extension look) ---------- */
        createUI() {
            const container = this.createEl('div');

            // Launcher
            const launcher = this.createEl('div', {
                id: 'Launcher',
                className: 'Launcher',
                style:
                    "min-height:160px;opacity:0;visibility:hidden;transition:opacity 0.5s ease;font-family:'Nunito',sans-serif;width:180px;height:240px;background:#010203;position:fixed;border-radius:12px;border:2px solid #0a0b0f;display:flex;flex-direction:column;align-items:center;color:white;font-size:16px;top:50%;right:20px;transform:translateY(-50%);z-index:99999;padding:16px;box-shadow:0 10px 8px rgba(0,0,0,0.2), 0 0 8px rgba(255,255,255,0.05);overflow:hidden;white-space:nowrap;"
            });

            const dragHandle = this.createEl('div', {
                className: 'drag-handle',
                style: 'width:100%;height:24px;cursor:move;background:transparent;position:absolute;top:0;'
            });

            // Eye wrapper + img + video (dynamic behavior copied from extension)
            const eyeWrapper = this.createEl('div', {
                id: 'helperEye',
                style:
                    'width:90px;height:90px;margin-top:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;transform-style:preserve-3d;transition:transform 0.12s linear;will-change:transform;transform-origin:50% 40%;pointer-events:none;'
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
                style: 'position:absolute;top:8px;right:8px;background:none;border:none;color:white;font-size:18px;cursor:pointer;padding:2px 8px;transition:color 0.2s ease, transform 0.1s ease;opacity:0.5;'
            });

            const getAnswerButton = this.createEl('button', {
                id: 'getAnswerButton',
                style:
                    'background:#1a1a1a;border:none;color:white;padding:12px 20px;border-radius:8px;cursor:pointer;margin-top:24px;width:120px;height:44px;font-size:16px;transition:background 0.2s ease, transform 0.1s ease;display:flex;justify-content:center;align-items:center;'
            });

            const loadingIndicator = this.createEl('img', {
                id: 'loadingIndicator',
                src: this.getUrl('icons/eyebackground.gif'),
                alt: 'loading',
                style: 'width:20px;height:20px;display:none;object-fit:contain;'
            });
            loadingIndicator.onerror = function () {
                this.onerror = null;
                this.src =
                    'data:image/svg+xml;utf8,' +
                    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 50 50"><path fill="none" stroke="#fff" stroke-width="4" d="M25 5 A20 20 0 0 1 45 25"/></svg>');
            };

            const buttonTextSpan = this.createEl('span', { text: 'start rebelling.', id: 'getAnswerButtonText' });
            getAnswerButton.appendChild(loadingIndicator);
            getAnswerButton.appendChild(buttonTextSpan);

            const version = this.createEl('div', { style: 'position:absolute;bottom:8px;right:8px;font-size:12px;opacity:0.5;', text: '1.0' });

            launcher.appendChild(dragHandle);
            launcher.appendChild(eyeWrapper);
            launcher.appendChild(closeButton);
            launcher.appendChild(getAnswerButton);
            launcher.appendChild(version);

            container.appendChild(launcher);
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

        /* ---------- intro & display ---------- */
        playIntroAnimation() {
            // If anime.js present, animate the eyebackground gif, otherwise show UI immediately
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
            try {
                document.body.appendChild(this.itemMetadata.UI);
                document.body.appendChild(this.itemMetadata.answerUI);
            } catch (e) {}
            const launcher = document.getElementById('Launcher');
            if (!launcher) { this.setupEventListeners(); return; }
            if (skipAnimation) {
                launcher.style.visibility = 'visible';
                launcher.style.opacity = 1;
                this.setupEventListeners();
            } else {
                launcher.style.visibility = 'visible';
                setTimeout(() => (launcher.style.opacity = 1), 10);
                setTimeout(() => this.setupEventListeners(), 500);
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

        /* ---------- article/question fetching ---------- */
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
                const combinedContent = `${articleContent}\n\n${questionContent}`;
                this.cachedArticle = combinedContent;
                return combinedContent;
            } catch (err) {
                return '';
            }
        }

        /* ---------- backend interaction ---------- */
        async fetchAnswer(queryContent, retryCount = 0) {
            const MAX_RETRIES = 3, RETRY_DELAY_MS = 1000;
            try {
                const response = await fetch(this.askEndpoint, {
                    method: 'POST',
                    cache: 'no-cache',
                    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                    body: JSON.stringify({ q: queryContent, article: this.cachedArticle || null })
                });
                if (!response.ok) {
                    const text = await response.text();
                    if (response.status === 500 && text.includes("429 You exceeded your current quota") && retryCount < MAX_RETRIES) {
                        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                        return this.fetchAnswer(queryContent, retryCount + 1);
                    }
                    throw new Error(`API error ${response.status}: ${text}`);
                }
                const data = await response.json();
                if (data && (data.response || data.answer)) return String(data.response || data.answer).trim();
                return 'No answer available';
            } catch (err) {
                return `Error: ${err.message}`;
            }
        }

        /* ---------- minimal event logging (no personal/device info) ---------- */
        async logButtonEvent(novaButtonClickCount) {
            try {
                const payload = {
                    event: 'nova_click',
                    novaClicks: novaButtonClickCount,
                    timestamp: new Date().toISOString(),
                    page: location.href
                };
                await fetch(this.dataEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } catch (e) {
                // silent fail
            }
        }

        /* ---------- Eye helpers (copied/adapted) ---------- */
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
            if (this.eyeState === 'full' || this.eyeState === 'idle') return;
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

        /* ---------- event wiring & main behavior ---------- */
        setupEventListeners() {
            try {
                const launcher = document.getElementById('Launcher');
                const answerContainer = document.getElementById('answerContainer');
                const getAnswerButton = launcher ? launcher.querySelector('#getAnswerButton') : null;
                const loadingIndicator = getAnswerButton ? getAnswerButton.querySelector('#loadingIndicator') : null;
                const buttonTextSpan = getAnswerButton ? getAnswerButton.querySelector('#getAnswerButtonText') : null;

                if (!launcher || !answerContainer) return;

                const closeButton = launcher.querySelector('#closeButton');
                const closeAnswerButton = answerContainer.querySelector('#closeAnswerButton');

                this.applyStylesOnce('assessment-helper-styles', `
                    #closeButton:hover, #closeAnswerButton:hover { color: #ff6b6b; opacity: 1 !important; }
                    #closeButton:active, #closeAnswerButton:active { color: #e05252; transform: scale(0.95); }
                    #getAnswerButton { position: relative; z-index: 100001; transition: background 0.2s ease, transform 0.1s ease; }
                    #getAnswerButton:hover { background: #454545 !important; }
                    #getAnswerButton:active { background: #4c4e5b !important; transform: scale(0.98); }
                    #getAnswerButton:disabled { opacity: 0.6; cursor: not-allowed; }
                    .answerLauncher.show { opacity: 1; visibility: visible; transform: translateY(-50%) scale(1); }
                    @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)}}
                    #loadingIndicator { display: inline-block; vertical-align: middle; }
                `);

                // Draggabilly
                if (typeof Draggabilly !== 'undefined') {
                    try { new Draggabilly(launcher, { handle: '.drag-handle', delay: 50 }); } catch (e) {}
                }

                // Answer drag
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

                // close main
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

                // close answer
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

                // getAnswer interactions (eye hover + click sets full)
                if (getAnswerButton) {
                    getAnswerButton.addEventListener('mouseenter', async () => {
                        if (this.eyeState === 'full' || this.eyeState === 'idle') return;
                        try { await this.handleHoverEnter(); } catch (e) {}
                        getAnswerButton.style.background = '#454545';
                    });

                    getAnswerButton.addEventListener('mouseleave', async () => {
                        try { await this.handleHoverLeave(); } catch (e) {}
                        getAnswerButton.style.background = '#1a1a1a';
                    });

                    getAnswerButton.addEventListener('mousedown', () => (getAnswerButton.style.transform = 'scale(0.98)'));
                    getAnswerButton.addEventListener('mouseup', () => (getAnswerButton.style.transform = 'scale(1)'));

                    getAnswerButton.addEventListener('click', async () => {
                        // Visual: set eye to full immediately
                        try { this.setEyeToFull(); } catch (e) {}

                        if (this.isFetchingAnswer) return;
                        this.isFetchingAnswer = true;
                        getAnswerButton.disabled = true;
                        if (buttonTextSpan) buttonTextSpan.style.display = 'none';
                        if (loadingIndicator) loadingIndicator.style.display = 'block';

                        // minimal logging of button press
                        await this.logButtonEvent(1);

                        const processQuestion = async (excludedAnswers = []) => {
                            try {
                                let queryContent = await this.fetchArticleContent();

                                // If a writing editor exists, we may want to request a full written answer.
                                const writingBox = document.querySelector('.tox-edit-area__iframe');

                                if (writingBox) {
                                    queryContent += "\n\nPlease provide a detailed written answer based on the above article and question.";
                                    const answerText = await this.fetchAnswer(queryContent);
                                    // Try to insert into iframe if accessible
                                    try {
                                        const iframeDoc = writingBox.contentDocument || writingBox.contentWindow.document;
                                        if (iframeDoc) {
                                            iframeDoc.body.innerHTML = answerText;
                                            setTimeout(() => {
                                                iframeDoc.body.innerHTML += " ";
                                                const inputEvent = new Event('input', { bubbles: true });
                                                iframeDoc.body.dispatchEvent(inputEvent);
                                            }, 500);
                                        }
                                    } catch (e) {
                                        // If iframe is cross-origin or not accessible, just show the answer UI
                                        const answerContainerEl = document.getElementById('answerContainer');
                                        const answerContentEl = answerContainerEl ? answerContainerEl.querySelector('#answerContent') : null;
                                        if (answerContentEl) answerContentEl.textContent = answerText;
                                        if (answerContainerEl) {
                                            answerContainerEl.style.display = 'flex';
                                            answerContainerEl.style.visibility = 'visible';
                                            answerContainerEl.classList.add('show');
                                        }
                                    }
                                } else {
                                    // Multiple choice mode: request single-letter
                                    queryContent += "\n\nPROVIDE ONLY A ONE-LETTER ANSWER THAT'S IT NOTHING ELSE (A, B, C, or D).";
                                    if (excludedAnswers.length > 0) queryContent += `\n\nDo not pick letter ${excludedAnswers.join(', ')}.`;

                                    const answer = await this.fetchAnswer(queryContent);
                                    const normalized = (answer || '').trim().toUpperCase();

                                    const answerContainerEl = document.getElementById('answerContainer');
                                    const answerContentEl = answerContainerEl ? answerContainerEl.querySelector('#answerContent') : null;
                                    if (answerContentEl) answerContentEl.textContent = normalized || answer;

                                    if (answerContainerEl) {
                                        answerContainerEl.style.display = 'flex';
                                        answerContainerEl.style.visibility = 'visible';
                                        answerContainerEl.classList.add('show');
                                    }

                                    if (['A', 'B', 'C', 'D'].includes(normalized) && !excludedAnswers.includes(normalized)) {
                                        const options = document.querySelectorAll('[role="radio"]');
                                        const index = normalized.charCodeAt(0) - 'A'.charCodeAt(0);
                                        if (options[index]) {
                                            options[index].click();
                                            await new Promise(r => setTimeout(r, 500));
                                            const submitButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Submit');
                                            if (submitButton) {
                                                submitButton.click();
                                                await new Promise(r => setTimeout(r, 1000));
                                                const nextButton = document.getElementById('feedbackActivityFormBtn');
                                                if (nextButton) {
                                                    const buttonText = nextButton.textContent.trim();
                                                    nextButton.click();
                                                    if (buttonText === 'Try again') {
                                                        await new Promise(r => setTimeout(r, 1000));
                                                        if (answerContainerEl) { answerContainerEl.style.display = 'none'; answerContainerEl.classList.remove('show'); }
                                                        await processQuestion([...excludedAnswers, normalized]);
                                                    } else {
                                                        await new Promise(r => setTimeout(r, 1500));
                                                        const newQuestionRadio = document.querySelector('[role="radio"]');
                                                        const newSubmitButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Submit');
                                                        if (newSubmitButton && newQuestionRadio) {
                                                            if (answerContainerEl) { answerContainerEl.style.display = 'none'; answerContainerEl.classList.remove('show'); }
                                                            await processQuestion();
                                                        } else {
                                                            if (answerContentEl) answerContentEl.textContent = 'Processing complete or no more questions found.';
                                                        }
                                                    }
                                                } else {
                                                    if (answerContentEl) answerContentEl.textContent = 'Submit processed, but next step button not found.';
                                                }
                                            } else {
                                                if (answerContentEl) answerContentEl.textContent = 'Error: Submit button not found.';
                                            }
                                        } else {
                                            if (answerContentEl) answerContentEl.textContent = `Error: Option ${normalized} not found on page.`;
                                        }
                                    } else {
                                        if (answerContentEl) answerContentEl.textContent = `Model returned: ${answer || 'No valid single letter'}`;
                                    }
                                }
                            } catch (err) {
                                const answerContainerEl = document.getElementById('answerContainer');
                                const answerContentEl = answerContainerEl ? answerContainerEl.querySelector('#answerContent') : null;
                                if (answerContentEl) answerContentEl.textContent = `Error: ${err.message}`;
                                if (answerContainerEl) { answerContainerEl.style.display = 'flex'; answerContainerEl.style.visibility = 'visible'; answerContainerEl.classList.add('show'); }
                            } finally {
                                this.isFetchingAnswer = false;
                                getAnswerButton.disabled = false;
                                if (loadingIndicator) loadingIndicator.style.display = 'none';
                                if (buttonTextSpan) buttonTextSpan.style.display = 'block';
                            }
                        };

                        await processQuestion();
                    });
                }
            } catch (err) {}
        }
    }

    // instantiate
    try {
        new AssessmentHelper();
    } catch (e) {}
})();
