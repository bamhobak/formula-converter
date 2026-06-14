// ==UserScript==
// @name         네이버 블로그 수식 텍스트 변환기
// @namespace    http://tampermonkey.net/
// @version      1.0.82
// @description  클립보드 텍스트 FAB 클릭 → 수식 자동 삽입
// @author
// @updateURL    https://raw.githubusercontent.com/bamhobak/formula-converter/main/formula-converter.user.js
// @downloadURL  https://raw.githubusercontent.com/bamhobak/formula-converter/main/formula-converter.user.js
// @match        https://blog.naver.com/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    if (document.querySelector('.nfc-fab')) return;

    // ── 변환 로직 ──────────────────────────────────────────────
    function stripEmoji(text) {
        return text
            // Emoji_Presentation: 기본 이모지(😀 🎉 등)만 제거
            // Extended_Pictographic 대신 사용 — ◆ ▶ ○ 같은 도형 기호는 제외됨
            .replace(/\p{Emoji_Presentation}/gu, '')
            // 국기 이모지 (지역 지시자 기호 쌍)
            .replace(/[\u{1F1E0}-\u{1F1FF}]{2}/gu, '')
            // 변형 선택자·ZWJ·키캡 결합자 제거
            .replace(/[︀-️‍⃣]/g, '');
    }

    function charUnits(ch) { return ch.charCodeAt(0) > 127 ? 2 : 1; }
    function wordUnits(w) { return [...w].reduce((s, c) => s + charUnits(c), 0); }

    function convertPara(text, limit) {
        const words = text.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
        if (!words.length) return '';
        const lines = [];
        let line = [], units = 0;
        for (const w of words) {
            const wu = wordUnits(w);
            if (line.length && units + 1 + wu > limit) {
                lines.push(line.join(' '));
                line = [w]; units = wu;
            } else {
                if (line.length) units++;
                line.push(w); units += wu;
            }
        }
        if (line.length) lines.push(line.join(' '));
        return lines.map(l => `\\${alignMode}align ` + l.replace(/ /g, '\\ ')).join('');
    }

    function convert(text, limit) {
        const trimmed = stripEmoji(text).trim();
        if (!trimmed) return '';
        const lines = trimmed.split('\n');
        const parts = [];
        for (const line of lines) {
            const t = line.trim();
            if (!t) {
                parts.push(`\\${alignMode}align `);
            } else {
                const c = convertPara(t, limit);
                if (c) parts.push(c);
            }
        }
        return parts.join('');
    }

    let lineLimit = GM_getValue('lineLimit', 34);
    let alignMode = GM_getValue('alignMode', 'C'); // 'C' = Calign, 'L' = Lalign

    // ── 서식 색상 치환 ────────────────────────────────────────
    const FMT_COLORS = { bold: '#D76600', underline: '#0B842F', italic: '#1292C9', bgColor: '#950065', strike: '#C2C2C2' };

    function parseColor(s) {
        s = s.trim();
        if (/^#[0-9a-fA-F]{6}$/i.test(s)) return s.toLowerCase();
        if (/^#[0-9a-fA-F]{3}$/i.test(s)) return '#' + s.slice(1).split('').map(c => c + c).join('');
        const m = s.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (m) return '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('');
        return null;
    }

    function pickFmtColor(f) {
        if (f.textColor) return f.textColor;
        if (f.bgColor) return FMT_COLORS.bgColor;
        if (f.bold) return FMT_COLORS.bold;
        if (f.underline) return FMT_COLORS.underline;
        if (f.italic) return FMT_COLORS.italic;
        if (f.strike) return FMT_COLORS.strike;
        return null;
    }

    function extractSegments(rootEl) {
        const segs = [];
        function walk(node, f) {
            if (node.nodeType === 3) {
                if (node.textContent) segs.push({ text: node.textContent, color: pickFmtColor(f) });
                return;
            }
            if (node.nodeType !== 1) return;
            const tag = node.tagName.toUpperCase();
            if (tag === 'SCRIPT' || tag === 'STYLE') return;
            if (tag === 'BR') { segs.push({ text: '\n', color: null }); return; }
            const nf = { ...f };
            const st = node.getAttribute('style') || '';
            if (tag === 'B' || tag === 'STRONG' || /font-weight\s*:\s*(bold|[6-9]\d\d|[1-9]\d{3})/i.test(st)) nf.bold = true;
            if (tag === 'I' || tag === 'EM' || /font-style\s*:\s*italic/i.test(st)) nf.italic = true;
            if (tag === 'U' || /text-decoration[^:]*:[^;]*underline/i.test(st)) nf.underline = true;
            if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE' || /text-decoration[^:]*:[^;]*line-through/i.test(st)) nf.strike = true;
            const bgM = st.match(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+)/i);
            if (bgM) {
                const bg = bgM[1].toLowerCase();
                const rgbM = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (!/^(transparent|initial|inherit|unset|none|white|#fff(fff)?)$/.test(bg) &&
                    !(rgbM && +rgbM[1] >= 240 && +rgbM[2] >= 240 && +rgbM[3] >= 240)) nf.bgColor = true;
            }
            // 글자색 (color 속성 및 <font color>)
            if (!nf.textColor) {
                const colM = st.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+)/i);
                if (colM) { const hex = parseColor(colM[1]); if (hex && hex !== '#000000') nf.textColor = hex; }
                if (tag === 'FONT') {
                    const fc = node.getAttribute('color');
                    if (fc) { const hex = parseColor(fc); if (hex && hex !== '#000000') nf.textColor = hex; }
                }
            }
            for (const child of node.childNodes) walk(child, nf);
            if (/^(P|DIV|LI|H[1-6]|TR|TD|TH)$/.test(tag)) {
                if (!segs.length || segs[segs.length - 1].text !== '\n') segs.push({ text: '\n', color: null });
            }
        }
        walk(rootEl, {});
        return segs;
    }

    function convertFromHtml(htmlStr, limit) {
        const frag = (htmlStr.match(/<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/) || [, htmlStr])[1];
        const div = document.createElement('div');
        div.innerHTML = frag;
        const segs = extractSegments(div);
        if (!segs.some(s => s.color !== null)) return null;

        const rawLines = [];
        let cur = [];
        for (const s of segs) {
            if (s.text === '\n') { rawLines.push(cur); cur = []; } else cur.push(s);
        }
        if (cur.length) rawLines.push(cur);
        if (rawLines.length && rawLines[rawLines.length - 1].every(s => !s.text.trim())) rawLines.pop();

        const parts = [];
        for (const lineSegs of rawLines) {
            // 원본 공백 유무를 추적하며 토큰 생성
            const tokens = [];
            let prevTrailingSpace = false;
            for (const { text, color } of lineSegs) {
                const chunks = text.replace(/\t/g, ' ').split(' ');
                for (let i = 0; i < chunks.length; i++) {
                    if (!chunks[i]) continue;
                    tokens.push({ w: chunks[i], color, spaceBefore: i > 0 || prevTrailingSpace });
                }
                prevTrailingSpace = text.endsWith(' ') || text.endsWith('\t');
            }

            if (!tokens.length) { parts.push(`\\${alignMode}align `); continue; }

            // 줄 너비 제한으로 word-wrap (공백이 있는 위치에서만 줄바꿈)
            const wlines = [];
            let wl = [], wu = 0;
            for (const tok of tokens) {
                const u = wordUnits(tok.w);
                if (tok.spaceBefore && wl.length && wu + 1 + u > limit) {
                    wlines.push([...wl]);
                    wl = [{ ...tok, spaceBefore: false }];
                    wu = u;
                } else {
                    if (tok.spaceBefore && wl.length) wu++;
                    wl.push(tok);
                    wu += u;
                }
            }
            if (wl.length) wlines.push(wl);

            for (const ln of wlines) {
                let content = '';
                for (const tok of ln) {
                    const sep = (tok.spaceBefore && content) ? '\\ ' : '';
                    content += sep + (tok.color ? `\\textcolor{${tok.color}}{${tok.w}}` : tok.w);
                }
                parts.push(`\\${alignMode}align ` + content);
            }
        }
        return parts.join('');
    }

    // ── DOM 탐색 헬퍼 (same-origin iframe 포함) ───────────────
    function allDocs() {
        const docs = [document];
        document.querySelectorAll('iframe').forEach(f => {
            try { if (f.contentDocument) docs.push(f.contentDocument); } catch (_) {}
        });
        return docs;
    }

    function findIn(selector) {
        for (const doc of allDocs()) {
            try { const el = doc.querySelector(selector); if (el) return el; } catch (_) {}
        }
        return null;
    }

    function findAllIn(selector) {
        const res = [];
        for (const doc of allDocs()) {
            try { res.push(...doc.querySelectorAll(selector)); } catch (_) {}
        }
        return res;
    }

    // ── 수식 편집기 "입력" 버튼 탐색 ─────────────────────────
    function findSubmitButton() {
        const direct = findIn('.nme_button_submit');
        if (direct && direct.offsetParent !== null) return direct;
        const btns = findAllIn('button').filter(b => {
            const txt = b.textContent.replace(/\s+/g, '').trim();
            return (txt.endsWith('입력') || txt === '입력') && b.offsetParent !== null;
        });
        return btns.pop() || null;
    }

    // ── 수식 편집기 인풋 탐색 ─────────────────────────────────
    function findFormulaInput() {
        let scriptEditorEl = null;
        let scriptEditorTop = -1;
        const candidates = [];
        for (const doc of allDocs()) {
            try {
                doc.querySelectorAll('textarea').forEach(el => {
                    const rect = el.getBoundingClientRect();
                    if (el.className.includes('nme_script_editor')) {
                        if (rect.top > 0) { scriptEditorEl = el; scriptEditorTop = rect.top; }
                    } else {
                        if (rect.top > 0) candidates.push({ el, top: rect.top });
                    }
                });
            } catch (_) {}
        }
        if (!scriptEditorEl || scriptEditorTop < 0) return null;
        const above = candidates
            .filter(c => c.top < scriptEditorTop)
            .sort((a, b) => b.top - a.top);
        return above[0]?.el || null;
    }

    // ── 텍스트 주입 ───────────────────────────────────────────
    function injectText(el, text) {
        const ownerDoc = el.ownerDocument || document;
        const ownerWin = ownerDoc.defaultView || window;
        el.focus();
        if (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT') {
            el.innerHTML = '';
            ownerDoc.execCommand('insertText', false, text);
            return;
        }
        try {
            el.value = '';
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            el.dispatchEvent(new ClipboardEvent('paste', {
                clipboardData: dt, bubbles: true, cancelable: true
            }));
            if (el.value) { el.dispatchEvent(new Event('input', { bubbles: true })); return; }
        } catch (_) {}
        try {
            el.select();
            ownerDoc.execCommand('selectAll', false, null);
            ownerDoc.execCommand('insertText', false, text);
            el.dispatchEvent(new InputEvent('input', {
                bubbles: true, inputType: 'insertText', data: text
            }));
            return;
        } catch (_) {}
        try {
            const setter = Object.getOwnPropertyDescriptor(
                ownerWin.HTMLTextAreaElement?.prototype, 'value'
            )?.set;
            setter ? setter.call(el, text) : (el.value = text);
        } catch (_) { el.value = text; }
        try {
            el.dispatchEvent(new InputEvent('input', {
                bubbles: true, inputType: 'insertText', data: text
            }));
        } catch (_) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'End', code: 'End', bubbles: true }));
    }

    function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    function waitFor(finder, ms) {
        return new Promise(resolve => {
            const el = finder();
            if (el) { resolve(el); return; }
            const obs = new MutationObserver(() => {
                const found = finder();
                if (found) { obs.disconnect(); resolve(found); }
            });
            obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
            setTimeout(() => { obs.disconnect(); resolve(null); }, ms);
        });
    }

    async function copyToClipboard(text) {
        try { await navigator.clipboard.writeText(text); return; } catch (_) {}
        const t = Object.assign(document.createElement('textarea'), { value: text });
        document.body.appendChild(t); t.select();
        document.execCommand('copy'); t.remove();
    }

    // ── 대기 모드 (수식 편집기가 열릴 때까지 polling) ────────
    let armedText = '';
    let pollId = null;
    let isInjecting = false;

    function disarm() {
        if (pollId) { clearInterval(pollId); pollId = null; }
        armedText = '';
        fab.classList.remove('armed');
        fab.textContent = '변환';
    }

    function armAutoFill(converted) {
        armedText = converted;
        fab.classList.add('armed');
        fab.textContent = '✓';
        try { GM_setClipboard(converted, 'text'); } catch (_) { copyToClipboard(converted); }
        if (pollId) clearInterval(pollId);
        let filling = false;
        let polls = 0;
        const MAX_POLLS = 300;
        pollId = setInterval(async () => {
            if (filling || !armedText || isInjecting) return;
            polls++;
            if (polls > MAX_POLLS) { disarm(); return; }
            const scriptEditor = findIn('textarea.nme_script_editor');
            if (!scriptEditor || scriptEditor.offsetParent === null) return;
            filling = true;
            isInjecting = true;
            clearInterval(pollId); pollId = null;
            const textToInject = armedText;
            armedText = '';
            fab.classList.remove('armed');
            fab.textContent = '변환';
            await delay(500);
            const target = findFormulaInput();
            if (!target) {
                isInjecting = false;
                filling = false;
                showToast('수식 입력창을 찾지 못했습니다.\n수동으로 붙여넣기 하세요 (Ctrl+V)');
                return;
            }
            try { GM_setClipboard(textToInject, 'text'); } catch (_) {}
            await delay(80);
            injectText(target, textToInject);
            await delay(500);
            findSubmitButton()?.click();
            setTimeout(() => { isInjecting = false; filling = false; }, 1500);
            showToast('수식 삽입 완료!');
        }, 200);
    }

    // ── 수식 버튼 자동 클릭 시도 ─────────────────────────────
    const FORMULA_BTN_SELECTORS = [
        '.se-formula-toolbar-button',
        '[data-name="latex"]', '[data-name="math"]', '[data-name="mathBlock"]',
        '[data-type="latex"]', '[data-type="math"]',
        '[data-cmd="latex"]',  '[data-cmd="math"]',
        '[data-se-menu="latex"]', '[data-se-menu="math"]',
        '[data-name*="ath"]',  '[data-type*="ath"]',
        '.se-toolbar-item-latex', '.se-toolbar-item-math',
        '[class*="latex"]:not(script):not(style)',
        '[class*="-math"]:not(script):not(style)',
        '[aria-label="수식"]', '[aria-label*="수식"]',
        '[title="수식"]',      '[title*="수식"]',
    ];

    function tryClickFormulaButton() {
        for (const sel of FORMULA_BTN_SELECTORS) {
            try { const el = findIn(sel); if (el) { el.click(); return true; } } catch (_) {}
        }
        for (const el of findAllIn('button,a,li,div,span,td,label,em,strong')) {
            try {
                if (el.textContent.trim() === '수식' && el.offsetParent !== null) {
                    el.click(); return true;
                }
            } catch (_) {}
        }
        return false;
    }

    // ── 스타일 ──────────────────────────────────────────────
    GM_addStyle(`
        .nfc-fab {
            position: fixed; right: 24px; top: 50%; transform: translateY(-50%); z-index: 2147483647;
            width: 56px; height: 56px; border-radius: 50%;
            background: #03c75a; color: #fff; border: none;
            font-size: 13px; font-weight: 700; cursor: pointer;
            box-shadow: 0 3px 14px rgba(0,0,0,.3); user-select: none;
            transition: background .2s, transform .15s;
            display: flex; align-items: center; justify-content: center;
        }
        .nfc-fab:hover { background: #02b350; transform: translateY(-50%) scale(1.07); }
        .nfc-fab.working { background: #64b5f6; pointer-events: none; }
        .nfc-fab.armed {
            background: #1a73e8;
            animation: nfc-pulse 1.4s ease-in-out infinite;
        }
        .nfc-fab.armed:hover { background: #1558c0; }
        @keyframes nfc-pulse {
            0%,100% { box-shadow: 0 0 0 0 rgba(26,115,232,.5); }
            50%      { box-shadow: 0 0 0 10px rgba(26,115,232,0); }
        }
        .nfc-toast {
            position: fixed; right: 90px; top: 50%; transform: translateY(-50%); z-index: 2147483648;
            background: rgba(20,20,20,.82); color: #fff; border-radius: 9px;
            padding: 9px 18px; font: 13px 'Malgun Gothic', sans-serif;
            opacity: 0; transition: opacity .3s; pointer-events: none;
            max-width: 300px; line-height: 1.6; white-space: pre-line;
        }
        .nfc-toast.show { opacity: 1; }
        .nfc-cfg {
            position: fixed; right: 90px; top: 50%; transform: translateY(-50%); z-index: 2147483646;
            background: #fff; border-radius: 10px; padding: 12px 16px;
            box-shadow: 0 4px 18px rgba(0,0,0,.18);
            font: 12px 'Malgun Gothic', sans-serif; color: #444;
            display: none; align-items: center; gap: 10px; white-space: nowrap;
        }
        .nfc-cfg.show { display: flex; }
        .nfc-cfg input[type=number] { width: 48px; padding: 2px 4px; border: 1px solid #ddd; border-radius: 4px; text-align: center; font-size: 12px; }
        .nfc-cfg .nfc-sep { color: #ccc; margin: 0 2px; }
        .nfc-cfg .nfc-chk { display: flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; }
    `);

    // ── UI 생성 ──────────────────────────────────────────────
    const fab = document.createElement('button');
    fab.className = 'nfc-fab';
    fab.title = '수식 변환\n클립보드 텍스트 → 클릭\n우클릭 : 옵션 설정';
    fab.textContent = '변환';

    const toast = document.createElement('div');
    toast.className = 'nfc-toast';

    const cfg = document.createElement('div');
    cfg.className = 'nfc-cfg';
    const ver = (typeof GM_info !== 'undefined' ? GM_info.script.version : '?');
    cfg.innerHTML = `<span style="color:#bbb;font-size:10px;letter-spacing:.3px">v${ver}</span><span class="nfc-sep">│</span>줄 너비 <input type="number" min="20" max="50" value="${lineLimit}"><span class="nfc-sep">│</span><label class="nfc-chk"><input type="checkbox" id="nfc-lalign"${alignMode === 'L' ? ' checked' : ''}> 좌측정렬</label>`;

    (document.body || document.documentElement).append(fab, toast, cfg);

    // ── URL 기반 표시/숨김 (SPA 내비게이션 대응) ─────────────
    function updateFabVisibility() {
        const visible = /[?&]Redirect=(Write|Update)/i.test(location.search);
        fab.style.display = visible ? '' : 'none';
        if (!visible) cfg.classList.remove('show');
    }
    updateFabVisibility();
    window.addEventListener('popstate', updateFabVisibility);
    ['pushState', 'replaceState'].forEach(fn => {
        const orig = history[fn];
        history[fn] = function (...args) { orig.apply(history, args); setTimeout(updateFabVisibility, 50); };
    });

    const cfgNum = cfg.querySelector('input[type=number]');
    cfgNum.addEventListener('change', () => {
        const v = Math.min(50, Math.max(20, parseInt(cfgNum.value) || lineLimit));
        cfgNum.value = v;
        lineLimit = v;
        GM_setValue('lineLimit', lineLimit);
    });

    const alignChk = cfg.querySelector('#nfc-lalign');
    alignChk.addEventListener('change', () => {
        alignMode = alignChk.checked ? 'L' : 'C';
        GM_setValue('alignMode', alignMode);
    });

    fab.addEventListener('contextmenu', e => {
        e.preventDefault();
        cfg.classList.toggle('show');
    });

    document.addEventListener('click', e => {
        if (!cfg.contains(e.target) && e.target !== fab) cfg.classList.remove('show');
    });

    let fabClickPending = false;
    fab.addEventListener('click', async () => {
        if (fabClickPending) return;
        fabClickPending = true;
        setTimeout(() => { fabClickPending = false; }, 500);

        if (armedText) { disarm(); showToast('취소됨'); return; }
        if (isInjecting) return;

        // 클립보드 읽기 — readText 먼저 확보 (gesture context 안전)
        let text = '';
        try { text = (await navigator.clipboard.readText()).trim(); } catch (_) {}
        if (!text) { showToast('클립보드가 비어있습니다.'); return; }

        // 서식 감지용 HTML 읽기 (실패해도 plain text로 폴백)
        let converted = null;
        try {
            if (typeof navigator.clipboard.read === 'function') {
                const items = await navigator.clipboard.read();
                for (const item of items) {
                    if (item.types.includes('text/html') && !converted) {
                        const html = await (await item.getType('text/html')).text();
                        try { converted = convertFromHtml(html, lineLimit); } catch (_) {}
                    }
                }
            }
        } catch (_) {}
        if (!converted) {
            const raw = convert(text, lineLimit);
            if (!raw) { showToast('변환할 텍스트가 없습니다.'); return; }
            converted = raw;
        }
        const pad = `\\${alignMode}align `;
        converted = pad + converted + pad;

        // 수식 버튼 자동 클릭 시도
        const found = tryClickFormulaButton();
        if (found) {
            fab.classList.add('working');
            fab.textContent = '⏳';
            const input = await waitFor(findFormulaInput, 4000);
            fab.classList.remove('working');
            fab.textContent = '변환';
            if (input) {
                if (isInjecting) return;
                isInjecting = true;
                await delay(200);
                try { GM_setClipboard(converted, 'text'); } catch (_) {}
                await delay(80);
                injectText(input, converted);
                await delay(400);
                findSubmitButton()?.click();
                setTimeout(() => { isInjecting = false; }, 1500);
                showToast('수식 삽입 완료!');
                return;
            }
        }

        // 대기 모드: 수식 버튼 직접 클릭 시 자동 삽입
        armAutoFill(converted);
    });

    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toast._tid);
        toast._tid = setTimeout(() => toast.classList.remove('show'), 3000);
    }

})();
