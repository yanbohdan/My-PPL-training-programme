/*
 * Service Worker for "My PPL training programme".
 *
 * Real (non-simulated) PWA caching:
 *  - Precaches the app shell on install.
 *  - Serves the app from cache when offline (cache-first for the shell,
 *    network-first with cache fallback for navigations).
 *  - Falls back to offline.html only if a navigation isn't cached and
 *    the network is unreachable.
 *  - Cleans up old caches on activate and only takes over once the user
 *    (via the in-app "Оновити" button) or the browser tells it to.
 *
 * IMPORTANT: bump CACHE_VERSION every time you ship a change to index.html
 * or any precached asset, so returning users get the new version instead
 * of a stale cached copy.
 */
"use strict";

var CACHE_VERSION = "v1";
var CACHE_NAME = "ppl-cache-" + CACHE_VERSION;

var APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./offline.html",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png"
];

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      // addAll fails the whole install if one request fails, so we cache
      // what we can individually — a missing font mustn't break the PWA.
      return Promise.all(
        APP_SHELL.map(function(url){
          return cache.add(url).catch(function(){ /* ignore single-file failures */ });
        })
      );
    })
  );
  // No self.skipWaiting() here on purpose: an already-open tab keeps running
  // the old version until the user confirms the "Оновити" prompt (or closes
  // every tab), so we never swap code out from under an in-progress workout.
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(key){ return key !== CACHE_NAME; })
            .map(function(key){ return caches.delete(key); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

// Lets the page force this waiting worker to activate immediately
// (wired up to the in-app update banner).
self.addEventListener("message", function(event){
  if(event.data && event.data.type === "SKIP_WAITING"){
    self.skipWaiting();
  }
});

function isNavigationRequest(request){
  return request.mode === "navigate" ||
    (request.method === "GET" && request.headers.get("accept") && request.headers.get("accept").indexOf("text/html") !== -1);
}

self.addEventListener("fetch", function(event){
  var request = event.request;
  if(request.method !== "GET") return;

  if(isNavigationRequest(request)){
    // Network-first for HTML so users get the latest page when online,
    // with a full offline fallback chain when they are not.
    event.respondWith(
      fetch(request).then(function(response){
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put("./index.html", copy); });
        return response;
      }).catch(function(){
        return caches.match(request).then(function(cached){
          return cached || caches.match("./index.html").then(function(shell){
            return shell || caches.match("./offline.html");
          });
        });
      })
    );
    return;
  }

  // Cache-first for everything else (CSS, fonts, icons, manifest):
  // instant + works offline, with a network fallback that also
  // populates the cache for next time.
  event.respondWith(
    caches.match(request).then(function(cached){
      if(cached) return cached;
      return fetch(request).then(function(response){
        if(response && response.status === 200){
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(request, copy); });
        }
        return response;
      }).catch(function(){
        // No cache, no network: nothing sensible to return for a
        // sub-resource, so let the browser surface its own network error.
        return caches.match("./offline.html");
      });
    })
  );
});
