/**
 * config.js — 前端运行配置（源码零密钥）
 *
 * 关键安全原则（CPO 指令·正式版）：前端绝不持有、绝不向用户暴露任何 API 密钥。
 * 所有大模型调用改由「你的后端代理」转发，密钥只活在你的服务器环境变量里。
 *
 * CPO 部署前只需手动调整下面两项（改完保存即可，无需构建工具）：
 *   llmProxyUrl      : 你的后端代理地址（前端唯一调用的 LLM 地址）。
 *                       例如 https://你的代理域名/api/llm 。正式上线必填；留空则退化为本地演示。
 *   allowDevKeyInput : 是否开放「本地填 Key」调试入口（仅 CPO 本机调试用，密钥只存本机浏览器）。
 *                       正式上线务必设为 false，确保普通用户无法输入 / 看到任何密钥。
 */
(function () {
    'use strict';
    window.TCM_CONFIG = {
        llmProxyUrl: '',
        allowDevKeyInput: false
    };
})();
