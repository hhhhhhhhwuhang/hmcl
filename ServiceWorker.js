// 莆仙戏脸谱涂色游戏 · Service Worker
//
// 设计原则（v0.7 起）：
// 1. 绝不拦截 Build/ 下的大文件。Unity 的 data/wasm/framework 交给浏览器 HTTP 缓存
//    和原生 Brotli 解压去处理；SW 一旦插手，就会和引擎自己的下载抢带宽，
//    还会绕过浏览器的解压流水线，首屏反而更慢。
// 2. 安装时不再 addAll 全量预缓存（旧版一次预热 16MB，纯属自伤）。
// 3. 缓存名带版本号 + skipWaiting/clients.claim：换版本时旧缓存必被清掉，
//    不会再出现"发版后玩家永远停在旧包"的问题。
// 4. 页面、ServiceWorker.js 本身始终走网络，保证能及时拿到新版本。

const 缓存名 = "pxxlptsyx-v1.0";

// 只预缓存体积小、启动就要用的文件（总量几十 KB，不占带宽）
const 预缓存清单 = [
    "TemplateData/style.css",
    "TemplateData/favicon.ico",
    "manifest.webmanifest"
];

self.addEventListener("install", function (e) {
    self.skipWaiting(); // 新 SW 立刻进入 waiting -> activating，不等旧页面全部关闭
    e.waitUntil(
        caches.open(缓存名)
            .then(function (c) { return c.addAll(预缓存清单); })
            .catch(function () { /* 预缓存失败不影响游戏启动，静默跳过 */ })
    );
});

self.addEventListener("activate", function (e) {
    e.waitUntil((async function () {
        // 清掉所有旧版本缓存（含旧的 "幻梦晨露-…h5-0.6"）
        const 键名列表 = await caches.keys();
        await Promise.all(键名列表.map(function (k) {
            return k === 缓存名 ? null : caches.delete(k);
        }));
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", function (e) {
    if (e.request.method !== "GET") return;

    const 地址 = new URL(e.request.url);
    if (地址.origin !== self.location.origin) return; // 第三方请求一律不接管

    // ── 放行，交给浏览器原生缓存（这里是最关键的一条）────────────────
    // Build/：Unity 的 16MB 主体 + 按需加载的 AssetBundle
    if (地址.pathname.indexOf("/Build/") !== -1) return;
    // StreamingAssets/：Addressables 的 bundle（单张线稿/上色稿包），同样交给浏览器 HTTP 缓存
    if (地址.pathname.indexOf("/StreamingAssets/") !== -1) return;
    // 目录入口 / html：必须每次回源，否则拿不到新的 assetVersion
    if (地址.pathname.endsWith("/") || 地址.pathname.endsWith(".html")) return;
    // SW 自身
    if (地址.pathname.endsWith("ServiceWorker.js")) return;

    // ── 其余小静态资源：缓存优先 + 后台更新（stale-while-revalidate）──
    e.respondWith((async function () {
        const 缓存 = await caches.open(缓存名);
        const 已有 = await 缓存.match(e.request);

        const 网络请求 = fetch(e.request).then(function (响应) {
            if (响应 && 响应.ok && 响应.type === "basic") {
                缓存.put(e.request, 响应.clone());
            }
            return 响应;
        }).catch(function () { return 已有; });

        return 已有 || 网络请求;
    })());
});
