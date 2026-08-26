/**
 * api/llm.js — 服务端 LLM 代理（密钥只活在这里）
 *
 * 作用：前端把「问题」发到这个地址，本函数拿着你的阿里云密钥转发给阿里云，
 *       再把答案回给前端。前端永远拿不到密钥。
 *
 * 部署（任选其一，核心逻辑相同，仅入口签名不同）：
 *   1. Vercel（推荐，最简单）：把本文件放到项目根 /api/llm.js，默认即此 CommonJS 签名，无需改动。
 *   2. Netlify Functions：放到 /netlify/functions/llm.js，将 module.exports 改为
 *      exports.handler = async (event) => { const body = JSON.parse(event.body); ... return { statusCode, body }; }
 *   3. 阿里云函数计算 FC：用 HTTP 触发器，入口改为 (req, resp, context)，
 *      从 req 读 body、用 resp.send() 回写；ALIYUN_API_KEY 配在 FC 的环境变量里。
 *   （也可用 Cloudflare Workers，把 fetch 事件改为 export default { async fetch(request) {...} }。）
 *
 * 环境变量（只配在服务器端，绝不下发前端）：
 *   ALIYUN_API_KEY   : 你的阿里云百炼 / MaaS 密钥（必填）
 *   ALIYUN_BASE_URL  : 可选，默认 https://dashscope.aliyuncs.com/compatible-mode/v1
 *                      （若用你的 TCM 专属 MaaS 端点，改成 https://ws-...maas.aliyuncs.com/compatible-mode/v1）
 */
'use strict';

async function handler(req, res) {
    // 统一 CORS：允许前端站点跨域调用本代理
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const apiKey = process.env.ALIYUN_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: '服务端未配置 ALIYUN_API_KEY（请在部署平台的环境变量里填写）' });
    }

    const baseUrl = process.env.ALIYUN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    let body;
    try {
        body = (typeof req.body === 'string') ? JSON.parse(req.body) : (req.body || {});
    } catch (e) {
        return res.status(400).json({ error: '请求体不是合法 JSON' });
    }

    try {
        const upstream = await fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
            body: JSON.stringify(body)
        });
        const text = await upstream.text();
        res.status(upstream.status);
        res.setHeader('Content-Type', 'application/json');
        res.send(text);
    } catch (e) {
        return res.status(502).json({ error: '转发阿里云失败：' + ((e && e.message) || e) });
    }
}

// Vercel / Netlify / 本地测试均兼容的 CommonJS 导出（如需 ESM，可改为 export default handler）
module.exports = handler;
