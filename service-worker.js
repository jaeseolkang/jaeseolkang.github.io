// 2026-06-19 10:00 KST | PWA 서비스워커 추가: 오프라인 캐싱 + 설치 지원
'use strict';

const CACHE_NAME = 'gaegyebu-v12';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './xlsx.full.min.js',
  './manifest.json'
];

// 설치: 모든 에셋 캐싱
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// 활성화: 구버전 캐시 삭제
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 요청 처리: 캐시 우선, 실패 시 네트워크
self.addEventListener('fetch', (e) => {
  // chrome-extension 등 비-http 요청은 무시
  if (!e.request.url.startsWith('http')) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((response) => {
        // 유효한 응답만 캐싱
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // 오프라인 + 캐시 미스 시 index.html 반환 (SPA fallback)
      return caches.match('./index.html');
    })
  );
});
