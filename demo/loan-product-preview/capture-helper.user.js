// ==UserScript==
// @name         Finance Preview Capture Helper (Firefox)
// @namespace    capture-helper
// @version      1.0.1
// @description  overflow 해제 + 특정 버튼 영역 숨김 + 캡처버튼 자동 숨김
// @match        https://*.apthefin.com/app/loan-product-preview*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  // ====== 설정 ======
  const OVERFLOW_TARGET_SELECTORS = [
    ".basic-app-bar-layout-body",
    ".css-u2qv31",
  ];

  const HIDE_TARGET_SELECTORS = [
    ".css-iikkcm",
  ];

  // 숨김 대신 "완전 삭제"를 원하시면 true로 변경
  const REMOVE_INSTEAD_OF_HIDE = false;

  // 페이지가 SPA라서 DOM이 늦게 뜨는 경우를 대비한 재시도(밀리초)
  const RETRY_MS = 400;
  const MAX_RETRY = 25; // 10초 정도

  // ====== 내부 ======
  const STYLE_ID = "__tm_capture_mode_style__";
  const BTN_ID = "__tm_capture_mode_btn__";

  function buildCss() {
    const overflowCss = OVERFLOW_TARGET_SELECTORS.map(sel => `
      ${sel} {
        overflow: visible !important;
        height: auto !important;
        max-height: none !important;
      }
    `).join("\n");

    const hideCss = HIDE_TARGET_SELECTORS.map(sel => `
      ${sel} { display: none !important; visibility: hidden !important; }
    `).join("\n");

    return `
      /* 캡처 친화적 기본값 */
      html, body { overflow: visible !important; height: auto !important; }
      body { position: static !important; }

      /* 1) 오버플로우 해제 대상 */
      ${overflowCss}

      /* 2) 숨김 대상 */
      ${REMOVE_INSTEAD_OF_HIDE ? "" : hideCss}

      /* 3) 캡쳐 모드 활성화 시 버튼 자신도 숨김 (새로고침해야 다시 나타남) */
      #${BTN_ID} { display: none !important; }
    `;
  }

  function enableCaptureMode() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = buildCss();
      document.head.appendChild(style);
    }

    if (REMOVE_INSTEAD_OF_HIDE) {
      HIDE_TARGET_SELECTORS.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.remove());
      });
    }
  }

  function disableCaptureMode() {
    document.getElementById(STYLE_ID)?.remove();
  }

  function isOn() {
    return !!document.getElementById(STYLE_ID);
  }

  function mountToggleButton() {
    if (document.getElementById(BTN_ID)) return;

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = "캡처 모드 ON";
    btn.style.cssText = `
      position: fixed; right: 16px; bottom: 16px;
      z-index: 2147483647;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(0,0,0,.2);
      background: #fff;
      font-size: 13px;
      cursor: pointer;
      box-shadow: 0 10px 24px rgba(0,0,0,.15);
    `;

    const refreshLabel = () => {
      // 버튼이 숨겨지므로 사실상 OFF 텍스트를 볼 일은 거의 없게 됩니다.
      btn.textContent = isOn() ? "캡처 모드 OFF" : "캡처 모드 ON";
    };

    btn.addEventListener("click", () => {
      if (isOn()) disableCaptureMode();
      else enableCaptureMode();
      refreshLabel();
    });

    document.body.appendChild(btn);

    // 초기 실행 시 자동으로 켜지길 원하면 아래 주석 해제
    enableCaptureMode();
    refreshLabel();
  }

  // SPA/지연 렌더링 대비
  function waitAndInit() {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;

      const foundOverflowTarget = OVERFLOW_TARGET_SELECTORS.some(sel => document.querySelector(sel));
      const foundHideTarget = HIDE_TARGET_SELECTORS.some(sel => document.querySelector(sel));

      if (foundOverflowTarget || foundHideTarget || tries >= MAX_RETRY) {
        clearInterval(timer);
        mountToggleButton();
      }
    }, RETRY_MS);
  }

  waitAndInit();
})();
