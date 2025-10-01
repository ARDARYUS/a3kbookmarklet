// Modified bookmarklet script (code 1) — UI updated to match extension, star + Discord removed,
// eye assets from ARDARYUS/a3kbookmarklet/icons used, solver logic untouched.

const styleOverrideCSS = `
    /* Minimal overrides (spinner keyframes & small helpers) */
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
`;
// Inject minimal global style (keeps spinner keyframes if needed)
const styleSheet = document.createElement("style");
styleSheet.type = "text/css";
styleSheet.innerText = styleOverrideCSS;
document.head.appendChild(styleSheet);

class AssessmentHelper {
    constructor() {
        this.answerIsDragging = false;
        this.answerCurrentX = 0;
        this.answerCurrentY = 0;
        this.answerInitialX = 0;
        this.answerInitialY = 0;

        // Cached article content to avoid re-fetching for subsequent questions
        this.cachedArticle = null;
        this.isFetchingAnswer = false; // State to track if an answer fetch is in progress

        // Eye state and video reference (new from extension UI)
        this.eyeState = 'sleep';
        this.currentVideo = null;

        // URLs for the external libraries
        this.animeScriptUrl = 'https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js'; // Anime.js core library
        this.draggabillyScriptUrl = 'https://unpkg.com/draggabilly@3/dist/draggabilly.pkgd.min.js'; // Draggabilly library

        // Ensure the script runs after the DOM is fully loaded
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    /**
     * Initializes the helper. Creates UI elements but does not append them yet.
     * Dynamically loads necessary scripts (Anime.js, Draggabilly) sequentially.
     * Starts the intro animation after scripts are loaded.
     */
    async init() {
        try {
            // Dynamically load Anime.js first
            await this.loadScript(this.animeScriptUrl);

            // Then dynamically load Draggabilly
            await this.loadScript(this.draggabillyScriptUrl);

            // Create UI elements after scripts are loaded and available
            this.itemMetadata = {
                UI: this.createUI(), // Main draggable UI
                answerUI: this.createAnswerUI() // Smaller answer display UI
            };

            // Start the intro animation, which will handle appending and showing the UI
            this.playIntroAnimation();

        } catch (error) {
            // Handle the error - notify the user and potentially proceed without full functionality
            this.showAlert('Failed to load required scripts for the Assessment Helper. Some features may not work.', 'error');
            // Fallback: Create and show UI without animation/dragging if scripts fail
            this.itemMetadata = {
                UI: this.createUI(),
                answerUI: this.createAnswerUI()
            };
            this.showUI(true); // Pass true to indicate fallback mode (skip animation)
        }
    }

    /**
     * Dynamically loads a JavaScript script by creating a script tag.
     * Returns a Promise that resolves when the script is loaded.
     * @param {string} url - The URL of the script to load.
     * @returns {Promise<void>} A Promise that resolves when the script is loaded or rejects on error.
     */
    loadScript(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => {
                resolve();
            };
            script.onerror = (error) => {
                // Clean up the script tag on error
                script.remove();
                reject(new Error(`Failed to load script: ${url}`));
            };
            // Append the script to the document head
            document.head.appendChild(script);
        });
    }

    /**
     * Creates the main UI element (the launcher).
     * Uses the eye image/video system instead of a static icon.
     * @returns {HTMLDivElement} The container element for the main UI.
     */
    createUI() {
        const container = document.createElement("div");
        const launcher = document.createElement("div");
        launcher.id = "Launcher";
        launcher.className = "Launcher";
        // Updated styles to match extension visuals (colors, size, layout)
        launcher.style.cssText =
            "outline: none;min-height: 160px;opacity: 0;visibility: hidden;transition: opacity 0.5s ease;font-family: 'Nunito', sans-serif;width: 180px;height: 240px;background: #010203;position: fixed;border-radius: 12px;display: flex;flex-direction: column;align-items: center;color: white;font-size: 16px;top: 50%;right: 20px;transform: translateY(-50%);z-index: 99999;padding: 16px;box-shadow: 0 10px 8px rgba(0,0,0,0.2), 0 0 8px rgba(255,255,255,0.03);overflow: hidden;white-space: nowrap;";

        // Drag handle element - Draggabilly will be configured to use this
        const dragHandle = document.createElement("div");
        dragHandle.className = "drag-handle";
        dragHandle.style.cssText = "width: 100%;height: 24px;cursor: move;background: transparent;position: absolute;top: 0;";

        // Eye wrapper (replaces static UI image). Uses assets from ARDARYUS/a3kbookmarklet/icons
        const eyeWrapper = document.createElement("div");
        eyeWrapper.id = "helperEye";
        eyeWrapper.style.cssText =
            "width:90px;height:90px;margin-top:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;transform-style:preserve-3d;transition:transform 0.12s linear;will-change:transform;transform-origin:50% 40%;pointer-events:none;";

        // Idle/sleep image element
        const uiImg = document.createElement("img");
        uiImg.id = "helperEyeImg";
        uiImg.dataset.idle = "https://raw.githubusercontent.com/ARDARYUS/a3kbookmarklet/main/icons/idle.gif";
        uiImg.dataset.tilt = "https://raw.githubusercontent.com/ARDARYUS/a3kbookmarklet/main/icons/full.gif";
        uiImg.src = "https://raw.githubusercontent.com/ARDARYUS/a3kbookmarklet/main/icons/sleep.gif";
        uiImg.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;";

        // Video element for wake/sleep transitions
        const uiVideo = document.createElement("video");
        uiVideo.id = "helperEyeVideo";
        uiVideo.style.cssText = "width:100%;height:100%;object-fit:cover;display:none;pointer-events:none;";
        uiVideo.autoplay = false;
        uiVideo.loop = false;
        uiVideo.muted = true;
        uiVideo.playsInline = true;
        uiVideo.preload = "auto";

        eyeWrapper.appendChild(uiImg);
        eyeWrapper.appendChild(uiVideo);

        // Close button for the main UI
        const closeButton = document.createElement("button");
        closeButton.id = "closeButton";
        closeButton.textContent = "\u00D7"; // Unicode multiplication symbol
        closeButton.style.cssText = "position: absolute;top: 8px;right: 8px;background: none;border: none;color: white;font-size: 18px;cursor: pointer;padding: 2px 8px;transition: color 0.2s ease, transform 0.1s ease; opacity: 0.5; display: block; visibility: visible;";

        // Button to trigger the answer fetching process (visuals updated)
        const getAnswerButton = document.createElement("button");
        getAnswerButton.id = "getAnswerButton";
        getAnswerButton.style.cssText = "background: #1a1a1a;border: none;color: white;padding: 12px 20px;border-radius: 8px;cursor: pointer;margin-top: 24px;width: 120px;height: 44px;font-size: 16px;transition: background 0.2s ease, transform 0.1s ease; display: flex; justify-content: center; align-items: center;";

        // Loading indicator element uses eyebackground.gif from the ARDARYUS icons (spinner GIF)
        const loadingIndicator = document.createElement("img");
        loadingIndicator.id = "loadingIndicator";
        loadingIndicator.src = "https://raw.githubusercontent.com/ARDARYUS/a3kbookmarklet/main/icons/eyebackground.gif";
        loadingIndicator.alt = "loading";
        loadingIndicator.style.cssText = "width: 20px; height: 20px; display: none; object-fit: contain;";

        // Fallback for loadingIndicator (if image broken), show simple spinner via CSS
        loadingIndicator.onerror = function () {
            this.onerror = null;
            // Replace with inline svg spinner data uri
            this.src =
                'data:image/svg+xml;utf8,' +
                encodeURIComponent(
                    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 50 50"><path fill="none" stroke="#fff" stroke-width="4" d="M25 5 A20 20 0 0 1 45 25"/></svg>'
                );
        };

        const buttonTextSpan = document.createElement("span");
        buttonTextSpan.textContent = "work smArt-er";
        buttonTextSpan.id = "getAnswerButtonText";

        getAnswerButton.appendChild(loadingIndicator);
        getAnswerButton.appendChild(buttonTextSpan);

        // Version display
        const version = document.createElement("div");
        version.style.cssText = "position: absolute;bottom: 8px;right: 8px;font-size: 12px;opacity: 0.5;";
        version.textContent = "1.2";

        // Append elements to the launcher
        launcher.appendChild(dragHandle);
        launcher.appendChild(eyeWrapper);
        launcher.appendChild(closeButton);
        launcher.appendChild(getAnswerButton);
        launcher.appendChild(version);

        // Append launcher to the container
        container.appendChild(launcher);

        return container;
    }

    /**
     * Creates the smaller UI element to display the answer.
     * Uses manual dragging.
     * @returns {HTMLDivElement} The container element for the answer UI.
     */
    createAnswerUI() {
        const container = document.createElement("div");
        const answerContainer = document.createElement("div");
        answerContainer.id = "answerContainer";
        answerContainer.className = "answerLauncher";
        // Initial styles for the answer UI (starts hidden)
        answerContainer.style.cssText = "outline: none;min-height: 60px;transform: translateX(0px) translateY(-50%);opacity: 0;visibility: hidden;transition: opacity 0.3s ease, transform 0.3s ease;font-family: 'Nunito', sans-serif;width: 60px;height: 60px;background: #1c1e2b;position: fixed;border-radius: 8px;display: flex;justify-content: center;align-items: center;color: white;font-size: 24px;top: 50%;right: 220px;z-index: 99998;padding: 8px;box-shadow: 0 4px 8px rgba(0,0,0,0.2);overflow: hidden;white-space: normal;";

        // Drag handle for the answer UI (for manual dragging)
        const dragHandle = document.createElement("div");
        dragHandle.className = "answer-drag-handle";
        dragHandle.style.cssText = "width: 100%;height: 24px;cursor: move;background: transparent;position: absolute;top: 0;";

        const closeButton = document.createElement("button");
        closeButton.id = "closeAnswerButton";
        closeButton.style.cssText = "position: absolute;top: 8px;right: 8px;background: none;border: none;color: white;font-size: 18px;cursor: pointer;padding: 2px 8px;transition: color 0.2s ease, transform 0.1s ease;";

        // Element to display the fetched answer
        const answerContent = document.createElement("div");
        answerContent.id = "answerContent";
        answerContent.style.cssText = "padding: 0;margin: 0;word-wrap: break-word;font-size: 24px;font-weight: bold;display: flex;justify-content: center;align-items: center;width: 100%;height: 100%;";

        // Append elements to the answer container
        answerContainer.appendChild(dragHandle);
        answerContainer.appendChild(closeButton);
        answerContainer.appendChild(answerContent);

        // Append answer container to the main container
        container.appendChild(answerContainer);

        return container;
    }

    /**
     * Plays the introductory animation using Anime.js if available.
     */
    playIntroAnimation() {
        // Check if Anime.js is available before attempting animation
        if (typeof anime === 'undefined') {
            console.error("AssessmentHelper: Anime.js is not loaded. Cannot play animation.");
            this.showUI();
            return;
        }

        const imageUrl = "https://raw.githubusercontent.com/ARDARYUS/a3kbookmarklet/main/icons/eyebackground.gif";

        // Create the image element for the intro animation
        const introImgElement = document.createElement('img');
        introImgElement.src = imageUrl;
        introImgElement.id = 'introLoaderImage';
        introImgElement.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(0.5);
            width: 100px;
            height: auto;
            border-radius: 12px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            z-index: 100001;
            opacity: 0;
        `;

        // Append image to the body
        document.body.appendChild(introImgElement);

        // Anime.js animation sequence for the intro image
        anime.timeline({
            easing: 'easeInOutQuad',
            duration: 800,
            complete: (anim) => {
                // Remove the intro image element from the DOM after animation finishes
                introImgElement.remove();
                // Show the main UI and set up listeners
                this.showUI();
            }
        })
            .add({
                targets: introImgElement,
                opacity: [0, 1],
                scale: [0.5, 1],
                rotate: '1turn',
                duration: 1000,
                easing: 'easeOutExpo'
            })
            .add({
                targets: introImgElement,
                translateY: '-=20',
                duration: 500,
                easing: 'easeInOutSine'
            })
            .add({
                targets: introImgElement,
                translateY: '+=20',
                duration: 500,
                easing: 'easeInOutSine'
            })
            // Add a final fade out for the intro image before removing it
            .add({
                targets: introImgElement,
                opacity: 0,
                duration: 500,
                easing: 'linear'
            }, '+=500');
    }

    /**
     * Appends the UI elements to the DOM and makes the main UI visible with a fade-in.
     * Then sets up event listeners.
     * @param {boolean} [skipAnimation=false]
     */
    showUI(skipAnimation = false) {
        document.body.appendChild(this.itemMetadata.UI);
        document.body.appendChild(this.itemMetadata.answerUI);

        const launcher = document.getElementById('Launcher');
        if (launcher) {
            if (skipAnimation) {
                launcher.style.visibility = 'visible';
                launcher.style.opacity = 1;

                this.setupEventListeners();
            } else {
                launcher.style.visibility = 'visible';
                setTimeout(() => {
                    launcher.style.opacity = 1;
                }, 10);

                setTimeout(() => {
                    this.setupEventListeners();
                }, 500);
            }
        } else {
            this.setupEventListeners();
        }
    }

    /**
     * Helper function to display custom alerts/messages instead of native alert().
     * @param {string} message
     * @param {string} type
     */
    showAlert(message, type = 'info') {
        const alertContainer = document.createElement('div');
        alertContainer.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background-color: ${type === 'error' ? '#dc3545' : '#007bff'};
            color: white;
            padding: 15px 25px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 100000;
            opacity: 0;
            transition: opacity 0.5s ease-in-out;
            font-family: 'Nunito', sans-serif;
            font-size: 16px;
            max-width: 80%;
            text-align: center;
        `;
        alertContainer.textContent = message;
        document.body.appendChild(alertContainer);

        setTimeout(() => alertContainer.style.opacity = 1, 10);

        setTimeout(() => {
            alertContainer.style.opacity = 0;
            alertContainer.addEventListener('transitionend', () => alertContainer.remove());
        }, 5000);
    }

    /**
     * Logs data to a specified endpoint.
     * Fetches user name and class information from the page.
     */
    async logToDataEndpoint(novaButtonClickCount) {
        try {
            const element = document.evaluate('//*[@id="profile-menu"]/div', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            const elementText = element ? element.innerText.trim() : "Element not found";

            const spanElement = document.querySelector('.activeClassNameNew');
            const spanText = spanElement ? spanElement.innerText.trim() : "Span element not found";

            const timestamp = new Date();
            const isoTimestamp = timestamp.toISOString();
            const normalTime = timestamp.toLocaleString();

            const os = this.getOS();
            const browser = this.getBrowser();

            let isMobile = false;
            let mobileType = 'Desktop';

            const userAgent = navigator.userAgent || navigator.vendor || window.opera;
            if (/android|ipad|iphone|ipod|blackberry|iemobile|opera mini/i.test(userAgent)) {
                isMobile = true;
                if (/android/i.test(userAgent)) {
                    mobileType = 'Android';
                } else if (/ipad|iphone|ipod/i.test(userAgent)) {
                    mobileType = 'iOS';
                } else {
                    mobileType = 'Mobile';
                }
            }

            const logMessage = `Name: ${elementText} | Class: ${spanText} | OS: ${os} | Browser: ${browser} | Mobile: ${isMobile} | MobileType: ${mobileType} | Time: ${normalTime} | ISO Time: ${isoTimestamp} | Nova Clicks: ${novaButtonClickCount}`;

            const payload = {
                text: logMessage,
                timestamp: isoTimestamp,
                os: os,
                browser: browser,
                isMobile: isMobile,
                mobileType: mobileType,
                novaClicks: novaButtonClickCount
            };

            const response = await fetch('https://f-ghost-insights-pressed.trycloudflare.com/data', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            } else {
                // successful
            }
        } catch (error) {
            // swallow to avoid breaking UI
        }
    }

    /**
     * Detects the operating system.
     * @returns {string} The detected OS.
     */
    getOS() {
        const userAgent = window.navigator.userAgent;
        let os = 'Unknown OS';
        if (userAgent.indexOf('Win') !== -1) os = 'Windows';
        else if (userAgent.indexOf('Mac') !== -1) os = 'macOS';
        else if (userAgent.indexOf('Linux') !== -1) os = 'Linux';
        else if (userAgent.indexOf('Android') !== -1) os = 'Android';
        else if (userAgent.indexOf('iOS') !== -1) os = 'iOS';
        return os;
    }

    /**
     * Detects the browser.
     * @returns {string} The detected browser.
     */
    getBrowser() {
        const userAgent = window.navigator.userAgent;
        let browser = 'Unknown Browser';
        if (userAgent.indexOf('Chrome') !== -1 && !userAgent.indexOf('Edge') !== -1) browser = 'Google Chrome';
        else if (userAgent.indexOf('Firefox') !== -1) browser = 'Mozilla Firefox';
        else if (userAgent.indexOf('Safari') !== -1 && !userAgent.indexOf('Chrome') !== -1) browser = 'Apple Safari';
        else if (userAgent.indexOf('Edge') !== -1) browser = 'Microsoft Edge';
        else if (userAgent.indexOf('Opera') !== -1 || userAgent.indexOf('OPR') !== -1) browser = 'Opera';
        else if (userAgent.indexOf('Trident') !== -1 || userAgent.indexOf('MSIE') !== -1) browser = 'Internet Explorer';
        return browser;
    }

    /**
     * Fetches an answer from the backend API based on the provided query content.
     * @param {string} queryContent - The content (article + question) to send to the API.
     * @returns {Promise<string>} A promise that resolves with the answer text or an error message.
     */
    async fetchAnswer(queryContent, retryCount = 0) {
        const MAX_RETRIES = 3; // Define maximum retry attempts
        const RETRY_DELAY_MS = 1000; // Define delay between retries in milliseconds

        try {
            const response = await fetch('https://f-ghost-insights-pressed.trycloudflare.com/ask', {
                method: 'POST',
                cache: 'no-cache', // Ensure fresh response
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    q: queryContent,
                    article: this.cachedArticle || null // Include cached article if available
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();

                // Check for specific 500 error with quota exceeded message
                if (response.status === 500 && errorBody.includes("429 You exceeded your current quota")) {
                    if (retryCount < MAX_RETRIES) {
                        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                        return this.fetchAnswer(queryContent, retryCount + 1); // Retry the call
                    } else {
                        throw new Error(`API request failed after multiple retries due to quota: ${errorBody}`);
                    }
                } else {
                    // Handle other HTTP errors without retrying
                    throw new Error(`API request failed with status ${response.status}: ${errorBody}`);
                }
            }

            const data = await response.json();

            // Return the response text or a default message
            return data.response ? String(data.response).trim() : 'No answer available'; // Ensure answer is string and trimmed
        } catch (error) {
            return `Error: ${error.message}`; // Return error message to the UI
        }
    }

    /**
     * Fetches the article content and question content from the current page DOM.
     * Caches the article content.
     * @returns {Promise<string>} A promise that resolves with the combined article and question content.
     */
    async fetchArticleContent() {
        // Select the container with the ID 'start-reading' for article content
        const articleContainer = document.querySelector('#start-reading');
        let articleContent = '';
        if (articleContainer) {
            // Select all <p> elements within the container
            const paragraphs = articleContainer.querySelectorAll('p');
            // Extract and join the text content of each <p> element
            articleContent = Array.from(paragraphs).map(p => p.textContent.trim()).join(' ');
        } else {
            // fallback: try body text (do not overwrite too aggressively)
        }

        // Select the container with the ID 'activity-component-react' for question content
        const questionContainer = document.querySelector('#activity-component-react');
        let questionContent = '';
        if (questionContainer) {
            // Extract the text content of the container
            questionContent = questionContainer.textContent.trim();
        } else {
            // fallback
        }

        // Combine article and question content
        const combinedContent = `${articleContent}\n\n${questionContent}`;
        // Cache the article content for potential future use (e.g., follow-up questions)
        this.cachedArticle = combinedContent; // Cache combined content, as it's used for the query
        return combinedContent;
    }

    /**
     * Eye helpers (copied/adapted from extension UI)
     */
    setEyeToSleep() {
        if (this.eyeState === 'full') return;
        try {
            this.clearCurrentVideo();
            const img = document.getElementById('helperEyeImg');
            const video = document.getElementById('helperEyeVideo');
            if (!img || !video) return;
            video.style.display = 'none';
            img.style.display = 'block';
            img.src = "https://raw.githubusercontent.com/ARDARYUS/a3kbookmarklet/main/icons/sleep.gif";
            this.eyeState = 'sleep';
        } catch (err) {
            // ignore
        }
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
            // Use full.gif with cache-bust to ensure refresh
            img.src = "https://raw.githubusercontent.com/ARDARYUS/a3kbookmarklet/main/icons/full.gif" + '?r=' + Date.now();
        } catch (err) {
            // ignore
        }
    }

    async handleHoverEnter() {
        if (this.eyeState === 'full') return;
        try {
            await this.playVideoOnce("https://raw.githubusercontent.com/ARDARYUS/a3kbookmarklet/main/icons/wakeup.webm");
            if (this.eyeState === 'full') return;
            const img = document.getElementById('helperEyeImg');
            const video = document.getElementById('helperEyeVideo');
            if (!img || !video) return;
            video.style.display = 'none';
            img.style.display = 'block';
            img.src = "https://raw.githubusercontent.com/ARDARYUS/a3kbookmarklet/main/icons/idle.gif" + '?r=' + Date.now();
            this.eyeState = 'idle';
        } catch (err) {
            // ignore
        }
    }

    async handleHoverLeave() {
        if (this.eyeState === 'full') return;
        try {
            await this.playVideoOnce("https://raw.githubusercontent.com/ARDARYUS/a3kbookmarklet/main/icons/gotosleep.webm");
            if (this.eyeState === 'full') return;
            this.setEyeToSleep();
        } catch (err) {
            // ignore
        }
    }

    playVideoOnce(src) {
        return new Promise((resolve) => {
            try {
                const video = document.getElementById('helperEyeVideo');
                const img = document.getElementById('helperEyeImg');
                if (!video || !img) {
                    resolve();
                    return;
                }
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
                    playPromise.catch((e) => {
                        // autoplay policy might block; fallback
                        video.removeEventListener('ended', onEnded);
                        video.removeEventListener('error', onError);
                        this.currentVideo = null;
                        setTimeout(() => resolve(), 250);
                    });
                }
            } catch (err) {
                resolve();
            }
        });
    }

    clearCurrentVideo() {
        try {
            const video = document.getElementById('helperEyeVideo');
            const img = document.getElementById('helperEyeImg');
            if (!video || !img) return;
            try {
                if (!video.paused) video.pause();
            } catch (e) { }
            try {
                video.removeAttribute('src');
                video.load();
            } catch (e) { }
            video.style.display = 'none';
            img.style.display = 'block';
            this.currentVideo = null;
        } catch (err) {
            // ignore
        }
    }

    /**
     * Sets up all event listeners for the UI elements, including Draggabilly
     * for the main UI and manual drag for the answer UI.
     * Also adds visual feedback for button states and loading.
     */
    setupEventListeners() {
        // Get references to the UI elements. Check if they exist.
        const launcher = document.getElementById('Launcher');
        const answerContainer = document.getElementById('answerContainer');
        const getAnswerButton = launcher ? launcher.querySelector('#getAnswerButton') : null;
        const loadingIndicator = getAnswerButton ? getAnswerButton.querySelector('#loadingIndicator') : null;
        const buttonTextSpan = getAnswerButton ? getAnswerButton.querySelector('#getAnswerButtonText') : null;

        if (!launcher || !answerContainer) {
            return;
        }

        const closeButton = launcher.querySelector('#closeButton');
        const closeAnswerButton = answerContainer.querySelector('#closeAnswerButton'); // Get reference for answer close button

        // --- Add CSS for Spinner Animation and Visual Cues (if not already present) ---
        if (!document.getElementById('assessment-helper-styles')) {
            const style = document.createElement('style');
            style.id = 'assessment-helper-styles';
            style.textContent = `
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                /* Hover effect for close buttons */
                #closeButton:hover, #closeAnswerButton:hover {
                    color: #ff6b6b;
                    opacity: 1 !important;
                }
                /* Active (pressed) effect for close buttons */
                #closeButton:active, #closeAnswerButton:active {
                    color: #e05252;
                    transform: scale(0.95);
                }
                /* Hover effect for getAnswerButton */
                #getAnswerButton:hover {
                    background: #454545;
                }
                /* Active (pressed) effect for getAnswerButton */
                #getAnswerButton:active {
                    background: #4c4e5b;
                    transform: scale(0.98);
                }
                /* Disabled state for getAnswerButton */
                #getAnswerButton:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
                /* Animation for answer container when it appears */
                .answerLauncher.show {
                    opacity: 1;
                    visibility: visible;
                    transform: translateY(-50%) scale(1);
                }
            `;
            document.head.appendChild(style);
        }

        // --- Draggabilly for Main Launcher UI ---
        if (typeof Draggabilly !== 'undefined') {
            try {
                const draggie = new Draggabilly(launcher, {
                    handle: '.drag-handle',
                    delay: 50
                });
            } catch (error) {
                // ignore draggabilly init errors
            }
        } else {
            // no draggabilly available
        }

        const answerDragHandle = answerContainer.querySelector('.answer-drag-handle');
        const answerContent = answerContainer.querySelector('#answerContent');

        if (answerDragHandle) {
            answerDragHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.answerIsDragging = true;

                const rect = answerContainer.getBoundingClientRect();
                this.answerInitialX = e.clientX - rect.left;
                this.answerInitialY = e.clientY - rect.top;

                answerContainer.style.position = 'fixed'; // It should already be fixed
            });
        }

        document.addEventListener('mousemove', (e) => {
            if (this.answerIsDragging && answerContainer) {
                e.preventDefault();

                let newX = e.clientX - this.answerInitialX;
                let newY = e.clientY - this.answerInitialY;

                answerContainer.style.left = `${newX}px`;
                answerContainer.style.top = `${newY}px`;

                answerContainer.style.right = null;
                answerContainer.style.bottom = null;
                answerContainer.style.transform = 'none';
            }
        });

        document.addEventListener('mouseup', () => {
            this.answerIsDragging = false;
        });

        document.addEventListener('mouseleave', () => {
            this.answerIsDragging = false;
        });

        if (closeButton) {
            closeButton.addEventListener('click', () => {
                launcher.style.opacity = 0;
                launcher.addEventListener('transitionend', function handler() {
                    if (parseFloat(launcher.style.opacity) === 0) {
                        launcher.style.visibility = 'hidden';
                        launcher.removeEventListener('transitionend', handler);
                    }
                });
            });

            closeButton.addEventListener('mousedown', () => { closeButton.style.transform = 'scale(0.95)'; });
            closeButton.addEventListener('mouseup', () => { closeButton.style.transform = 'scale(1)'; });
        }

        // Close button for the answer UI
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
                });
            });

            closeAnswerButton.addEventListener('mousedown', () => { closeAnswerButton.style.transform = 'scale(0.95)'; });
            closeAnswerButton.addEventListener('mouseup', () => { closeAnswerButton.style.transform = 'scale(1)'; });
        }

        if (getAnswerButton) {
            // incorporate eye hover behavior from extension UI
            getAnswerButton.addEventListener('mouseenter', async () => {
                if (this.eyeState === 'full') return;
                if (this.eyeState === 'idle') return;
                try {
                    await this.handleHoverEnter();
                } catch (e) {
                    // ignore
                }
                getAnswerButton.style.background = '#454545';
            });

            getAnswerButton.addEventListener('mouseleave', async () => {
                try {
                    await this.handleHoverLeave();
                } catch (e) {
                    // ignore
                }
                getAnswerButton.style.background = '#1a1a1a';
            });

            getAnswerButton.addEventListener('mousedown', () => { getAnswerButton.style.transform = 'scale(0.98)'; });
            getAnswerButton.addEventListener('mouseup', () => { getAnswerButton.style.transform = 'scale(1)'; });

            getAnswerButton.addEventListener('click', async () => {
                // set full-eye immediately on click to match extension
                try {
                    this.setEyeToFull();
                } catch (e) {
                    // ignore
                }

                let novaButtonClickCount = 1;

                if (this.isFetchingAnswer) {
                    return;
                }

                this.isFetchingAnswer = true;
                getAnswerButton.disabled = true; // Disable button
                if (buttonTextSpan) buttonTextSpan.style.display = 'none'; // Hide text
                if (loadingIndicator) loadingIndicator.style.display = 'block'; // Show spinner

                await this.logToDataEndpoint(novaButtonClickCount);

                const processQuestion = async (excludedAnswers = []) => {
                    try {
                        let queryContent = await this.fetchArticleContent();

                        queryContent += "\n\nPROVIDE ONLY A ONE-LETTER ANSWER THAT'S IT NOTHING ELSE (A, B, C, or D).";

                        if (excludedAnswers.length > 0) {
                            queryContent += `\n\nDo not pick letter ${excludedAnswers.join(', ')}.`;
                        }

                        const answer = await this.fetchAnswer(queryContent);

                        answerContent.textContent = answer;

                        answerContainer.style.display = 'flex'; // Use flex to center content
                        answerContainer.style.visibility = 'visible';
                        answerContainer.classList.add('show'); // Trigger animation

                        if (answer && ['A', 'B', 'C', 'D'].includes(answer.trim()) && !excludedAnswers.includes(answer.trim())) {
                            const trimmedAnswer = answer.trim();

                            const options = document.querySelectorAll('[role="radio"]');

                            const index = trimmedAnswer.charCodeAt(0) - 'A'.charCodeAt(0);

                            if (options[index]) {
                                options[index].click();

                                await new Promise(resolve => setTimeout(async () => {
                                    // Find the Submit button
                                    const submitButton = Array.from(document.querySelectorAll('button'))
                                        .find(button => button.textContent.trim() === 'Submit');

                                    if (submitButton) {
                                        submitButton.click(); // Simulate clicking the Submit button

                                        // Wait for the page to process the submission and potentially show feedback/next button
                                        await new Promise(resolve => setTimeout(async () => {
                                            // Find the button that appears after submission (usually "Next" or "Try again")
                                            const nextButton = document.getElementById('feedbackActivityFormBtn');

                                            if (nextButton) {
                                                const buttonText = nextButton.textContent.trim();

                                                // Click the next/retry button
                                                nextButton.click();

                                                if (buttonText === 'Try again') {
                                                    await new Promise(resolve => setTimeout(async () => {
                                                        answerContainer.style.display = 'none';
                                                        answerContainer.classList.remove('show');
                                                        await processQuestion([...excludedAnswers, trimmedAnswer]);
                                                        resolve();
                                                    }, 1000));
                                                } else {
                                                    await new Promise(resolve => setTimeout(async () => {
                                                        const newQuestionRadio = document.querySelector('[role="radio"]');
                                                        const newSubmitButton = Array.from(document.querySelectorAll('button'))
                                                            .find(button => button.textContent.trim() === 'Submit');
                                                        if (newSubmitButton && newQuestionRadio) {
                                                            answerContainer.style.display = 'none';
                                                            answerContainer.classList.remove('show');
                                                            await processQuestion();
                                                        } else {
                                                            answerContent.textContent = "Processing complete or no more questions found.";
                                                        }
                                                        resolve();
                                                    }, 1500));
                                                }
                                            } else {
                                                answerContent.textContent = 'Submit processed, but next step button not found.';
                                            }
                                            resolve();
                                        }, 1000));
                                    } else {
                                        answerContent.textContent = 'Error: Submit button not found.';
                                    }
                                    resolve();
                                }, 500));
                            } else {
                                answerContent.textContent = `Error: Option ${trimmedAnswer} not found on page.`;
                            }
                        } else {
                            // If model returned something else, show it in bubble (unchanged behavior)
                        }
                    } catch (error) {
                        answerContent.textContent = `Error: ${error.message}`;
                        answerContainer.style.display = 'flex';
                        answerContainer.style.visibility = 'visible';
                        answerContainer.classList.add('show');
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
    }
}

const helper = new AssessmentHelper();


