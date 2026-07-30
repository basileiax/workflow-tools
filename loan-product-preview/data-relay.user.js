// ==UserScript==
// @name         Loan Preview Data Relay
// @namespace    data-relay
// @version      2.1.0
// @description  [2.1.0] 호스트 설정 수신 + API 호출/검증 + 원시값 postMessage 전송만 담당. 포맷팅/HTML 정제/캡처는 전부 통합 도구 CaptureEngine에서 수행
// @include      *://*/*loan-product-preview*
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        unsafeWindow
// @run-at       document-idle
// @updateURL    https://AirHelper.github.io/workflow-tools/loan-product-preview/data-relay.user.js
// @downloadURL  https://AirHelper.github.io/workflow-tools/loan-product-preview/data-relay.user.js
// ==/UserScript==

(function () {
  'use strict';

  const CAP = {};

  CAP.Config = Object.freeze({
    API_TIMEOUT: 15000,
    IMAGE_TIMEOUT: 10000
  });

  const TARGET_ORIGIN = (() => {
    if (document.referrer) {
      try { return new URL(document.referrer).origin; } catch { /* fall through */ }
    }
    return '*';
  })();

  function postToParent(message) {
    if (window.parent === window) return;
    window.parent.postMessage(message, TARGET_ORIGIN);
  }

  /* ===========================================================================
   * CAP.Validator — 오류 모달 감지 (Circuit Breaker)
   * ========================================================================= */
  CAP.Validator = (function () {
    function checkBlockers() {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (!dialog) return false;

      const style = window.getComputedStyle(dialog);
      if (style.display === 'none' || style.visibility === 'hidden') return false;

      const buttons = Array.from(dialog.querySelectorAll('button'));
      const hasConfirmBtn = buttons.some((btn) => btn.textContent.trim() === '확인');
      if (hasConfirmBtn) {
        const msgEl = dialog.querySelector('p[class*="css-"], div[class*="css-"]');
        const msg = msgEl ? msgEl.textContent.trim() : 'Unknown Error';
        console.warn(`[CAP.Validator] Execution Blocked. Error modal detected: "${msg}"`);
        return true;
      }
      return false;
    }

    return { checkBlockers };
  })();

  /* ===========================================================================
   * CAP.Image — CORS 우회 Base64 변환
   * ========================================================================= */
  CAP.Image = (function () {
    const { IMAGE_TIMEOUT } = CAP.Config;

    function toDataURL(src) {
      return new Promise((resolve) => {
        if (!src) return resolve('');
        if (String(src).startsWith('data:image/')) return resolve(src);

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

  /* ===========================================================================
   * CAP.ApiSource — API 호출 + 검증 + 원시값 매핑 (포맷팅/HTML 정제는 하지 않음)
   * ========================================================================= */
  CAP.ApiSource = (function () {
    const { toDataURL } = CAP.Image;
    const { API_TIMEOUT } = CAP.Config;

    const API_PATH_PREFIX = '/api/v3/public/loan-product-previews/';

    function getPreviewId() {
      const params = new URLSearchParams(window.location.search);
      return params.get('id') || '';
    }

    function getApiOrigin() {
      const params = new URLSearchParams(window.location.search);
      return params.get('apiOrigin') || '';
    }

    function buildApiUrl(id, apiOrigin) {
      return `${apiOrigin}${API_PATH_PREFIX}${encodeURIComponent(id)}`;
    }

    function requestJson(url) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json'
          },
          // responseType을 지정하지 않음(기본 텍스트) — HTTP 상태와 무관하게
          // responseText가 항상 채워지도록 하고, JSON 파싱은 항상 우리가 직접
          // 한다. 'json'으로 지정하면 일부 구현에서 비-2xx 응답의 바디를
          // 자동 파싱해주지 않아, API가 보낸 정상적인 에러 바디(예: success:false
          // + code/message)를 못 읽는 경우가 있었다.
          timeout: API_TIMEOUT,
          onload(response) {
            let json = null;
            if (response.responseText) {
              try { json = JSON.parse(response.responseText); } catch { json = null; }
            }

            if (json && typeof json === 'object') {
              resolve(json);
            } else {
              const err = new Error(`서버 응답을 처리할 수 없습니다. (HTTP ${response.status || 0})`);
              err.code = null;
              reject(err);
            }
          },
          onerror() {
            const err = new Error('네트워크 오류가 발생했습니다');
            err.code = null;
            reject(err);
          },
          ontimeout() {
            const err = new Error('API 요청 시간이 초과되었습니다');
            err.code = null;
            reject(err);
          }
        });
      });
    }

    function validateResponse(json) {
      if (!json || typeof json !== 'object') {
        const err = new Error('API 응답이 비어 있습니다');
        err.code = null;
        throw err;
      }

      if (json.success !== true) {
        const err = new Error(json.message || '알 수 없는 오류가 발생했습니다');
        err.code = json.code || null;
        throw err;
      }

      if (!json.data || typeof json.data !== 'object') {
        const err = new Error('API 응답에 데이터가 없습니다');
        err.code = json.code || null;
        throw err;
      }

      return json.data;
    }

    async function mapApiData(apiData) {
      const logoUrl = apiData.financeLogoUrl || '';
      // CORS 우회를 위해 GM_xmlhttpRequest 권한이 필요하므로 로고 변환만 예외적으로 여기서 수행
      const logoSrc = logoUrl ? await toDataURL(logoUrl) : '';

      return {
        logoSrc,
        bank: apiData.financeName || '',
        product: apiData.productName || '',
        interestRate: apiData.interestRate,
        amountLimit: apiData.amountLimit,
        infoRaw: apiData.info || '',
        noticeRaw: apiData.notice || ''
      };
    }

    function requestJsonForId(id, apiOrigin) {
      return requestJson(buildApiUrl(id, apiOrigin));
    }

    return { getPreviewId, getApiOrigin, requestJsonForId, validateResponse, mapApiData };
  })();

  /* ===========================================================================
   * CAP.Main — 오케스트레이션
   * ========================================================================= */
  CAP.Main = (function () {
    function shouldRun() {
      const params = new URLSearchParams(window.location.search);
      return params.get('capture') === 'true';
    }

    function isValidProductData(data) {
      const hasIdentity = Boolean((data.bank && data.bank.trim()) || (data.product && data.product.trim()));
      const hasStats = Boolean(
        (data.interestRate !== null && data.interestRate !== undefined && String(data.interestRate).trim()) ||
        (data.amountLimit !== null && data.amountLimit !== undefined && String(data.amountLimit).trim())
      );
      const hasContent = Boolean(
        (data.infoRaw && data.infoRaw.trim()) ||
        (data.noticeRaw && data.noticeRaw.trim()) ||
        hasStats
      );
      return hasIdentity && hasContent;
    }

    async function run() {
      if (!shouldRun()) {
        console.log('[CAP.Main] capture=true not set, script skipped');
        return;
      }

      if (CAP.Validator.checkBlockers()) {
        postToParent({ type: 'CAP_ERROR', code: null, message: 'DOM 오류 모달이 감지되었습니다.' });
        return;
      }

      try {
        const id = CAP.ApiSource.getPreviewId();
        if (!id) {
          const err = new Error('시안 ID가 없습니다');
          err.code = null;
          throw err;
        }

        const apiOrigin = CAP.ApiSource.getApiOrigin();
        if (!apiOrigin) {
          const err = new Error('API 서버 설정이 전달되지 않았습니다');
          err.code = null;
          throw err;
        }

        const json = await CAP.ApiSource.requestJsonForId(id, apiOrigin);
        const apiData = CAP.ApiSource.validateResponse(json);
        const data = await CAP.ApiSource.mapApiData(apiData);

        if (!isValidProductData(data)) {
          const err = new Error('캡처에 필요한 상품 정보가 부족합니다');
          err.code = null;
          throw err;
        }

        postToParent({ type: 'CAP_DATA', payload: data });
        console.log('[CAP.Main] CAP_DATA sent:', { bank: data.bank, product: data.product });
      } catch (e) {
        console.error('[CAP.Main] failed:', e);
        postToParent({ type: 'CAP_ERROR', code: e.code || null, message: e.message || String(e) });
      }
    }

    return { run };
  })();

  CAP.Main.run();
})();
