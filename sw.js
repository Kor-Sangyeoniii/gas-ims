/* ══════════════════════════════════════════════════════════════════
   GAS-IMS 서비스워커
   - 앱 셸을 캐시해서 오프라인/지하 창고에서도 앱이 뜨게 한다
   - Firestore 통신은 절대 가로채지 않는다 (항상 실시간 데이터)
   - 웹 푸시 수신 + 알림 클릭 처리
   ══════════════════════════════════════════════════════════════════ */

const VERSION    = 'gasims-v1';
const SHELL      = `${VERSION}-shell`;   // 앱 본체 (index.html, manifest, 아이콘)
const RUNTIME    = `${VERSION}-runtime`; // 외부 CDN (firebase SDK, 웹폰트)

// scope 기준 상대경로 — GitHub Pages 하위 경로에 올려도 그대로 동작
const BASE = new URL('./', self.registration.scope).pathname;
const p = (rel) => BASE + rel;

const PRECACHE = [
  p(''),
  p('index.html'),
  p('manifest.json'),
  p('icons/apple-touch-icon.png'),
  p('icons/icon-192.png'),
  p('icons/icon-512.png'),
  p('icons/favicon-32.png'),
];

// stale-while-revalidate 로 다룰 외부 호스트 (SDK·웹폰트)
const CDN_HOSTS = [
  'www.gstatic.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// 절대 캐시하면 안 되는 호스트 (실시간 데이터 / 토큰 발급)
const NEVER_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'fcmregistrations.googleapis.com',
  'firebaseremoteconfig.googleapis.com',
];

/* ── 설치: 앱 셸 프리캐시 ────────────────────────────────────── */
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // 하나라도 실패하면 설치 전체가 실패하므로 개별로 처리
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        console.warn('[sw] 프리캐시 실패:', url, err);
      }
    }));
  })());
});

/* ── 활성화: 옛 버전 캐시 정리 ───────────────────────────────── */
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))
    );
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});

/* ── 페이지에서 온 메시지 ────────────────────────────────────── */
self.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'GET_VERSION') {
    e.source && e.source.postMessage({ type: 'VERSION', version: VERSION });
  }
  // 앱이 포그라운드에서 직접 띄우는 로컬 알림 (재고 부족 등)
  if (data.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(data.title || 'GAS-IMS', {
      body:  data.body || '',
      icon:  p('icons/icon-192.png'),
      badge: p('icons/favicon-32.png'),
      tag:   data.tag || 'gasims',
      renotify: true,
      data:  { url: data.url || p('') },
    });
  }
});

/* ── fetch 전략 ──────────────────────────────────────────────── */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // 쓰기 요청은 통과

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (!/^https?:$/.test(url.protocol)) return;
  if (NEVER_CACHE_HOSTS.includes(url.hostname)) return;

  // 1) 페이지 이동 → 네트워크 우선 (새 버전을 바로 받되, 끊기면 캐시)
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const preload = await e.preloadResponse;
        const res = preload || await fetch(req);
        // 캐시 저장은 반드시 waitUntil 로 감싼다.
        // 그냥 cache.put 만 하면 응답 스트림을 다 읽기 전에 이벤트가 끝나서
        // 페이지가 중간에서 잘린 채 파싱된다 (index.html이 큰 단일 파일이라 특히 치명적).
        const copy = res.clone();
        e.waitUntil(caches.open(SHELL).then(c => c.put(p('index.html'), copy)));
        return res;
      } catch {
        const cache = await caches.open(SHELL);
        return (await cache.match(p('index.html')))
            || (await cache.match(p('')))
            || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  // 2) 같은 출처 정적 파일 (아이콘·매니페스트) → 캐시 우선
  if (sameOrigin) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          e.waitUntil(cache.put(req, copy));
        }
        return res;
      } catch {
        return hit || Response.error();
      }
    })());
    return;
  }

  // 3) 외부 CDN (firebase SDK, 웹폰트) → 캐시 즉시 반환 + 백그라운드 갱신
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          e.waitUntil(cache.put(req, copy));
        }
        return res;
      }).catch(() => null);
      return hit || (await network) || Response.error();
    })());
  }
  // 그 외 (Firestore 등)는 손대지 않는다
});

/* ── 웹 푸시 수신 ────────────────────────────────────────────── */
self.addEventListener('push', (e) => {
  let payload = {};
  try {
    payload = e.data ? e.data.json() : {};
  } catch {
    payload = { notification: { title: 'GAS-IMS', body: e.data ? e.data.text() : '' } };
  }

  // FCM은 { notification: {...}, data: {...} }, 직접 보내면 평문 객체
  const n = payload.notification || payload;
  const d = payload.data || {};

  const title = n.title || d.title || 'GAS-IMS';
  const body  = n.body  || d.body  || '';
  const tab   = d.tab || '';

  e.waitUntil(self.registration.showNotification(title, {
    body,
    icon:  p('icons/icon-192.png'),
    badge: p('icons/favicon-32.png'),
    tag:   d.tag || n.tag || 'gasims',
    renotify: true,
    requireInteraction: d.requireInteraction === 'true',
    data: { url: d.url || (tab ? p(`?tab=${tab}`) : p('')) },
  }));
});

/* ── 알림 클릭 → 앱 열기 / 이미 열린 창 포커스 ──────────────── */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || p('');

  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.location.origin + BASE)) {
        await c.focus();
        c.postMessage({ type: 'NOTIFICATION_CLICK', url: target });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

/* ── 네트워크가 죽었고 캐시도 비었을 때의 최소 화면 ─────────── */
const OFFLINE_HTML = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>오프라인 · GAS-IMS</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#0d1117;color:#e6edf3;font-family:-apple-system,'Nanum Gothic',sans-serif;text-align:center;padding:24px}
h1{font-size:18px;margin:0 0 8px}p{color:#8b949e;font-size:13px;line-height:1.7;margin:0 0 20px}
button{background:rgba(57,211,83,.15);color:#39d353;border:1px solid rgba(57,211,83,.4);
padding:10px 20px;border-radius:8px;font-size:14px}
</style></head><body><div>
<h1>연결이 끊겼습니다</h1>
<p>앱이 아직 저장되지 않았습니다.<br>네트워크가 연결된 상태에서 한 번 실행하면<br>다음부터는 오프라인에서도 열립니다.</p>
<button onclick="location.reload()">다시 시도</button>
</div></body></html>`;
