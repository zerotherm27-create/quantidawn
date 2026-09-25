/* Light email markup -> safe HTML, plus a plain-text alternative. Shared by the server (api/inbox-send.js)
   and the dashboard preview so what you preview is exactly what is sent.
   Markup: **bold**  *italic*  [text](https://url)  "- " bullets  "1. " numbered  "# " heading.
   Everything is HTML-escaped first and only http(s)/mailto links are allowed, so typed text cannot inject markup. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QDEmailFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var LINK = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g;

  function inline(raw) {
    var links = [];
    var s = esc(raw).replace(LINK, function (m, label, url) {
      links.push('<a href="' + url + '" style="color:#012852;text-decoration:underline">' + label.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>') + '</a>');
      return '\u0001' + (links.length - 1) + '\u0001';
    });
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
    return s.replace(/\u0001(\d+)\u0001/g, function (m, i) { return links[Number(i)]; });
  }

  var P = 'margin:0 0 14px';
  var LIST = 'margin:0 0 14px;padding-left:22px';

  function toHtml(text) {
    var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    var out = [], para = [], list = null;
    function flushPara() { if (para.length) { out.push('<p style="' + P + '">' + para.map(inline).join('<br>') + '</p>'); para = []; } }
    function flushList() { if (list) { out.push('<' + list.tag + ' style="' + LIST + '">' + list.items.map(function (i) { return '<li style="margin:0 0 4px">' + inline(i) + '</li>'; }).join('') + '</' + list.tag + '>'); list = null; } }
    lines.forEach(function (line) {
      var m;
      if (!line.trim()) { flushPara(); flushList(); return; }
      if ((m = /^#{1,3}\s+(.+)$/.exec(line))) { flushPara(); flushList(); out.push('<h2 style="font-size:18px;line-height:1.3;margin:0 0 12px;color:#012852">' + inline(m[1]) + '</h2>'); return; }
      if ((m = /^\s*-\s+(.+)$/.exec(line))) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); return; }
      if ((m = /^\s*\d+\.\s+(.+)$/.exec(line))) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); return; }
      flushList(); para.push(line);
    });
    flushPara(); flushList();
    return '<div style="font-family:-apple-system,\'Segoe UI\',Arial,sans-serif;font-size:15px;line-height:1.55;color:#17212B">' + out.join('') + '</div>';
  }

  function toPlain(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n')
      .replace(LINK, '$1 ($2)')
      .replace(/^#{1,3}\s+/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1$2');
  }

  return { esc: esc, toHtml: toHtml, toPlain: toPlain };
});
