// ==UserScript==
// @name         BYPASS UPTO v2.0
// @description  Tự động bypass link rút gọn uptolink.vip / totreview.com
// @match        *://totreview.com/*
// @match        *://totreview-*/*
// @match        *://uptolink.vip/*
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==
// deobf by huynquyenn @is_yeumotngvotam

'use strict';

// ============================================================
// CẤU HÌNH
// ============================================================
const GITHUB_TOKEN = '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';
const GITHUB_REPO = 'luntaka/Hama-v2';
const GITHUB_FILE = 'link.json';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36';
const JSCONFIG_URL = 'https://uptolink.vip/statics/jsconfig.js';
const API_CHECK_JOB = 'https://uptolink.vip/check/job';
const API_CHECK_COUNTDOWN = 'https://uptolink.vip/check/countdown';
const API_CHECK_CONTINUE = 'https://uptolink.vip/check/continue';
const GITHUB_API_BASE = 'https://api.github.com/repos/';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/';
const REQUEST_TIMEOUT = 25000; // 25 giây

// ============================================================
// BIẾN TOÀN CỤC
// ============================================================
let dashboardElement = null;   // phần tử dashboard chính
let contentElement = null;     // phần tử nội dung log
let panelElement = null;       // phần tử panel
let redirectUrl = null;        // URL đích sau khi bypass
let cachedRedirects = null;    // cache redirects từ GitHub/jsconfig
let missionId = null;          // mã nhiệm vụ (mission ID)
let targetDomain = null;       // tên miền đích
let cookieData = '';           // cookie data lấy từ response
let userAgentString = USER_AGENT; // user agent string

// Các biến cho quá trình check
let countdownSeconds = null;   // số giây đếm ngược
let countdownMessage = '';     // thông báo đếm ngược
let countdownInterval = null;  // interval ID cho đếm ngược

// Các biến cho flow bypass
let requestData = null;        // data gửi lên API
let requestHeaders = null;     // headers gửi lên API
let targetUrl = null;          // URL đích cuối cùng
let githubCacheData = null;    // dữ liệu cache từ GitHub
let rdValue = null;            // giá trị RD từ jsconfig
let jobResponse = null;        // response từ API check/job

// Các hàm callback
let onJobSuccess = null;
let onJobError = null;
let onCountdownDone = null;
let onContinueSuccess = null;
let onFinalRedirect = null;
let onRetryOrManual = null;

// Biến cho GitHub sync
let githubRepoPath = null;
let githubFilePath = null;
let githubSha = null;
let jsconfigCache = null;      // hàm xử lý cache jsconfig
let fetchFromGithubRaw = null;

// ============================================================
// HÀM TIỆN ÍCH
// ============================================================

/**
 * Hàm hex encode chuỗi (dùng cho obfuscation nhẹ khi gửi API)
 */
function hexEncode(str) {
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const hex = str.charCodeAt(i).toString(16);
        result += ('00' + hex).slice(-2);
    }
    return result;
}

/**
 * Hàm decode base64 + URI component
 */
function decodeData(b64String) {
    return decodeURIComponent(
        atob(b64String)
            .split('')
            .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
    );
}

/**
 * Trích xuất cookie từ response headers
 */
function extractCookies(responseHeaders) {
    if (!responseHeaders) return '';
    const lines = responseHeaders.split('\n');
    let cookies = '';
    lines.forEach(line => {
        if (line.toLowerCase().startsWith('set-cookie:')) {
            const cookieValue = line.substring(11).split(';')[0].trim();
            cookies += cookieValue + '; ';
        }
    });
    return cookies;
}

/**
 * Tạo URL với origin
 */
function buildOriginUrl(domain) {
    return new URL('https://' + domain).origin;
}

// ============================================================
// GIAO DIỆN DASHBOARD (Neo Dashboard)
// ============================================================

/**
 * Hiển thị log lên dashboard
 */
function addLog(message, type = 'info') {
    const icons = {
        'info': '❢',
        'system': '❢',
        'success': '✓',
        'error': '✗',
        'warn': '⚠',
        'warning': '◈'
    };
    const icon = icons[type] || '❢';

    const logLine = document.createElement('div');
    logLine.className = 'log-line ' + type;
    logLine.innerHTML =
        '<span class="log-bullet">' + icon +
        '</span><span class="log-text">' + message + '</span>';

    if (contentElement) {
        contentElement.appendChild(logLine);
        contentElement.scrollTop = contentElement.scrollHeight;
    }
}

/**
 * Hiển thị ô nhập tên miền thủ công
 */
function showManualInput() {
    // Kiểm tra xem đã có ô nhập chưa
    if (document.getElementById('neo-manual-box')) {
        addLog('Cần nhập tên miền đích thủ công', 'warn');
        return;
    }

    const manualBox = document.createElement('div');
    manualBox.id = 'manual-box';
    manualBox.className = 'manual-box';
    manualBox.innerHTML = `
      <input type="text" id="neo-manual-input" class="manual-input" placeholder="target.com / 123.xyz">
      <button id="neo-manual-btn" class="manual-submit">→ XÁC NHẬN</button>
    `;

    if (contentElement) {
        contentElement.appendChild(manualBox);
        contentElement.scrollTop = contentElement.scrollHeight;
    }

    // Xử lý nút xác nhận
    document.getElementById('neo-manual-btn').addEventListener('click', function () {
        handleManualInput();
    });
}

/**
 * Xử lý nhập tên miền thủ công
 */
function handleManualInput() {
    const input = document.getElementById('neo-manual-input');
    if (!input) return;

    const value = input.value.trim();
    if (!value) {
        addLog('Vui lòng nhập tên miền', 'error');
        return;
    }

    // Loại bỏ protocol và trailing slash
    const domain = value
        .replace(/https?:\/\//i, '')
        .replace(/\/$/, '');

    addLog('Đang xử lý: ' + domain, 'system');
    targetDomain = 'https://' + domain;

    // Bắt đầu quá trình bypass với domain nhập tay
    startBypassProcess('manual');
}

/**
 * Khởi tạo giao diện dashboard
 */
function initDashboard() {
    // Thêm CSS
    const styleElement = document.createElement('style');
    styleElement.textContent = getDashboardCSS();
    document.head.appendChild(styleElement);

    // Tạo dashboard container
    dashboardElement = document.createElement('div');
    dashboardElement.className = 'neo-dashboard';

    // Tạo header
    const header = document.createElement('div');
    header.className = 'neo-header';
    header.innerHTML = `
    <div class="neo-brand">
      <div class="neo-icon">🛡️</div>
      <span class="neo-title">BYPASS UPTO</span>
      <span class="neo-badge">v2.0</span>
    </div>
    <div class="neo-controls">
      <button class="neo-btn" id="neo-toggle" title="Thu gọn">▾</button>
    </div>
  `;

    // Tạo content area
    contentElement = document.createElement('div');
    contentElement.className = 'neo-content';

    dashboardElement.appendChild(header);
    dashboardElement.appendChild(contentElement);
    document.body.appendChild(dashboardElement);

    // Toggle thu gọn/mở rộng
    document.getElementById('neo-toggle').addEventListener('click', function (e) {
        e.stopPropagation();
        toggleDashboard();
    });

    // Click vào header để toggle (trừ nút)
    header.addEventListener('click', function (e) {
        if (e.target.tagName !== 'BUTTON') {
            toggleDashboard();
        }
    });
}

/**
 * Thu gọn/mở rộng dashboard
 */
function toggleDashboard() {
    const toggle = document.getElementById('neo-toggle');
    if (dashboardElement.classList.contains('minimized')) {
        // Mở rộng
        contentElement.style.display = 'block';
        dashboardElement.classList.remove('minimized');
        toggle.innerHTML = '▾';
    } else {
        // Thu gọn
        contentElement.style.display = 'none';
        dashboardElement.classList.add('minimized');
        toggle.innerHTML = '▴';
    }
}

/**
 * Trả về CSS cho dashboard
 */
function getDashboardCSS() {
    return `
    @keyframes glowPulse {
      0% { box-shadow: 0 0 5px rgba(0, 255, 255, 0.3), 0 0 10px rgba(0, 255, 255, 0.2); border-color: rgba(0, 255, 255, 0.5); }
      100% { box-shadow: 0 0 20px rgba(0, 255, 255, 0.6), 0 0 30px rgba(0, 255, 255, 0.3); border-color: rgba(0, 255, 255, 0.9); }
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(30px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .neo-dashboard {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 400px;
      background: rgba(8, 12, 18, 0.92);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-radius: 32px;
      border: 1px solid rgba(0, 255, 255, 0.3);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 20px rgba(0, 255, 255, 0.2);
      z-index: 2147483647;
      font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
      animation: slideUp 0.35s cubic-bezier(0.2, 0.9, 0.4, 1.1);
      transition: all 0.25s ease;
      overflow: hidden;
    }
    .neo-dashboard.minimized {
      width: auto;
      border-radius: 60px;
      backdrop-filter: blur(20px);
    }
    .neo-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 20px;
      background: linear-gradient(135deg, rgba(0, 255, 255, 0.08), rgba(0, 150, 255, 0.05));
      border-bottom: 1px solid rgba(0, 255, 255, 0.2);
      cursor: pointer;
      border-radius: 32px 32px 0 0;
    }
    .neo-dashboard.minimized .neo-header {
      border-radius: 60px;
      border-bottom: none;
      padding: 10px 20px;
    }
    .neo-brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .neo-icon {
      width: 28px;
      height: 28px;
      background: linear-gradient(145deg, #00ccff, #0099ff);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      box-shadow: 0 0 8px rgba(0, 200, 255, 0.5);
    }
    .neo-title {
      color: #ccf4ff;
      font-weight: 600;
      font-size: 15px;
      letter-spacing: 0.5px;
      text-shadow: 0 0 3px rgba(0, 255, 255, 0.5);
    }
    .neo-badge {
      background: rgba(0, 255, 255, 0.15);
      padding: 4px 8px;
      border-radius: 40px;
      font-size: 10px;
      color: #0ff;
      font-weight: 500;
      margin-left: 10px;
    }
    .neo-controls {
      display: flex;
      gap: 12px;
    }
    .neo-btn {
      background: none;
      border: none;
      color: #88ddff;
      font-size: 18px;
      cursor: pointer;
      padding: 0 4px;
      transition: all 0.2s;
      border-radius: 8px;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .neo-btn:hover {
      color: #0ff;
      background: rgba(0, 255, 255, 0.2);
      transform: scale(1.05);
    }
    .neo-content {
      padding: 16px 20px;
      max-height: 340px;
      overflow-y: auto;
      transition: all 0.25s ease;
      scrollbar-width: thin;
      scrollbar-color: #0ff #1a2a3a;
    }
    .neo-content::-webkit-scrollbar {
      width: 5px;
    }
    .neo-content::-webkit-scrollbar-track {
      background: #1a2a3a;
      border-radius: 10px;
    }
    .neo-content::-webkit-scrollbar-thumb {
      background: #0ff;
      border-radius: 10px;
    }
    .log-line {
      animation: fadeIn 0.2s ease;
      margin-bottom: 10px;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 12.5px;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      border-left: 2px solid transparent;
      padding-left: 10px;
    }
    .log-line.system {
      border-left-color: #00b0ff;
    }
    .log-line.success {
      border-left-color: #00e676;
    }
    .log-line.error {
      border-left-color: #ff1744;
    }
    .log-line.warn {
      border-left-color: #ffea00;
    }
    .log-bullet {
      font-size: 14px;
      min-width: 20px;
    }
    .log-text {
      color: #c0e0ff;
      word-break: break-word;
      line-height: 1.45;
    }
    .manual-box {
      margin-top: 12px;
      display: flex;
      gap: 8px;
      background: rgba(0, 30, 40, 0.6);
      padding: 12px;
      border-radius: 24px;
      border: 1px solid rgba(0, 255, 255, 0.25);
      backdrop-filter: blur(4px);
    }
    .manual-input {
      flex: 1;
      background: rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(0, 255, 255, 0.4);
      border-radius: 40px;
      padding: 10px 16px;
      color: #ccf4ff;
      font-size: 12px;
      outline: none;
      font-family: monospace;
      transition: all 0.2s;
    }
    .manual-input:focus {
      border-color: #0ff;
      box-shadow: 0 0 8px rgba(0, 255, 255, 0.3);
    }
    .manual-submit {
      background: linear-gradient(135deg, #00ccff, #0088cc);
      border: none;
      border-radius: 40px;
      padding: 0 20px;
      color: white;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
      transition: 0.2s;
      box-shadow: 0 2px 8px rgba(0, 200, 255, 0.3);
    }
    .manual-submit:hover {
      transform: scale(1.02);
      background: linear-gradient(135deg, #0ff, #00aaff);
      box-shadow: 0 4px 12px rgba(0, 200, 255, 0.5);
    }
    `;
}

// ============================================================
// GITHUB CACHE (Đồng bộ dữ liệu qua GitHub)
// ============================================================

/**
 * Lưu cache lên GitHub
 */
function saveGitHubCache(redirects) {
    const content = JSON.stringify(redirects);
    const encodedContent = btoa(unescape(encodeURIComponent(content)));

    const apiUrl = GITHUB_API_BASE + GITHUB_REPO + '/contents/' + GITHUB_FILE;
    const body = {
        message: 'Auto Sync: ' + missionId + ' -> ' + redirects.message,
        content: encodedContent
    };

    // Nếu có SHA (file đã tồn tại), thêm sha để cập nhật
    if (githubSha) {
        body.sha = githubSha;
    }

    const bodyStr = JSON.stringify(body);

    GM_xmlhttpRequest({
        method: 'PUT',
        url: apiUrl,
        headers: {
            'Authorization': 'token ' + GITHUB_TOKEN,
            'Accept': 'application/vnd.github.v3+json'
        },
        data: bodyStr,
        onload: function (response) {
            if (response.status >= 200 && response.status < 300) {
                addLog('Đã lưu cache GitHub', 'success');
            } else {
                addLog('Lưu cache thất bại', 'error');
            }
        }
    });
}

/**
 * Đọc cache từ GitHub
 */
function readGitHubCache(callback) {
    addLog('Đồng bộ GitHub cache...', 'system');

    const apiUrl = GITHUB_API_BASE + GITHUB_REPO + '/contents/' + GITHUB_FILE;

    GM_xmlhttpRequest({
        method: 'GET',
        url: apiUrl,
        headers: {
            'Authorization': 'token ' + GITHUB_TOKEN,
            'Accept': 'application/vnd.github.v3+json'
        },
        onload: function (response) {
            if (response.status >= 200 && response.status < 300) {
                try {
                    const data = JSON.parse(response.responseText);
                    const content = data.content;
                    const decoded = decodeData(content);
                    const parsed = JSON.parse(decoded);

                    githubSha = data.sha;
                    githubCacheData = parsed;

                    if (parsed.redirects) {
                        cachedRedirects = parsed.redirects;
                    }

                    callback(parsed);
                } catch (e) {
                    addLog('Không đọc được GitHub cache', 'error');
                    callback(null);
                }
            } else {
                addLog('Không đọc được GitHub cache', 'error');
                callback(null);
            }
        },
        onerror: function () {
            addLog('Không kết nối GitHub → nhập tay', 'error');
            showManualInput();
        }
    });
}

/**
 * Kiểm tra cache từ GitHub Raw (nhanh hơn API)
 */
function fetchGitHubRawCache(callback) {
    addLog('Kiểm tra cache GitHub...', 'system');

    const rawUrl = GITHUB_RAW_BASE + GITHUB_REPO +
        '/refs/heads/main/' + GITHUB_FILE +
        '?t=' + new Date().getTime();

    GM_xmlhttpRequest({
        method: 'GET',
        url: rawUrl,
        onload: function (response) {
            try {
                const data = JSON.parse(response.responseText);

                if (data.enabled) {
                    rdValue = data;
                    addLog('Tên Miền: ' + (data.redirects || ''), 'success');

                    if (data.redirects && data.redirects.startsWith('http')) {
                        // Có sẵn redirect trong cache
                        cachedRedirects = data.redirects;
                        startBypassProcess('cache');
                    } else {
                        addLog('Chưa có miền → nhập tay', 'warn');
                        showManualInput();
                    }
                } else {
                    addLog('Chưa có miền → nhập tay', 'warn');
                    showManualInput();
                }

                if (callback) callback(data);
            } catch (e) {
                addLog('Lỗi đọc cache', 'error');
                showManualInput();
                if (callback) callback(null);
            }
        },
        onerror: function () {
            addLog('Không kết nối GitHub → nhập tay', 'error');
            showManualInput();
        }
    });
}

// ============================================================
// JSCONFIG (Lấy cấu hình từ uptolink)
// ============================================================

/**
 * Fetch jsconfig.js từ uptolink
 */
function fetchJsConfig(callback) {
    addLog('Fetch jsconfig...', 'system');

    GM_xmlhttpRequest({
        method: 'GET',
        url: JSCONFIG_URL,
        timeout: REQUEST_TIMEOUT,
        headers: {
            'accept': '*/*',
            'referer': targetDomain || 'https://uptolink.vip',
            'user-agent': userAgentString
        },
        onload: function (response) {
            handleJsConfigResponse(response, callback);
        },
        onerror: function () {
            addLog('Lỗi jsconfig', 'error');
            if (callback) callback(null);
        }
    });
}

/**
 * Xử lý response từ jsconfig
 */
function handleJsConfigResponse(response, callback) {
    // Trích xuất cookies từ response
    cookieData = extractCookies(response.responseHeaders);

    // Tìm giá trị RD từ jsconfig
    // Pattern: var rd = "..."
    const rdMatch = response.responseText.match(/var\s+rd\s*=\s*"([^"]+)"/);

    if (!rdMatch) {
        addLog('Không lấy được RD từ jsconfig', 'error');
        if (callback) callback(null);
        return;
    }

    rdValue = rdMatch[1];
    addLog('RD thành công → bắt đầu bypass', 'success');

    // Xây dựng URL redirect
    const cleanDomain = targetDomain
        .replace(/https?:\/\//i, '')
        .replace(/\/$/, '');

    if (callback) callback(rdValue);

    // Ẩn ô nhập thủ công nếu có
    const manualBox = document.getElementById('neo-manual-box');
    if (manualBox) {
        manualBox.style.display = 'none';
    }

    // Bắt đầu quá trình bypass chính
    startCheckJob();
}

// ============================================================
// BYPASS FLOW CHÍNH
// ============================================================

/**
 * Bắt đầu quá trình bypass
 */
function startBypassProcess(source) {
    addLog('Đang xử lý (' + source + ')...', 'system');
    fetchJsConfig(function (rd) {
        if (rd) {
            startCheckJob();
        } else {
            addLog('Không lấy được cấu hình', 'error');
        }
    });
}

/**
 * Gửi request check/job - Bước 1 của bypass
 */
function startCheckJob() {
    // Xây dựng data gửi lên
    const formData = buildJobFormData();
    requestData = formData;

    // Xây dựng headers
    requestHeaders = {
        'accept': '*/*',
        'content-type': 'application/x-www-form-urlencoded',
        'content-value-random': buildOriginUrl(targetDomain),
        'origin': buildOriginUrl(targetDomain),
        'referer': targetDomain,
        'user-agent': userAgentString,
        'cookie': cookieData
    };

    addLog('Gửi yêu cầu bypass...', 'system');

    GM_xmlhttpRequest({
        method: 'POST',
        url: API_CHECK_JOB,
        data: requestData,
        headers: requestHeaders,
        timeout: REQUEST_TIMEOUT,
        onload: function (response) {
            handleJobResponse(response);
        },
        onerror: function () {
            addLog('Quá thử → nhập tay', 'error');
            showManualInput();
        },
        ontimeout: function () {
            addLog('Quá thử → nhập tay', 'error');
            showManualInput();
        }
    });
}

/**
 * Xây dựng form data cho check/job
 */
function buildJobFormData() {
    return 'screen=1366%20x%20768' +
        '&browser%5Bname%5D=Chrome' +
        '&browser%5Bversion%5D=145.0.0.0' +
        '&browser%5BmajorVersion%5D=145' +
        '&os%5Bname%5D=Windows' +
        '&os%5Bversion%5D=10.0' +
        '&mobile=false' +
        '&cookies=true';
}

/**
 * Xử lý response từ check/job
 */
function handleJobResponse(response) {
    try {
        const data = JSON.parse(response.responseText);

        if (data.status === 'success') {
            // Bắt đầu đếm ngược
            countdownSeconds = data.wait || 0;
            const step = data.step || '?';

            addLog('Đợi ' + countdownSeconds + 's (bước ' + step + ')...', 'system');

            // Bắt đầu countdown rồi gọi check/countdown
            startCountdown(function () {
                checkCountdown();
            });
        } else if (data.status === 'finish') {
            // Đã xong - chuyển hướng
            handleFinish(data);
        } else {
            addLog('Lỗi kết nối, dừng lại', 'error');
        }
    } catch (e) {
        addLog('Lỗi kết nối, dừng lại', 'error');
    }
}

/**
 * Đếm ngược trên dashboard
 */
function startCountdown(onComplete) {
    let remaining = countdownSeconds;

    countdownInterval = setInterval(function () {
        remaining--;

        // Cập nhật dòng log cuối cùng
        if (contentElement && contentElement.lastChild) {
            const lastLine = contentElement.lastChild;
            if (lastLine.classList && lastLine.classList.contains('log-line')) {
                lastLine.innerHTML =
                    '<span class="log-bullet">◗</span>' +
                    '<span class="log-text">: còn ' + remaining + 's</span>';
            }
        }

        if (remaining <= 0) {
            clearInterval(countdownInterval);
            setTimeout(function () {
                if (onComplete) onComplete();
            }, 1000);
        }
    }, 1000);
}

/**
 * Gọi API check/countdown
 */
function checkCountdown() {
    GM_xmlhttpRequest({
        method: 'POST',
        url: API_CHECK_COUNTDOWN,
        data: requestData,
        headers: requestHeaders,
        timeout: REQUEST_TIMEOUT,
        onload: function (response) {
            handleCountdownResponse(response);
        },
        onerror: function () {
            retryOrGiveUp();
        },
        ontimeout: function () {
            retryOrGiveUp();
        }
    });
}

/**
 * Xử lý response từ check/countdown
 */
function handleCountdownResponse(response) {
    try {
        const data = JSON.parse(response.responseText);

        if (data.status === 'success') {
            // Tiếp tục đếm ngược nếu cần
            if (data.wait && data.wait > 0) {
                countdownSeconds = data.wait;
                startCountdown(function () {
                    checkCountdown();
                });
            } else {
                // Đã xong countdown, gọi continue
                checkContinue();
            }
        } else if (data.status === 'finish') {
            handleFinish(data);
        } else {
            retryOrGiveUp();
        }
    } catch (e) {
        retryOrGiveUp();
    }
}

/**
 * Gọi API check/continue
 */
function checkContinue() {
    GM_xmlhttpRequest({
        method: 'POST',
        url: API_CHECK_CONTINUE,
        data: requestData,
        headers: requestHeaders,
        timeout: REQUEST_TIMEOUT,
        onload: function (response) {
            handleContinueResponse(response);
        },
        onerror: function () {
            addLog('Lỗi kết nối, dừng lại', 'error');
        },
        ontimeout: function () {
            addLog('Lỗi kết nối, dừng lại', 'error');
        }
    });
}

/**
 * Xử lý response từ check/continue
 */
function handleContinueResponse(response) {
    try {
        const data = JSON.parse(response.responseText);

        if (data.status === 'success') {
            if (data.wait && data.wait > 0) {
                countdownSeconds = data.wait;
                startCountdown(function () {
                    checkCountdown();
                });
            } else {
                handleFinish(data);
            }
        } else if (data.status === 'finish') {
            handleFinish(data);
        } else {
            retryOrGiveUp();
        }
    } catch (e) {
        retryOrGiveUp();
    }
}

/**
 * Xử lý khi đã hoàn tất bypass
 */
function handleFinish(data) {
    targetUrl = data.url || data.redirects;

    addLog('Mở khóa thành công! Chuyển hướng...', 'success');

    // Lưu lại cache
    if (targetUrl) {
        saveGitHubCache({
            redirects: targetUrl,
            message: missionId
        });
    }

    // Set referrer policy để ẩn nguồn
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'unsafe-url';
    document.head.appendChild(meta);

    // Tạo link và click tự động
    const link = document.createElement('a');
    link.href = targetDomain + '/?redirect_to_upto=' + encodeURIComponent(targetUrl);
    link.referrerPolicy = 'unsafe-url';
    document.body.appendChild(link);
    link.click();

    addLog('Hoàn tất ' + missionId + ', tiếp tục...', 'success');

    // Redirect trực tiếp sau 1 giây
    setTimeout(function () {
        window.location.href = targetUrl;
    }, 1000);
}

/**
 * Thử lại hoặc chuyển sang nhập tay
 */
function retryOrGiveUp() {
    addLog('Lỗi kết nối, dừng lại', 'error');
    showManualInput();
}

// ============================================================
// KHỞI ĐỘNG CHÍNH
// ============================================================

/**
 * Xác định mã nhiệm vụ (mission ID) từ URL
 */
function detectMissionId() {
    const urlParams = new URLSearchParams(window.location.search);
    const pathname = window.location.pathname;

    // Tách pathname thành các phần
    const pathParts = pathname
        .split('/')
        .filter(Boolean);

    if (pathParts.length === 0) return null;

    // Lấy phần cuối, bỏ .html nếu có
    let id = pathParts[pathParts.length - 1]
        .replace(/\.html$/, '');

    return id || null;
}

/**
 * Kiểm tra xem có redirect_to_upto parameter không
 */
function checkRedirectParam() {
    const urlParams = new URLSearchParams(window.location.search);

    if (urlParams.has('redirect_to_upto')) {
        const redirectTarget = urlParams.get('redirect_to_upto');
        redirectUrl = decodeURIComponent(redirectTarget);

        // Chuyển hướng trực tiếp
        window.location.href = redirectUrl;
        return true;
    }
    return false;
}

/**
 * Hàm khởi động chính
 */
function main() {
    // Kiểm tra domain
    const hostname = window.location.hostname;
    if (!hostname.includes('totreview.com') && !hostname.includes('totreview-')) {
        return; // Không phải trang cần bypass
    }

    // Kiểm tra redirect parameter
    if (checkRedirectParam()) {
        return; // Đã xử lý redirect
    }

    // Hiển thị loading
    document.body.innerHTML = `
            <div style="background:#0a0a0a; color:#e0e0e0; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 20px;">
                <h2 style="color: #ffffff; text-shadow: 0 0 15px rgba(255,255,255,0.3); font-weight: 300; letter-spacing: 2px;">ĐANG ĐIỀU HƯỚNG AN TOÀN</h2>
                <p style="color:#888; font-size: 14px; margin-top: 10px;">Xin vui lòng chờ trong giây lát...</p>
                <div style="margin-top: 20px; width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #e0e0e0; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
            </div>`;

    // Xác định mission ID
    missionId = detectMissionId();

    // Khởi tạo dashboard sau 1 giây
    setTimeout(function () {
        initDashboard();
        addLog('BYPASS UPTO ĐÃ SẴN SÀNG', 'system');

        if (missionId) {
            addLog('MÃ NHIỆM VỤ: ' + missionId, 'system');
        } else {
            addLog('Không xác định được MÃ NHIỆM VỤ', 'error');
            return;
        }

        // Bắt đầu: thử lấy cache từ GitHub trước
        fetchGitHubRawCache(function (cacheData) {
            if (!cacheData || !cacheData.redirects) {
                // Không có cache → fetch jsconfig
                fetchJsConfig(function (rd) {
                    if (!rd) {
                        addLog('Không lấy được cấu hình', 'error');
                        showManualInput();
                    }
                });
            }
        });
    }, 1000);
}

// Chạy
main();
