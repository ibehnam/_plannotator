/**
 * What a page needs to run in the viewer's frame as it runs in a browser tab.
 *
 * The frame is sandboxed with scripts but without `allow-same-origin`: an
 * opaque origin, so two web APIs throw where a tab never would, and a page
 * that calls one of them while it builds itself stops there and stays blank:
 *
 * - `history.replaceState` / `pushState`. A srcdoc document's address is
 *   `about:srcdoc`, and the URL a page passes resolves against the viewer's
 *   `<base href>` (the page's folder on the asset route), so even
 *   `replaceState(null, '', '#state=C4')` names another address and throws a
 *   SecurityError. A served page (the Inbox's "Pages only") takes it, but its
 *   address becomes the folder's. A bare fragment (or an empty URL) is applied
 *   to the page's own address, as in a tab, and so is a bare query
 *   (`replaceState(null, '', '?variant=2')`): a served page's address keeps
 *   its path and takes the query (srcdoc refuses a query, so there it keeps
 *   only the fragment); any other URL the frame refuses
 *   keeps the page's address and takes only that URL's fragment. The state
 *   object is kept either way.
 * - `localStorage` / `sessionStorage`, whose getter throws in an opaque
 *   origin. Each becomes an in-memory Storage for this load of the page.
 *   Nothing is written anywhere unless the host offers a store (below).
 *
 * What the host offers this load, `window.__plannotatorFrameHost`, put
 * right before the shim (`injectSandboxShim`) and read and removed first, so
 * no page script sees it and the bridge's second run finds none:
 *
 * - `storage`: the review's page items, `local` and `session` as `[key,
 *   value]` pairs, and a `limit` on all of them together, each item counted
 *   as its key, its value and `perItem` more. Both storages start from them,
 *   and every change is posted to the host as `{type:
 *   'plannotator-bridge-storage', area, op, key, value}` (`op` `set`,
 *   `remove` or `clear`; a remove or clear even of what this load does not
 *   hold, since the store may), so the next page, and a reload of the tab,
 *   read what this one stored. A change past the limit stays with this load
 *   only, and the console says so once.
 *
 * No offer: no message is posted.
 *
 * Never in live mode: a proxied app runs on its own real origin. The shim is
 * idempotent: the inline path runs it first in `<head>` (so a page's own head
 * scripts find it) and the bridge runs it again (so the `bridgeScriptUrl`
 * path gets it too), where it does nothing the second time.
 *
 * A dependency-free string, like BRIDGE_SCRIPT: no backslashes, backticks or
 * closing script tag.
 */
export const SANDBOX_SHIM_SCRIPT = `(function() {
  var offer = null;
  try {
    offer = window.__plannotatorFrameHost;
    delete window.__plannotatorFrameHost;
  } catch (ignored) {}
  if (!offer || typeof offer !== 'object') offer = null;
  var toHost = function(message) {
    try { window.parent.postMessage(message, '*'); } catch (ignored) {}
  };

  var h = window.history;
  if (h && !(h.replaceState && h.replaceState.plannotatorSandboxShim)) {
    ['pushState', 'replaceState'].forEach(function(name) {
      var original = h[name];
      if (typeof original !== 'function') return;
      var shim = function(state, unused, url) {
        if (url === undefined || url === null) return original.apply(this, arguments);
        var raw = String(url);
        var own = location.href.split('#')[0];
        if (raw === '' || raw.charAt(0) === '#') return original.call(this, state, unused, own + raw);
        if (raw.charAt(0) === '?') {
          try {
            return original.call(this, state, unused, own.split('?')[0] + raw);
          } catch (error) {
            if (!error || error.name !== 'SecurityError') throw error;
            var at = raw.indexOf('#');
            return original.call(this, state, unused, own + (at < 0 ? '' : raw.slice(at)));
          }
        }
        try {
          return original.call(this, state, unused, url);
        } catch (error) {
          if (!error || error.name !== 'SecurityError') throw error;
          var hash = '';
          try { hash = new URL(raw, document.baseURI).hash; } catch (ignored) {}
          return original.call(this, state, unused, own + hash);
        }
      };
      shim.plannotatorSandboxShim = true;
      h[name] = shim;
    });
  }

  // What the review's store holds of each storage (key to its size), the
  // seed and every change posted since: the limit counts these.
  var store = offer && offer.storage && typeof offer.storage === 'object' ? offer.storage : null;
  var limit = store && typeof store.limit === 'number' ? store.limit : 0;
  var perItem = store && typeof store.perItem === 'number' ? store.perItem : 0;
  var held = { local: new Map(), session: new Map() };
  var heldSize = 0;
  var warned = false;
  function keep(area, op, key, value) {
    if (!store) return;
    var sizes = held[area];
    if (op === 'clear') {
      sizes.forEach(function(size) { heldSize -= size; });
      sizes.clear();
    } else if (op === 'remove') {
      if (sizes.has(key)) heldSize -= sizes.get(key);
      sizes.delete(key);
    } else {
      var size = key.length + value.length + perItem;
      var next = heldSize - (sizes.has(key) ? sizes.get(key) : 0) + size;
      if (next > limit) {
        if (!warned) {
          warned = true;
          try { console.warn('Plannotator: this page stores more than ' + limit + ' characters; what it stores now lasts only until it is left.'); } catch (ignored) {}
        }
        return;
      }
      heldSize = next;
      sizes.set(key, size);
    }
    toHost({ type: 'plannotator-bridge-storage', area: area, op: op, key: key, value: value });
  }

  function memoryStorage(area) {
    var items = new Map();
    var seed = store && Array.isArray(store[area]) ? store[area] : [];
    seed.forEach(function(pair) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') return;
      items.set(pair[0], pair[1]);
      held[area].set(pair[0], pair[0].length + pair[1].length + perItem);
      heldSize += pair[0].length + pair[1].length + perItem;
    });
    var set = function(key, value) {
      if (items.has(key) && items.get(key) === value) return;
      items.set(key, value);
      keep(area, 'set', key, value);
    };
    var remove = function(key) {
      items.delete(key);
      keep(area, 'remove', key);
    };
    var api = {
      getItem: function(key) { key = String(key); return items.has(key) ? items.get(key) : null; },
      setItem: function(key, value) { set(String(key), String(value)); },
      removeItem: function(key) { remove(String(key)); },
      clear: function() {
        items.clear();
        keep(area, 'clear');
      },
      key: function(index) {
        var keys = Array.from(items.keys());
        index = Math.floor(Number(index)) || 0;
        return index >= 0 && index < keys.length ? keys[index] : null;
      }
    };
    var isApi = function(p) { return Object.prototype.hasOwnProperty.call(api, p); };
    var target = typeof Storage === 'function' ? Object.create(Storage.prototype) : {};
    return new Proxy(target, {
      get: function(t, p) {
        if (p === 'length') return items.size;
        if (typeof p === 'string' && isApi(p)) return api[p];
        if (typeof p === 'string' && items.has(p) && !(p in t)) return items.get(p);
        return Reflect.get(t, p);
      },
      set: function(t, p, value) {
        if (typeof p !== 'string') return Reflect.set(t, p, value);
        if (!isApi(p) && p !== 'length') set(p, String(value));
        return true;
      },
      deleteProperty: function(t, p) {
        if (typeof p === 'string') remove(p);
        return true;
      },
      has: function(t, p) { return (typeof p === 'string' && items.has(p)) || p in t; },
      ownKeys: function() { return Array.from(items.keys()); },
      getOwnPropertyDescriptor: function(t, p) {
        if (typeof p === 'string' && items.has(p)) {
          return { value: items.get(p), writable: true, enumerable: true, configurable: true };
        }
        return undefined;
      }
    });
  }
  [['localStorage', 'local'], ['sessionStorage', 'session']].forEach(function(names) {
    try { if (window[names[0]]) return; } catch (denied) {}
    try {
      Object.defineProperty(window, names[0], { value: memoryStorage(names[1]), configurable: true, enumerable: true });
    } catch (ignored) {}
  });
})();`;
