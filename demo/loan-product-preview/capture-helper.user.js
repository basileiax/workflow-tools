// ==UserScript==
// @name         Finance Preview Capture Helper
// @namespace    capture-helper
// @version      1.5.6
// @description  템플릿 재구축 + 코드 구조화 + 추출 안정화 + 출력 품질 향상 + HTML 정규화 케이스 추가 + HTML 정제 분기 처리
// @include      *://*/*loan-product-preview*
// @require      https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        unsafeWindow
// @run-at       document-idle
// @updateURL    https://basileiax.github.io/workflow-tools/demo/loan-product-preview/capture-helper.user.js
// @downloadURL  https://basileiax.github.io/workflow-tools/demo/loan-product-preview/capture-helper.user.js
// ==/UserScript==

(function () {
  'use strict';

  const CAP = {};

  CAP.ContainerHints = Object.freeze({
    hero: '.css-17nm87x',
    stats: '.css-1fwzr2e',
    info: '.css-1qeucds',
    notice: '.css-uj21e4',
  });

  CAP.Selectors = Object.freeze({
    CAPTURE_ROOT: '.capture-container',
    SLOT_LOGO: 'span.cap-hero-logo',
    SLOT_BANK: 'p.cap-hero-bank',
    SLOT_PRODUCT: 'p.cap-hero-product',
    SLOT_STAT_VALUES: 'p.cap-stat-value',
    SLOT_INFO: 'div.cap-info-parse',
    SLOT_NOTICE: 'div.cap-notice-parse',
    FALLBACK_HASH: Object.freeze({
      LOGO: ['img[alt="금융사 로고"]', 'img[alt*="로고"]', 'img[src*="logo"]'],
      BANK: ['p.css-137ddb8'],
      PRODUCT: ['p.css-nuxwev'],
      STAT_LABELS: ['p.css-1sv5gro'],
      STAT_VALUES: ['p.css-ce18ap'],
      INFO: ['div.css-1qeucds'],
      NOTICE: ['div.css-1lt1r61'],
    }),
    CAPTURE_BUTTON: 'cap-floating-btn'
  });

  CAP.Config = Object.freeze({
    EXTRACT_MAX_RETRIES: 10,
    EXTRACT_RETRY_DELAY: 500,
    CAPTURE_STABILIZE_DELAY: 100,
    IMAGE_TIMEOUT: 10000,
    FILENAME_MAX_LENGTH: 200,
    FILENAME_PRODUCT_SPACE_MODE: 'underscore'
  });

  CAP.Core = (function () {
    const qs = (sel, root = document) => root.querySelector(sel);
    const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

    function findFirst(selectors, root = document) {
      for (const sel of selectors) {
        const el = qs(sel, root);
        if (el) return el;
      }
      return null;
    }

    function findByText(tagSelectors, needle) {
      const nodes = qsa(tagSelectors);
      return nodes.find((el) => {
        const t = txt(el);
        return t === needle || t.includes(needle);
      }) || null;
    }

    function sleep(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }

    function waitForRaf() {
      return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }

    return { qs, qsa, txt, findFirst, findByText, sleep, waitForRaf };
  })();

  CAP.Validator = (function () {
    const { qs } = CAP.Core;
    const HINTS = CAP.ContainerHints;

    function checkBlockers() {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (!dialog) return false;
      const style = window.getComputedStyle(dialog);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const buttons = Array.from(dialog.querySelectorAll('button'));
      const hasConfirmBtn = buttons.some(btn => btn.textContent.trim() === '확인');
      if (hasConfirmBtn) {
        const msgEl = dialog.querySelector('p[class*="css-"], div[class*="css-"]');
        const msg = msgEl ? msgEl.textContent.trim() : 'Unknown Error';
        console.warn(`[CAP.Validator] ⛔ Execution Blocked. Error modal detected: "${msg}"`);
        return true;
      }
      return false;
    }

    function checkRequirements() {
      const hero = qs(HINTS.hero);
      const stats = qs(HINTS.stats);
      if (hero || stats) return true;
      console.debug('[CAP.Validator] Waiting for elements:', { heroSelector: HINTS.hero, statsSelector: HINTS.stats, heroFound: !!hero, statsFound: !!stats });
      return false;
    }

    return { checkBlockers, checkRequirements };
  })();

  CAP.Image = (function () {
    const { IMAGE_TIMEOUT } = CAP.Config;

    function toDataURL(src) {
      return new Promise((resolve) => {
        if (!src) return resolve('');
        if (src.startsWith('data:image/')) return resolve(src);
        GM_xmlhttpRequest({
          method: 'GET',
          url: src,
          responseType: 'blob',
          timeout: IMAGE_TIMEOUT,
          onload(response) {
            if (response.status === 200 && response.response) {
              const fr = new FileReader();
              fr.onload = () => resolve(String(fr.result || ''));
              fr.onerror = () => resolve('');
              fr.readAsDataURL(response.response);
            } else {
              resolve('');
            }
          },
          onerror: () => resolve(''),
          ontimeout: () => resolve('')
        });
      });
    }

    return { toDataURL };
  })();

  CAP.Filename = (function () {
    const { qs } = CAP.Core;
    const { SLOT_BANK, SLOT_PRODUCT } = CAP.Selectors;
    const { FILENAME_MAX_LENGTH, FILENAME_PRODUCT_SPACE_MODE } = CAP.Config;

    function getKstYYMMDD(d = new Date()) {
      const utc = d.getTime() + d.getTimezoneOffset() * 60 * 1000;
      const kst = new Date(utc + 9 * 60 * 60 * 1000);
      const yy = String(kst.getFullYear()).slice(-2);
      const mm = String(kst.getMonth() + 1).padStart(2, '0');
      const dd = String(kst.getDate()).padStart(2, '0');
      return `${yy}${mm}${dd}`;
    }

    function sanitize(s) {
      if (!s) return '';
      return String(s).replace(/[\u0000-\u001F\u007F]/g, '').replace(/[\\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function applySpacePolicy(s, mode) {
      if (!s) return '';
      if (mode === 'keep') return s.trim();
      if (mode === 'concat') return s.replace(/\s+/g, '');
      return s.replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    }

    function getSpaceMode() {
      const params = new URLSearchParams(window.location.search);
      const paramMode = params.get('productSpace');
      if (paramMode === 'concat' || paramMode === 'underscore' || paramMode === 'keep') return paramMode;
      return FILENAME_PRODUCT_SPACE_MODE;
    }

    function clampWithExt(name, maxLen, ext = '.png') {
      if (!maxLen || maxLen <= ext.length) return ext.replace(/^\./, '');
      const baseMax = maxLen - ext.length;
      const base = name.slice(0, baseMax);
      return base + ext;
    }

    function build() {
      const bankRaw = qs(SLOT_BANK)?.textContent?.trim() || '';
      const prodRaw = qs(SLOT_PRODUCT)?.textContent?.trim() || '';
      const mode = getSpaceMode();
      const bankSanitized = sanitize(bankRaw) || 'UNKNOWN_BANK';
      const bank = applySpacePolicy(bankSanitized, 'underscore');
      const prodSanitized = sanitize(prodRaw) || 'UNKNOWN_PRODUCT';
      const product = applySpacePolicy(prodSanitized, mode);
      const yymmdd = getKstYYMMDD();
      const baseName = `${bank}_${product}_${yymmdd}`;
      return clampWithExt(baseName, FILENAME_MAX_LENGTH, '.png');
    }

    return { getKstYYMMDD, sanitize, applySpacePolicy, build };
  })();

  CAP.Extractor = (function () {
    const { qs, qsa, txt, findFirst, findByText } = CAP.Core;
    const { toDataURL } = CAP.Image;
    const HINTS = CAP.ContainerHints;
    const FALLBACK = CAP.Selectors.FALLBACK_HASH;

    function normText(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
    function hasDigits(s) { return /[0-9]/.test(String(s || '')); }
    function isLikelyCdnUrl(src) { try { const u = new URL(src, location.href); return u.protocol.startsWith('http') && !!u.hostname; } catch { return false; } }
    function isNonSvgRaster(src) {
      const s = String(src || '').toLowerCase();
      if (!s) return false;
      if (s.endsWith('.svg') || s.includes('.svg?') || s.startsWith('data:image/svg')) return false;
      return s.endsWith('.png') || s.includes('.png?') || s.endsWith('.jpg') || s.includes('.jpg?') || s.endsWith('.jpeg') || s.includes('.jpeg?') || s.endsWith('.webp') || s.includes('.webp?') || s.startsWith('data:image/png') || s.startsWith('data:image/jpeg') || s.startsWith('data:image/webp');
    }
    function findTextAnchor(needle, scope) {
      const root = scope || document;
      const all = Array.from(root.querySelectorAll('p,span,div,h1,h2,h3,b,strong'));
      const target = String(needle || '').trim();
      return all.find((el) => normText(el.textContent) === target) || null;
    }

    function detectAdvancedListStyle(tpl) {
      const styleEls = tpl.content.querySelectorAll('style');
      for (const styleEl of styleEls) {
        const css = styleEl.textContent || '';
        if (css.includes('@counter-style circled')) {
          console.log('[CAP.Extractor] Detected: Advanced List Style');
          return true;
        }
      }
      return false;
    }

    function sanitizeLegacy(tpl) {
      const ALLOWED = new Set(['P', 'BR', 'UL', 'OL', 'LI', 'STRONG', 'SUP', 'SUB']);
      const REMOVE_WITH_CONTENT = new Set(['STYLE', 'SCRIPT', 'LINK', 'META', 'NOSCRIPT', 'IMG', 'IFRAME']);
      const BLOCK_TAGS = new Set(['P', 'UL', 'OL', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
      const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT, null);
      const nodes = [];
      let n = walker.nextNode();
      while (n) { nodes.push(n); n = walker.nextNode(); }
      for (const el of nodes) {
        if (!el.parentNode) continue;
        const tag = el.tagName;
        if (REMOVE_WITH_CONTENT.has(tag)) { el.remove(); continue; }
        if (tag === 'B') { const strong = document.createElement('strong'); while (el.firstChild) { strong.appendChild(el.firstChild); } el.parentNode.replaceChild(strong, el); continue; }
        if (tag === 'DIV') {
          const parent = el.parentNode;
          const lastChild = el.lastElementChild;
          while (el.firstChild) { parent.insertBefore(el.firstChild, el); }
          let needBr = true;
          if (lastChild && BLOCK_TAGS.has(lastChild.tagName)) { needBr = false; }
          if (needBr) { const br = document.createElement('br'); parent.replaceChild(br, el); } else { parent.removeChild(el); }
          continue;
        }
        if (!ALLOWED.has(tag)) { const parent = el.parentNode; while (el.firstChild) { parent.insertBefore(el.firstChild, el); } parent.removeChild(el); continue; }
        if (el.hasAttributes()) { const attrs = Array.from(el.attributes); for (const attr of attrs) { el.removeAttribute(attr.name); } }
      }
      tpl.content.querySelectorAll('p:empty, strong:empty, li:empty, ul:empty, ol:empty').forEach(el => el.remove());
      let result = tpl.innerHTML;
      result = result.replace(/(<\/(ul|ol|p)>)\s*<br\s*\/?>/gi, '$1');
      result = result.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>');
      return result.trim();
    }

    function sanitizeAdvanced(tpl) {
      const ALLOWED = new Set(['P', 'BR', 'UL', 'OL', 'LI', 'STRONG', 'SUP', 'SUB']);
      const REMOVE_WITH_CONTENT = new Set(['STYLE', 'SCRIPT', 'LINK', 'META', 'NOSCRIPT', 'IMG', 'IFRAME']);
      const BLOCK_TAGS = new Set(['P', 'UL', 'OL', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
      const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT, null);
      const nodes = [];
      let n = walker.nextNode();
      while (n) { nodes.push(n); n = walker.nextNode(); }
      for (const el of nodes) {
        if (!el.parentNode) continue;
        const tag = el.tagName;
        if (REMOVE_WITH_CONTENT.has(tag)) { el.remove(); continue; }
        if (tag === 'B') { const strong = document.createElement('strong'); while (el.firstChild) { strong.appendChild(el.firstChild); } el.parentNode.replaceChild(strong, el); continue; }
        if (tag === 'DIV') {
          const parent = el.parentNode;
          const lastChild = el.lastElementChild;
          while (el.firstChild) { parent.insertBefore(el.firstChild, el); }
          let needBr = true;
          if (lastChild && BLOCK_TAGS.has(lastChild.tagName)) { needBr = false; }
          if (needBr) { const br = document.createElement('br'); parent.replaceChild(br, el); } else { parent.removeChild(el); }
          continue;
        }
        if (!ALLOWED.has(tag)) { const parent = el.parentNode; while (el.firstChild) { parent.insertBefore(el.firstChild, el); } parent.removeChild(el); continue; }
        if (el.hasAttributes()) { const attrs = Array.from(el.attributes); for (const attr of attrs) { el.removeAttribute(attr.name); } }
      }
      tpl.content.querySelectorAll('p:empty, strong:empty, li:empty, ul:empty, ol:empty').forEach(el => el.remove());
      let result = tpl.innerHTML;
      result = result.replace(/(<\/(ul|ol)>)\s*<br\s*\/?>(?!\s*<p[\s>])/gi, '$1');
      result = result.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>');
      return result.trim();
    }

    function sanitizeAndNormalizeHTML(html) {
      if (!html) return '';
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      const useAdvanced = detectAdvancedListStyle(tpl);
      if (useAdvanced) { return sanitizeAdvanced(tpl); } else { return sanitizeLegacy(tpl); }
    }

    function findLogoNormalized() {
      const heroContainer = qs(HINTS.hero);
      if (heroContainer) {
        const imgs = qsa('img', heroContainer).filter((img) => { const src = img.getAttribute('src') || ''; return isNonSvgRaster(src) && isLikelyCdnUrl(src); });
        if (imgs.length) { console.log('[CAP.Extractor] Logo via: container hint'); return imgs[0]; }
      }
      const byAlt = qs('img[alt="금융사 로고"]');
      if (byAlt?.getAttribute('src')) { console.log('[CAP.Extractor] Logo via: alt hint'); return byAlt; }
      const allImgs = qsa('img').filter((img) => { const src = img.getAttribute('src') || ''; return isNonSvgRaster(src) && isLikelyCdnUrl(src); });
      for (const img of allImgs) {
        const block = img.closest('section,article,header,div') || img.parentElement;
        if (!block) continue;
        const ps = qsa('p', block).map((p) => txt(p)).filter(Boolean);
        if (ps.length >= 2) { console.log('[CAP.Extractor] Logo via: page scan heuristic'); return img; }
      }
      const fallbackLogo = findFirst(FALLBACK.LOGO);
      if (fallbackLogo) { console.log('[CAP.Extractor] Logo via: FALLBACK_HASH'); }
      return fallbackLogo;
    }

    async function extractLogo() {
      const logoImg = findLogoNormalized();
      const rawSrc = logoImg?.getAttribute('src') || '';
      console.log('[CAP.Extractor] Found logo src:', rawSrc);
      return { element: logoImg, dataURL: await toDataURL(rawSrc) };
    }

    function extractBankProduct(logoImg) {
      let bank = '', product = '', via = '';
      const heroContainer = qs(HINTS.hero);
      if (heroContainer) {
        const ps = qsa('p', heroContainer).map((p) => txt(p)).filter(Boolean);
        if (ps.length >= 2) { bank = ps[0]; product = ps[1]; via = 'container hint'; }
      }
      if ((!bank || !product) && logoImg) {
        const block = logoImg.closest('div') || logoImg.parentElement;
        if (block) {
          const ps = qsa('p', block).map((p) => txt(p)).filter(Boolean);
          if (!bank && ps[0]) { bank = ps[0]; via = via || 'logo vicinity'; }
          if (!product && ps[1]) { product = ps[1]; via = via || 'logo vicinity'; }
        }
      }
      if (!bank) { const el = findFirst(FALLBACK.BANK); if (el) { bank = txt(el); via = via || 'FALLBACK_HASH'; } }
      if (!product) { const el = findFirst(FALLBACK.PRODUCT); if (el) { product = txt(el); via = via || 'FALLBACK_HASH'; } }
      console.log('[CAP.Extractor] Bank/Product via:', via, { bank, product });
      return { bank, product };
    }

    function pickValueNearLabel(labelText, scope) {
      const root = scope || document;
      const labelNode = findTextAnchor(labelText, root);
      if (!labelNode) return '';
      const card = labelNode.closest('li,section,article,div') || labelNode.parentElement;
      if (!card) return '';
      const labelT = normText(labelNode.textContent);
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_ELEMENT, null);
      walker.currentNode = labelNode;
      let n = walker.nextNode();
      while (n) { const t = normText(n.textContent); if (t && t !== labelT && hasDigits(t) && t.length <= 60) { return t; } n = walker.nextNode(); }
      return '';
    }

    function extractStatValues() {
      let rate = '', limit = '', via = '';
      const statsContainer = qs(HINTS.stats);
      if (statsContainer) { rate = pickValueNearLabel('금리', statsContainer); limit = pickValueNearLabel('한도', statsContainer); if (rate || limit) via = 'container hint + label anchor'; }
      if (!rate) { rate = pickValueNearLabel('금리', document); if (rate && !via) via = 'page scan + label anchor'; }
      if (!limit) { limit = pickValueNearLabel('한도', document); if (limit && !via) via = 'page scan + label anchor'; }
      if (!rate || !limit) {
        const labelEls = qsa(FALLBACK.STAT_LABELS.join(','));
        const valueEls = qsa(FALLBACK.STAT_VALUES.join(','));
        const pairs = [];
        for (let i = 0; i < Math.min(labelEls.length, valueEls.length); i++) { pairs.push({ label: txt(labelEls[i]), value: txt(valueEls[i]) }); }
        if (!rate) { const found = pairs.find((p) => p.label.includes('금리')); if (found) { rate = found.value; via = via || 'FALLBACK_HASH'; } }
        if (!limit) { const found = pairs.find((p) => p.label.includes('한도')); if (found) { limit = found.value; via = via || 'FALLBACK_HASH'; } }
      }
      console.log('[CAP.Extractor] StatValues via:', via, [rate, limit]);
      return [rate, limit];
    }

    function extractInfoHTML() {
      let via = '';
      const infoContainer = qs(HINTS.info);
      if (infoContainer) { const html = infoContainer.innerHTML.trim(); if (html) { via = 'container hint'; console.log('[CAP.Extractor] InfoHTML via:', via); return sanitizeAndNormalizeHTML(html); } }
      const markerRegex = /금융회사명[\s\S]*상품명/;
      const candidates = qsa('strong,b,p,div,span').filter((el) => markerRegex.test(normText(el.textContent)));
      for (const marker of candidates) {
        let cur = marker;
        for (let i = 0; i < 8 && cur; i++) {
          const block = cur.closest('div,section,article') || cur.parentElement;
          if (!block) break;
          const textLen = normText(block.innerText).length;
          const htmlLen = normText(block.innerHTML).length;
          if (textLen >= 40 && htmlLen >= 80) { via = 'marker heuristic'; console.log('[CAP.Extractor] InfoHTML via:', via); return sanitizeAndNormalizeHTML(block.innerHTML.trim()); }
          cur = block.parentElement;
        }
      }
      const el = findFirst(FALLBACK.INFO);
      if (el) { via = 'FALLBACK_HASH'; console.log('[CAP.Extractor] InfoHTML via:', via); return sanitizeAndNormalizeHTML(el.innerHTML.trim()); }
      console.log('[CAP.Extractor] InfoHTML via: none (empty)');
      return '';
    }

    function extractNoticeHTML() {
      let via = '';
      const noticeContainer = qs(HINTS.notice);
      if (noticeContainer) {
        const title = findTextAnchor('유의사항', noticeContainer);
        if (title) {
          const walker = document.createTreeWalker(noticeContainer, NodeFilter.SHOW_ELEMENT, null);
          walker.currentNode = title;
          let n = walker.nextNode();
          while (n) {
            const textLen = normText(n.innerText || n.textContent).length;
            const htmlLen = normText(n.innerHTML).length;
            const hasList = !!(n.querySelector && n.querySelector('ul,ol,li'));
            if (hasList || (textLen >= 30 && htmlLen >= 60)) { via = 'container hint + title anchor'; console.log('[CAP.Extractor] NoticeHTML via:', via); return sanitizeAndNormalizeHTML(n.innerHTML.trim()); }
            n = walker.nextNode();
          }
        }
      }
      const titleGlobal = findByText('p,div,span,h1,h2,h3', '유의사항');
      if (titleGlobal) {
        const section = titleGlobal.closest('section,div') || titleGlobal.parentElement;
        if (section) {
          const walker = document.createTreeWalker(section, NodeFilter.SHOW_ELEMENT, null);
          walker.currentNode = titleGlobal;
          let n = walker.nextNode();
          while (n) {
            const textLen = normText(n.innerText || n.textContent).length;
            const htmlLen = normText(n.innerHTML).length;
            const hasList = !!(n.querySelector && n.querySelector('ul,ol,li'));
            if (hasList || (textLen >= 30 && htmlLen >= 60)) { via = 'page scan + title anchor'; console.log('[CAP.Extractor] NoticeHTML via:', via); return sanitizeAndNormalizeHTML(n.innerHTML.trim()); }
            n = walker.nextNode();
          }
        }
      }
      const el = findFirst(FALLBACK.NOTICE);
      if (el) { via = 'FALLBACK_HASH'; console.log('[CAP.Extractor] NoticeHTML via:', via); return sanitizeAndNormalizeHTML(el.innerHTML.trim()); }
      console.log('[CAP.Extractor] NoticeHTML via: none (empty)');
      return '';
    }

    async function extractAll() {
      const logo = await extractLogo();
      const { bank, product } = extractBankProduct(logo.element);
      const statValues = extractStatValues();
      const infoHTML = extractInfoHTML();
      const noticeHTML = extractNoticeHTML();
      return { logoSrc: logo.dataURL, bank, product, statValues, infoHTML, noticeHTML };
    }

    return { extractLogo, extractBankProduct, extractStatValues, extractInfoHTML, extractNoticeHTML, extractAll };
  })();

  CAP.Template = (function () {
    const { qs, qsa } = CAP.Core;
    const SEL = CAP.Selectors;

    const HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta content="width=360, initial-scale=1" name="viewport"/>
<title>캡쳐 모드</title>
<style>
@font-face{font-family:'Pretendard';font-style:normal;font-weight:400;font-display:swap;src:local('Pretendard'),local('Pretendard Regular'),local('Pretendard-Regular'),url('https://cdnjs.cloudflare.com/ajax/libs/pretendard/1.3.9/static/woff-subset/Pretendard-Regular.subset.woff') format('woff')}
@font-face{font-family:'Pretendard';font-style:normal;font-weight:600;font-display:swap;src:local('Pretendard'),local('Pretendard SemiBold'),local('Pretendard-SemiBold'),url('https://cdnjs.cloudflare.com/ajax/libs/pretendard/1.3.9/static/woff-subset/Pretendard-SemiBold.subset.woff') format('woff')}
@font-face{font-family:'Pretendard';font-style:normal;font-weight:700;font-display:swap;src:local('Pretendard'),local('Pretendard Bold'),local('Pretendard-Bold'),url('https://cdnjs.cloudflare.com/ajax/libs/pretendard/1.3.9/static/woff-subset/Pretendard-Bold.subset.woff') format('woff')}
:root{--cap-x:24px;--cap-y-main:24px;--cap-y-sub:20px;--cap-label-strong:#121212;--cap-label-normal:#171719;--cap-label-neutral:#47484B;--cap-label-alt:#858688;--cap-label-disable:#DFDFE0;--cap-bg:#FFFFFF;--cap-bg-notice:#F3F4F6;--cap-primary:#1C64F2;--cap-on-primary:#FFFFFF;--cap-border:#E5E7EB;--cap-lh-base:1.5;--cap-fs-hero:20px;--cap-lh-hero:28px;--cap-fs-stat:22px;--cap-lh-stat:31px;--cap-fs-label:14px;--cap-lh-label:21px;--cap-fs-body:14px;--cap-fs-notice:13px;--cap-fs-tab:16px;--cap-lh-tab:24px;--cap-fw-regular:400;--cap-fw-semibold:600;--cap-fw-bold:700}
*{box-sizing:border-box;margin:0;padding:0;border:0 solid}
html,body{width:100%;height:auto;font-family:'Pretendard',ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-feature-settings:"ss05";color:var(--cap-label-normal);background:var(--cap-bg);-webkit-font-smoothing:antialiased;word-break:keep-all}
img{display:block;max-width:100%}
ul,ol{padding-left:1.2em}
a,button{pointer-events:none}
.capture-container{position:relative;width:100%;max-width:100%;margin:0 auto;background:var(--cap-bg);overflow:visible;display:flex;flex-direction:column;gap:0}
.cap-main{display:flex;flex-direction:column;gap:0}
.cap-header{display:flex;align-items:center;justify-content:space-between;height:48px;padding:0;margin:0}
.cap-header-button{width:72px;height:48px;display:flex;align-items:center;justify-content:center;background:transparent}
.cap-hero{padding:var(--cap-y-sub) var(--cap-x) var(--cap-y-main);display:flex;flex-direction:column;gap:16px}
.cap-hero-brand{display:flex;flex-direction:column;align-items:flex-start;gap:12px}
.cap-hero-text{display:flex;flex-direction:column;gap:2px;font-size:var(--cap-fs-hero);line-height:var(--cap-lh-hero)}
.cap-hero-bank{font-weight:var(--cap-fw-bold);color:var(--cap-label-normal);margin:0}
.cap-hero-product{font-size:var(--cap-fs-hero);line-height:var(--cap-lh-hero);min-height:var(--cap-lh-hero);font-weight:var(--cap-fw-regular);color:var(--cap-label-neutral);white-space:normal;overflow-wrap:anywhere}
.cap-hero-logo{width:32px;height:32px;border-radius:9999px;overflow:hidden}
.cap-stats{display:flex;gap:30px}
.cap-stat{display:flex;flex-direction:column;width:50%}
.cap-stat-label{font-size:var(--cap-fs-label);line-height:var(--cap-lh-label);color:var(--cap-label-alt);margin:0}
.cap-stat-value{font-size:var(--cap-fs-stat);font-weight:var(--cap-fw-bold);line-height:var(--cap-lh-stat);min-height:var(--cap-lh-stat);color:var(--cap-label-normal);white-space:normal;overflow-wrap:anywhere}
.cap-tabs{position:relative;display:grid;grid-template-columns:1fr 1fr;width:100%;margin-top:0;background:var(--cap-bg);background-image:linear-gradient(var(--cap-border),var(--cap-border));background-size:100% 1px;background-position:0 100%;background-repeat:no-repeat;z-index:1}
.cap-tab{position:relative;height:56px;background:transparent;display:flex;align-items:stretch;justify-content:center;box-shadow:none}
.cap-tab-inner{position:relative;height:100%;display:inline-flex;align-items:center;justify-content:center;padding:0 12px}
.cap-tab-text{font-size:var(--cap-fs-tab);font-weight:var(--cap-fw-semibold);line-height:var(--cap-lh-tab);color:var(--cap-label-disable)}
.cap-tabs.is-left-active .cap-tab:nth-child(1) .cap-tab-inner::after{content:'';position:absolute;left:12px;right:12px;bottom:0;height:2px;background:#17181A;z-index:10}
.cap-tabs.is-left-active .cap-tab:nth-child(1) .cap-tab-text{color:var(--cap-label-normal)}
.cap-tabs.is-left-active .cap-tab:nth-child(2) .cap-tab-text{color:var(--cap-label-disable)}
.cap-info{padding:var(--cap-y-main)}
.cap-info-parse,.cap-info-parse *{box-sizing:border-box;max-width:100%}
.cap-info-parse{font-size:var(--cap-fs-body);line-height:var(--cap-lh-base);color:var(--cap-label-neutral);white-space:normal;word-break:keep-all;overflow-wrap:anywhere;font-feature-settings:"ss05"}
.cap-info-parse ::marker,.cap-notice-parse ::marker{font-family:inherit;font-feature-settings:inherit}
.cap-info-parse strong,.cap-info-parse b{font-weight:var(--cap-fw-bold)}
.cap-info-parse p{margin:0;line-height:inherit}
.cap-info-parse ul{margin:0;padding-left:14px;line-height:inherit;list-style-position:outside}
.cap-info-parse li{margin:0;line-height:inherit}
@counter-style circled{system:fixed;symbols:① ② ③ ④ ⑤ ⑥ ⑦ ⑧ ⑨ ⑩;suffix:" "}
.cap-info-parse ul,.cap-notice-parse ul{list-style:none;padding-left:0;margin:0}
.cap-info-parse ul>li,.cap-notice-parse ul>li{position:relative;padding-left:1em;list-style:none}
.cap-info-parse ul>li::before,.cap-notice-parse ul>li::before{content:"•";position:absolute;left:0}
.cap-info-parse ul ul>li::before,.cap-notice-parse ul ul>li::before{content:"-"}
.cap-info-parse ol,.cap-notice-parse ol{counter-reset:c;list-style:none;padding-left:0;margin:0}
.cap-info-parse ol>li,.cap-notice-parse ol>li{counter-increment:c;position:relative;padding-left:1.2em;list-style:none}
.cap-info-parse ol>li::before,.cap-notice-parse ol>li::before{content:counter(c,circled);position:absolute;left:0}
.cap-info-parse ol ul>li::before,.cap-notice-parse ol ul>li::before{content:"-"}
.cap-notice{background-color:var(--cap-bg-notice);padding:var(--cap-y-main);margin-top:0;display:flex;flex-direction:column;gap:8px}
.cap-notice-title{font-size:var(--cap-fs-body);font-weight:var(--cap-fw-bold);color:var(--cap-label-neutral);line-height:var(--cap-lh-base)}
.cap-notice-body{display:block}
.cap-notice-parse,.cap-notice-parse *{box-sizing:border-box;max-width:100%}
.cap-notice-parse{font-size:var(--cap-fs-notice);color:var(--cap-label-alt);line-height:var(--cap-lh-base);white-space:normal;word-break:break-all;overflow-wrap:anywhere;font-feature-settings:"ss05"}
.cap-notice-parse strong,.cap-notice-parse b{font-weight:var(--cap-fw-bold)}
.cap-notice-parse p{margin:0;line-height:inherit}
.cap-cta{padding:var(--cap-y-sub) var(--cap-x);background:linear-gradient(180deg,var(--cap-bg-notice) 0%,var(--cap-bg) 20.48%)}
.cap-cta-button{width:100%;height:54px;border-radius:12px;background:var(--cap-primary);color:var(--cap-on-primary);font-size:var(--cap-fs-tab);font-weight:var(--cap-fw-bold);line-height:var(--cap-lh-tab);display:flex;align-items:center;justify-content:center}
.is-hide-appbar .cap-header{display:none}
.is-hide-cta .cap-cta{display:none}
.is-hide-cta .cap-notice-parse::after{content:"";display:block;height:48px}
</style>
</head>
<body>
<div class="capture-container">
<header class="cap-header">
<div class="cap-header-button"><img alt="뒤로가기" width="24" src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjUiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNSAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE2LjYzNzQgMy4zNjI4N0MxNi45ODg4IDMuNzE0MzQgMTYuOTg4OCA0LjI4NDE5IDE2LjYzNzQgNC42MzU2Nkw5LjI3MzggMTEuOTk5M0wxNi42Mzc0IDE5LjM2MjlDMTYuOTg4OCAxOS43MTQzIDE2Ljk4ODggMjAuMjg0MiAxNi42Mzc0IDIwLjYzNTdDMTYuMjg1OSAyMC45ODcxIDE1LjcxNjEgMjAuOTg3MSAxNS4zNjQ2IDIwLjYzNTdMNy4zNjQ2MiAxMi42MzU3QzcuMDEzMTUgMTIuMjg0MiA3LjAxMzE1IDExLjcxNDMgNy4zNjQ2MiAxMS4zNjI5TDE1LjM2NDYgMy4zNjI4N0MxNS43MTYxIDMuMDExNCAxNi4yODU5IDMuMDExNCAxNi42Mzc0IDMuMzYyODdaIiBmaWxsPSIjMTIxMjEyIi8+Cjwvc3ZnPgo="/></div>
<div class="cap-header-button"><img alt="메뉴" width="24" src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjUiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNSAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik01LjExMzU0IDQuNjEzN0M1LjQ2NTAyIDQuMjYyMjMgNi4wMzQ4NiA0LjI2MjIzIDYuMzg2MzQgNC42MTM3TDEyLjQ5OTkgMTAuNzI3M0wxOC42MTM1IDQuNjEzN0MxOC45NjUgNC4yNjIyMyAxOS41MzQ5IDQuMjYyMjMgMTkuODg2MyA0LjYxMzdDMjAuMjM3OCA0Ljk2NTE3IDIwLjIzNzggNS41MzUwMiAxOS44ODY1IDUuODg2NDlMMTMuNzcyNyAxMi4wMDAxTDE5Ljg4NjMgMTguMTEzN0MyMC4yMzc4IDE4LjQ2NTIgMjAuMjM3OCAxOS4wMzUgMTkuODg2MyAxOS4zODY1QzE5LjUzNDkgMTkuNzM4IDE4Ljk2NSAxOS43MzggMTguNjEzNSAxOS4zODY1TDEyLjQ5OTkgMTMuMjcyOUw2LjM4NjM0IDE5LjM4NjVDNi4wMzQ4NiAxOS43MzggNS40NjUwMiAxOS43MzggNS4xMTM1NCAxOS4zODY1QzQuNzYyMDcgMTkuMDM1IDQuNzYyMDcgMTguNDY1MiA1LjExMzU0IDE4LjExMzdMMTEuMjI3MSAxMi4wMDAxTDUuMTEzNTQgNS44ODY0OUM0Ljc2MjA3IDUuNTM1MDIgNC43NjIwNyA0Ljk2NTE3IDUuMTEzNTQgNC42MTM3WiIgZmlsbD0iIzEyMTIxMiIvPgo8L3N2Zz4K"/></div>
</header>
<main class="cap-main">
<section class="cap-hero">
<div class="cap-hero-brand">
<span class="cap-hero-logo"></span>
<div class="cap-hero-text"><p class="cap-hero-bank"></p><p class="cap-hero-product"></p></div>
</div>
<div class="cap-stats">
<div class="cap-stat"><p class="cap-stat-label">금리</p><p class="cap-stat-value"></p></div>
<div class="cap-stat"><p class="cap-stat-label">한도</p><p class="cap-stat-value"></p></div>
</div>
</section>
<nav class="cap-tabs is-left-active">
<div class="cap-tab"><div class="cap-tab-inner"><span class="cap-tab-text">상품정보</span></div></div>
<div class="cap-tab"><div class="cap-tab-inner"><span class="cap-tab-text">이자계산</span></div></div>
</nav>
<section class="cap-info"><div class="cap-info-parse"></div></section>
<section class="cap-notice">
<div class="cap-notice-title">유의사항</div>
<div class="cap-notice-body"><div class="cap-notice-parse"></div></div>
</section>
</main>
<section class="cap-cta"><div class="cap-cta-button">대출 신청하기</div></section>
</div>
</body>
</html>`;

    function inject(data) {
      const logoSlot = qs(SEL.SLOT_LOGO);
      if (logoSlot) {
        logoSlot.innerHTML = '';
        if (data.logoSrc) { const img = document.createElement('img'); img.alt = '금융사 로고'; img.style.cssText = 'width:32px;height:32px;border-radius:9999px;object-fit:cover;'; img.src = data.logoSrc; logoSlot.appendChild(img); }
      }
      const bankEl = qs(SEL.SLOT_BANK);
      const productEl = qs(SEL.SLOT_PRODUCT);
      if (bankEl) bankEl.textContent = data.bank || '';
      if (productEl) productEl.textContent = data.product || '';
      const statEls = qsa(SEL.SLOT_STAT_VALUES);
      if (statEls[0]) statEls[0].textContent = data.statValues?.[0] || '';
      if (statEls[1]) statEls[1].textContent = data.statValues?.[1] || '';
      const infoBox = qs(SEL.SLOT_INFO);
      const noticeBox = qs(SEL.SLOT_NOTICE);
      if (infoBox) infoBox.innerHTML = data.infoHTML || '';
      if (noticeBox) noticeBox.innerHTML = data.noticeHTML || '';
    }

    function replace(templateHTML) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(templateHTML, 'text/html');
      const newHead = doc.head.innerHTML;
      document.head.innerHTML = newHead;
      document.body.innerHTML = doc.body.innerHTML;
    }

    function applyOptions(params) {
      const container = qs(SEL.CAPTURE_ROOT);
      if (!container) return;
      if (params.get('hideAppbar') === '1') container.classList.add('is-hide-appbar');
      if (params.get('hideCta') === '1') container.classList.add('is-hide-cta');
    }

    return { HTML, inject, replace, applyOptions };
  })();

  CAP.Capture = (function () {
    const { qs, sleep, waitForRaf } = CAP.Core;
    const { build: buildFilename } = CAP.Filename;
    const SEL = CAP.Selectors;
    const { CAPTURE_STABILIZE_DELAY } = CAP.Config;

    function ensureLibLoaded() {
      return new Promise((resolve, reject) => {
        if (window.htmlToImage) return resolve();
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load html-to-image'));
        document.head.appendChild(s);
      });
    }

    async function execute(targetEl = null) {
      await ensureLibLoaded();
      const target = targetEl || qs(SEL.CAPTURE_ROOT);
      if (!target) throw new Error(`Capture target not found: ${SEL.CAPTURE_ROOT}`);
      window.scrollTo(0, 0);
      await waitForRaf();
      await sleep(CAPTURE_STABILIZE_DELAY);
      const dataUrl = await window.htmlToImage.toPng(target, { pixelRatio: 2, backgroundColor: '#ffffff', skipAutoScale: true, filter: (node) => node.id !== SEL.CAPTURE_BUTTON });
      return dataUrl;
    }

    function download(dataUrl) {
      const filename = buildFilename();
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    const BUTTON_STYLES = {
      base: `pointer-events:auto!important;position:fixed;right:12px;bottom:12px;z-index:2147483647;padding:12px 16px;border-radius:12px;border:1px solid rgba(0,0,0,0.12);background:#111;color:#fff;font-size:14px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.18);cursor:pointer;transition:transform 0.1s ease,box-shadow 0.1s ease;`,
      hover: { transform: 'translateY(-2px)', boxShadow: '0 12px 32px rgba(0,0,0,0.24)' },
      normal: { transform: 'translateY(0)', boxShadow: '0 8px 24px rgba(0,0,0,0.18)' },
      colors: { default: '#111', success: '#059669', error: '#DC2626' }
    };
    const BUTTON_LABELS = ['PNG 캡쳐', '캡쳐 중…', '완료 ✓', '실패'];

    function fixButtonWidthByMaxLabel(btn, labels) {
      const originalText = btn.textContent;
      const prevVisibility = btn.style.visibility;
      btn.style.visibility = 'hidden';
      btn.style.width = 'auto';
      let maxWidth = 0;
      for (const label of labels) { btn.textContent = label; const w = btn.getBoundingClientRect().width; if (w > maxWidth) maxWidth = w; }
      btn.textContent = originalText;
      btn.style.visibility = prevVisibility || '';
      btn.style.minWidth = `${Math.ceil(maxWidth)}px`;
    }

    function createButton(onCapture) {
      if (document.getElementById(SEL.CAPTURE_BUTTON)) return;
      const btn = document.createElement('button');
      btn.id = SEL.CAPTURE_BUTTON;
      btn.type = 'button';
      btn.textContent = 'PNG 캡쳐';
      btn.style.cssText = BUTTON_STYLES.base;
      btn.addEventListener('mouseenter', () => Object.assign(btn.style, BUTTON_STYLES.hover));
      btn.addEventListener('mouseleave', () => Object.assign(btn.style, BUTTON_STYLES.normal));
      btn.addEventListener('click', async () => {
        try {
          btn.disabled = true; btn.style.opacity = '0.7'; btn.textContent = '캡쳐 중…';
          if (typeof onCapture === 'function') { await onCapture(); } else { const dataUrl = await execute(); download(dataUrl); }
          btn.textContent = '완료 ✓'; btn.style.background = BUTTON_STYLES.colors.success; await sleep(1200);
        } catch (e) {
          console.error('[CAP.Capture] Failed:', e); btn.textContent = '실패'; btn.style.background = BUTTON_STYLES.colors.error; await sleep(1500);
        } finally {
          btn.disabled = false; btn.style.opacity = '1'; btn.style.background = BUTTON_STYLES.colors.default; btn.textContent = 'PNG 캡쳐';
        }
      });
      document.body.appendChild(btn);
      fixButtonWidthByMaxLabel(btn, BUTTON_LABELS);
    }

    return { ensureLibLoaded, execute, download, createButton };
  })();

  CAP.Main = (function () {
    const { sleep } = CAP.Core;
    const { EXTRACT_MAX_RETRIES, EXTRACT_RETRY_DELAY } = CAP.Config;
    const { extractAll } = CAP.Extractor;
    const { HTML, inject, replace, applyOptions } = CAP.Template;
    const { createButton } = CAP.Capture;

    function shouldRun() {
      const params = new URLSearchParams(window.location.search);
      return params.get('capture') === 'true';
    }

    async function extractWithRetry() {
      for (let i = 0; i < EXTRACT_MAX_RETRIES; i++) {
        try {
          const data = await extractAll();
          const hasIdentity = Boolean((data.bank && data.bank.trim()) || (data.product && data.product.trim()));
          const hasStats = Array.isArray(data.statValues) && data.statValues.some(v => v && String(v).trim());
          const hasContent = Boolean((data.infoHTML && data.infoHTML.trim()) || (data.noticeHTML && data.noticeHTML.trim()) || hasStats);
          console.log(`[CAP.Main] Attempt ${i + 1}/${EXTRACT_MAX_RETRIES}:`, { hasIdentity, hasStats, hasContent, bank: data.bank?.slice(0, 20) || '(empty)', product: data.product?.slice(0, 20) || '(empty)' });
          if (hasIdentity && hasContent) return data;
        } catch (e) { console.warn(`[CAP.Main] Attempt ${i + 1}/${EXTRACT_MAX_RETRIES} error:`, e); }
        await sleep(EXTRACT_RETRY_DELAY);
      }
      console.error('[CAP.Main] All extract attempts failed. Check selectors or page structure.');
      return null;
    }

    async function run() {
      if (!shouldRun()) { console.log('[CAP.Main] capture=true not set, script skipped'); return; }
      const data = await extractWithRetry();
      if (!data) { console.error('[CAP.Main] Failed to extract data'); return; }
      console.log('[CAP.Main] Extracted data:', data);
      replace(HTML);
      await sleep(0);
      const params = new URLSearchParams(window.location.search);
      applyOptions(params);
      inject(data);
      createButton();
      console.log('[CAP.Main] Template v1.5.6 ready');
    }

    return { run };
  })();

  CAP.Main.run();
})();
