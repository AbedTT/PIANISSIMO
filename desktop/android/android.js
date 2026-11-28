// Pianissimo for Android: what a browser does and the app's WebView does not.
// Loaded first on every page by MainActivity.java (the PianissimoAndroid bridge is defined there).
(function () {
  'use strict';
  var bridge = window.PianissimoAndroid;
  if (!bridge) return;

  // ---- exported files (MusicXML, MIDI, PDF parts, backups…): saved into Downloads/Pianissimo.
  // The page's security policy does not let it fetch blob: links, so the blobs behind them are kept here.
  var blobs = new Map();
  var createObjectURL = URL.createObjectURL;
  var revokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = function (obj) {
    var url = createObjectURL.call(URL, obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = function (url) {
    // a moment later: the file is often revoked right after its link is clicked
    setTimeout(function () {
      blobs.delete(url);
    }, 60000);
    return revokeObjectURL.call(URL, url);
  };

  function save(href, name) {
    name = name || 'score';
    if (/^data:/.test(href)) {
      var comma = href.indexOf(',');
      var head = href.slice(5, comma);
      var body = href.slice(comma + 1);
      var type = head.split(';')[0];
      bridge.save(name, type, /;base64$/.test(head) ? body : btoa(unescape(encodeURIComponent(decodeURIComponent(body)))));
      return;
    }
    var blob = blobs.get(href);
    if (!blob) {
      console.error('Could not save ' + name + ': the file is gone');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var data = String(reader.result);
      bridge.save(name, blob.type || '', data.slice(data.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  }

  function savedLink(a) {
    return a && a.hasAttribute('download') && /^(blob|data):/.test(a.href);
  }

  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (savedLink(this)) return save(this.href, this.getAttribute('download') || this.download);
    return click.call(this);
  };
  document.addEventListener(
    'click',
    function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!savedLink(a)) return;
      e.preventDefault();
      save(a.href, a.getAttribute('download'));
    },
    true,
  );

  // ---- printing: Android's print dialog (which can also save a PDF), with the page laid out for print
  window.print = function () {
    window.dispatchEvent(new Event('beforeprint'));
    bridge.print(document.title || 'Pianissimo');
  };
  // "Install the update" closes the window on the desktop; an app is not closed by its page
  window.close = function () {};

  // ---- the Back button: close what is open in the page first
  function shown(el) {
    // (dialogs are position: fixed, so offsetParent cannot tell; a box on screen can)
    return !!el && !el.hidden && !el.closest('[hidden]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  }
  window.__pianissimoBack = function () {
    var modals = Array.prototype.filter.call(document.querySelectorAll('.modal'), shown);
    var modal = modals[modals.length - 1];
    if (modal) {
      modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      if (shown(modal)) {
        var close = modal.querySelector('[data-close]');
        if (close) close.click();
        else modal.hidden = true;
      }
      return true;
    }
    var side = document.getElementById('side');
    if (side && side.classList.contains('open')) {
      var done = document.getElementById('sideDone');
      if (done) done.click();
      return true;
    }
    var expanded = Array.prototype.filter.call(document.querySelectorAll('[aria-expanded="true"]'), shown);
    if (expanded.length) {
      expanded[expanded.length - 1].click();
      return true;
    }
    return false;
  };

  // ---- the status bar takes the colour of the page's top bar (light or dark theme)
  function bars() {
    var top = document.querySelector('.topbar, header') || document.body;
    if (!top) return;
    var c = getComputedStyle(top).backgroundColor;
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
    if (!m || m[4] === '0') {
      c = getComputedStyle(document.body).backgroundColor;
      m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
    }
    if (!m) return;
    var r = +m[1], g = +m[2], b = +m[3];
    var hex = '#' + [r, g, b].map(function (n) { return ('0' + n.toString(16)).slice(-2); }).join('');
    bridge.bars(hex, 0.299 * r + 0.587 * g + 0.114 * b < 128);
  }
  document.addEventListener('DOMContentLoaded', function () {
    bars();
    new MutationObserver(bars).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  });
  window.addEventListener('load', bars);
})();
