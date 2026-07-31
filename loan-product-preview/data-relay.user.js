// ==UserScript==
// @name         Loan Preview Data Relay
// @namespace    data-relay
// @version      2.2.0
// @description  [2.2.0] API 호출/검증 + 원시값 postMessage 전송만 담당(포맷팅/HTML 정제/캡처는 전부 통합 도구 CaptureEngine에서 수행). 내부 네임스페이스를 Relay로, postMessage 타입을 RELAY_DATA/RELAY_ERROR로 정리, 사용하지 않는 권한(GM_download/unsafeWindow) 제거
// @include      *://*/*loan-product-preview*
// @connect      *
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @updateURL    https://AirHelper.github.io/workflow-tools/loan-product-preview/data-relay.user.js
// @downloadURL  https://AirHelper.github.io/workflow-tools/loan-product-preview/data-relay.user.js
// ==/UserScript==
(function() {
  "use strict";
  const Relay = {};
  Relay.Config = Object.freeze({
    API_TIMEOUT: 15e3,
    IMAGE_TIMEOUT: 1e4
  });
  const TARGET_ORIGIN = (() => {
    if (document.referrer) {
      try {
        return new URL(document.referrer).origin;
      } catch {}
    }
    return "*";
  })();
  function postToParent(message) {
    if (window.parent === window) return;
    window.parent.postMessage(message, TARGET_ORIGIN);
  }
  Relay.Validator = function() {
    function checkBlockers() {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (!dialog) return false;
      const style = window.getComputedStyle(dialog);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const buttons = Array.from(dialog.querySelectorAll("button"));
      const hasConfirmBtn = buttons.some(btn => btn.textContent.trim() === "확인");
      if (hasConfirmBtn) {
        const msgEl = dialog.querySelector('p[class*="css-"], div[class*="css-"]');
        const msg = msgEl ? msgEl.textContent.trim() : "Unknown Error";
        console.warn(`[Relay.Validator] Execution Blocked. Error modal detected: "${msg}"`);
        return true;
      }
      return false;
    }
    return {
      checkBlockers: checkBlockers
    };
  }();
  Relay.Image = function() {
    const {IMAGE_TIMEOUT: IMAGE_TIMEOUT} = Relay.Config;
    function toDataURL(src) {
      return new Promise(resolve => {
        if (!src) return resolve("");
        if (String(src).startsWith("data:image/")) return resolve(src);
        GM_xmlhttpRequest({
          method: "GET",
          url: src,
          responseType: "blob",
          timeout: IMAGE_TIMEOUT,
          onload(response) {
            if (response.status === 200 && response.response) {
              const fr = new FileReader;
              fr.onload = () => resolve(String(fr.result || ""));
              fr.onerror = () => resolve("");
              fr.readAsDataURL(response.response);
            } else {
              resolve("");
            }
          },
          onerror: () => resolve(""),
          ontimeout: () => resolve("")
        });
      });
    }
    return {
      toDataURL: toDataURL
    };
  }();
  Relay.ApiSource = function() {
    const {toDataURL: toDataURL} = Relay.Image;
    const {API_TIMEOUT: API_TIMEOUT} = Relay.Config;
    const API_PATH_PREFIX = "/api/v3/public/loan-product-previews/";
    function getPreviewId() {
      const params = new URLSearchParams(window.location.search);
      return params.get("id") || "";
    }
    function getApiOrigin() {
      const params = new URLSearchParams(window.location.search);
      return params.get("apiOrigin") || "";
    }
    function buildApiUrl(id, apiOrigin) {
      return `${apiOrigin}${API_PATH_PREFIX}${encodeURIComponent(id)}`;
    }
    function requestJson(url) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "GET",
          url: url,
          headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json"
          },
          timeout: API_TIMEOUT,
          onload(response) {
            let json = null;
            if (response.responseText) {
              try {
                json = JSON.parse(response.responseText);
              } catch {
                json = null;
              }
            }
            if (json && typeof json === "object") {
              resolve(json);
            } else {
              const err = new Error(`서버 응답을 처리할 수 없습니다. (HTTP ${response.status || 0})`);
              err.code = null;
              reject(err);
            }
          },
          onerror() {
            const err = new Error("네트워크 오류가 발생했습니다");
            err.code = null;
            reject(err);
          },
          ontimeout() {
            const err = new Error("API 요청 시간이 초과되었습니다");
            err.code = null;
            reject(err);
          }
        });
      });
    }
    function validateResponse(json) {
      if (!json || typeof json !== "object") {
        const err = new Error("API 응답이 비어 있습니다");
        err.code = null;
        throw err;
      }
      if (json.success !== true) {
        const err = new Error(json.message || "알 수 없는 오류가 발생했습니다");
        err.code = json.code || null;
        throw err;
      }
      if (!json.data || typeof json.data !== "object") {
        const err = new Error("API 응답에 데이터가 없습니다");
        err.code = json.code || null;
        throw err;
      }
      return json.data;
    }
    async function mapApiData(apiData) {
      const logoUrl = apiData.financeLogoUrl || "";
      const logoSrc = logoUrl ? await toDataURL(logoUrl) : "";
      return {
        logoSrc: logoSrc,
        bank: apiData.financeName || "",
        product: apiData.productName || "",
        interestRate: apiData.interestRate,
        amountLimit: apiData.amountLimit,
        infoRaw: apiData.info || "",
        noticeRaw: apiData.notice || ""
      };
    }
    function requestJsonForId(id, apiOrigin) {
      return requestJson(buildApiUrl(id, apiOrigin));
    }
    return {
      getPreviewId: getPreviewId,
      getApiOrigin: getApiOrigin,
      requestJsonForId: requestJsonForId,
      validateResponse: validateResponse,
      mapApiData: mapApiData
    };
  }();
  Relay.Main = function() {
    function shouldRun() {
      const params = new URLSearchParams(window.location.search);
      return params.get("capture") === "true";
    }
    function isValidProductData(data) {
      const hasIdentity = Boolean(data.bank && data.bank.trim() || data.product && data.product.trim());
      const hasStats = Boolean(data.interestRate !== null && data.interestRate !== undefined && String(data.interestRate).trim() || data.amountLimit !== null && data.amountLimit !== undefined && String(data.amountLimit).trim());
      const hasContent = Boolean(data.infoRaw && data.infoRaw.trim() || data.noticeRaw && data.noticeRaw.trim() || hasStats);
      return hasIdentity && hasContent;
    }
    async function run() {
      if (!shouldRun()) {
        console.log("[Relay.Main] capture=true not set, script skipped");
        return;
      }
      if (Relay.Validator.checkBlockers()) {
        postToParent({
          type: "RELAY_ERROR",
          code: null,
          message: "DOM 오류 모달이 감지되었습니다."
        });
        return;
      }
      try {
        const id = Relay.ApiSource.getPreviewId();
        if (!id) {
          const err = new Error("시안 ID가 없습니다");
          err.code = null;
          throw err;
        }
        const apiOrigin = Relay.ApiSource.getApiOrigin();
        if (!apiOrigin) {
          const err = new Error("API 서버 설정이 전달되지 않았습니다");
          err.code = null;
          throw err;
        }
        const json = await Relay.ApiSource.requestJsonForId(id, apiOrigin);
        const apiData = Relay.ApiSource.validateResponse(json);
        const data = await Relay.ApiSource.mapApiData(apiData);
        if (!isValidProductData(data)) {
          const err = new Error("캡처에 필요한 상품 정보가 부족합니다");
          err.code = null;
          throw err;
        }
        postToParent({
          type: "RELAY_DATA",
          payload: data
        });
        console.log("[Relay.Main] RELAY_DATA sent:", {
          bank: data.bank,
          product: data.product
        });
      } catch (e) {
        console.error("[Relay.Main] failed:", e);
        postToParent({
          type: "RELAY_ERROR",
          code: e.code || null,
          message: e.message || String(e)
        });
      }
    }
    return {
      run: run
    };
  }();
  Relay.Main.run();
})();