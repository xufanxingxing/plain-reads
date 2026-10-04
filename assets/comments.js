/* plain-reads comments: select text, leave a comment, cards float in the right margin.
 *
 * A page opts in with <main data-page="some/slug">. Comments are anchored to the
 * selected text (character offsets plus the quoted text, so they survive small edits).
 */
(function () {
  'use strict';

  // Supabase project that holds shared comments. The publishable key is meant to be
  // public: reads are limited by row level security, writes go through the
  // plain_reads_* functions (see supabase/comments.sql). With no key, comments stay
  // in this browser's localStorage.
  var REMOTE = { url: 'https://etyumpdidolpjffofxju.supabase.co', key: 'sb_publishable_ECIwF15yezzwFhxyW9oH9Q_TILVt8CY' };

  var cfg = window.PLAIN_READS_COMMENTS || REMOTE;
  var root = document.querySelector('main[data-page]');
  if (!root || !window.Promise || !document.createTreeWalker) return;

  var PAGE = root.getAttribute('data-page');
  var remote = !!(cfg.url && cfg.key);
  var SKIP = 'script,style,svg,.math,mjx-container,[data-cmt-ui]';
  var WIDE = window.matchMedia('(min-width: 1000px)');
  var MAX = { quote: 4000, body: 2000, name: 40, context: 32 };
  var GAP = 10;

  // ---------------------------------------------------------------- small helpers
  function lsGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, value) { try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; } }
  function jsonGet(key, fallback) {
    try { var v = JSON.parse(lsGet(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function randomHex(bytes) {
    var a = new Uint8Array(bytes);
    window.crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function ui(node) { node.setAttribute('data-cmt-ui', ''); node.lang = 'zh-CN'; return node; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function safeId(id) { return /^[\w-]+$/.test(String(id)); }
  function calm() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  // ---------------------------------------------------------------- identity
  var SECRET_KEY = 'plain-reads:owner';
  var NAME_KEY = 'plain-reads:name';
  var MINE_KEY = 'plain-reads:mine:' + PAGE;
  var secret = lsGet(SECRET_KEY);
  if (!secret) { secret = randomHex(32); lsSet(SECRET_KEY, secret); }
  var mine = jsonGet(MINE_KEY, []);
  function isMine(id) { return !remote || mine.indexOf(id) !== -1; }

  // ---------------------------------------------------------------- storage
  function request(path, body) {
    var opts = { method: body ? 'POST' : 'GET', headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key } };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(cfg.url + '/rest/v1/' + path, opts).then(function (res) {
      if (res.status === 204) return null;
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) throw new Error((data && data.message) || ('HTTP ' + res.status));
        return data;
      });
    });
  }
  function oneRow(data) { return Array.isArray(data) ? data[0] : data; }
  var remoteStore = {
    list: function () {
      return request('plain_reads_comments?select=*&order=created_at.asc&page=eq.' + encodeURIComponent(PAGE));
    },
    add: function (d) {
      return request('rpc/plain_reads_add_comment', {
        p_page: PAGE, p_start: d.start_offset, p_end: d.end_offset, p_quote: d.quote,
        p_prefix: d.prefix, p_suffix: d.suffix, p_body: d.body, p_author: d.author_name, p_secret: secret
      }).then(oneRow);
    },
    edit: function (id, body) {
      return request('rpc/plain_reads_edit_comment', { p_id: id, p_secret: secret, p_body: body }).then(oneRow);
    },
    remove: function (id) {
      return request('rpc/plain_reads_delete_comment', { p_id: id, p_secret: secret });
    }
  };

  var LOCAL_KEY = 'plain-reads:comments:v2:' + PAGE;
  function localSave(rows) {
    return lsSet(LOCAL_KEY, JSON.stringify(rows)) ? Promise.resolve() : Promise.reject(new Error('storage'));
  }
  var localStore = {
    list: function () { return Promise.resolve(jsonGet(LOCAL_KEY, [])); },
    add: function (d) {
      var rows = jsonGet(LOCAL_KEY, []);
      var row = {
        id: randomHex(8), page: PAGE, start_offset: d.start_offset, end_offset: d.end_offset, quote: d.quote,
        prefix: d.prefix, suffix: d.suffix, body: d.body, author_name: d.author_name,
        created_at: new Date().toISOString(), updated_at: null
      };
      rows.push(row);
      return localSave(rows).then(function () { return row; });
    },
    edit: function (id, body) {
      var rows = jsonGet(LOCAL_KEY, []), hit = null;
      rows.forEach(function (r) { if (r.id === id) { r.body = body; r.updated_at = new Date().toISOString(); hit = r; } });
      return hit ? localSave(rows).then(function () { return hit; }) : Promise.reject(new Error('missing'));
    },
    remove: function (id) {
      return localSave(jsonGet(LOCAL_KEY, []).filter(function (r) { return r.id !== id; })).then(function () { return true; });
    }
  };
  var store = remote ? remoteStore : localStore;

  function explain(err) {
    var msg = String((err && err.message) || '');
    if (/too many/i.test(msg)) return '评论太频繁了，过几分钟再试。';
    if (/not yours|not found/i.test(msg)) return '这条评论不是在这个浏览器里写的，不能修改。';
    if (/storage/.test(msg)) return '这个浏览器不让保存，评论没有存下来。';
    return '没有保存成功，请检查网络后再试。';
  }

  // ---------------------------------------------------------------- text model
  // The page text is every text node under <main>, skipping math and this script's own UI.
  function textIndex() {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [], parts = [], pos = 0, n;
    while ((n = walker.nextNode())) {
      var p = n.parentElement;
      if (!p || p.closest(SKIP)) continue;
      nodes.push({ node: n, start: pos });
      parts.push(n.data);
      pos += n.data.length;
    }
    return { nodes: nodes, text: parts.join('') };
  }

  function offsetsOf(range, idx) {
    var nodes = idx.nodes, lo, hi, mid;
    function cmp(node, off) { try { return range.comparePoint(node, off); } catch (e) { return 1; } }
    lo = 0; hi = nodes.length;
    while (lo < hi) {              // first node that ends at or after the range start
      mid = (lo + hi) >> 1;
      if (cmp(nodes[mid].node, nodes[mid].node.data.length) < 0) lo = mid + 1; else hi = mid;
    }
    var first = lo;
    if (first >= nodes.length) return null;
    lo = first - 1; hi = nodes.length - 1;
    while (lo < hi) {              // last node that starts at or before the range end
      mid = (lo + hi + 1) >> 1;
      if (cmp(nodes[mid].node, 0) > 0) hi = mid - 1; else lo = mid;
    }
    var last = lo;
    if (last < first) return null;
    var a = nodes[first], b = nodes[last], alen = a.node.data.length, blen = b.node.data.length;
    var s = a.start + (range.startContainer === a.node ? range.startOffset : (cmp(a.node, 0) >= 0 ? 0 : alen));
    var e = b.start + (range.endContainer === b.node ? range.endOffset : (cmp(b.node, blen) <= 0 ? blen : 0));
    while (s < e && /\s/.test(idx.text.charAt(s))) s++;
    while (e > s && /\s/.test(idx.text.charAt(e - 1))) e--;
    return e > s ? { start: s, end: e } : null;
  }

  // Where a stored comment sits in today's text: its offsets if the quote still
  // matches there, otherwise the best match for the quote elsewhere.
  function resolve(c, text) {
    var s = c.start_offset, q = c.quote;
    if (!q) return null;
    if (text.slice(s, c.end_offset) === q) return [s, c.end_offset];
    var best = -1, bestScore = -Infinity, at = text.indexOf(q), tries = 0;
    while (at !== -1 && tries++ < 200) {
      var score = -Math.abs(at - s) / (text.length || 1);
      if (c.prefix && text.slice(Math.max(0, at - c.prefix.length), at) === c.prefix) score += 2;
      if (c.suffix && text.slice(at + q.length, at + q.length + c.suffix.length) === c.suffix) score += 2;
      if (score > bestScore) { bestScore = score; best = at; }
      at = text.indexOf(q, at + 1);
    }
    return best < 0 ? null : [best, best + q.length];
  }

  // ---------------------------------------------------------------- state
  var state = { comments: [], draft: null, active: null, editing: null, editText: '', busy: false, error: '', status: 'loading' };
  var placed = {};      // id -> true when the comment found its text on the last paint
  var rail = ui(el('aside', 'cmt-rail'));
  rail.setAttribute('aria-label', '评论');
  var orphans = ui(el('div', 'cmt-inline cmt-orphans'));
  var pill = ui(el('button', 'cmt-pill', '＋ 评论'));
  pill.type = 'button';
  pill.hidden = true;
  var statusChip = ui(el('button', 'cmt-status'));
  statusChip.type = 'button';
  statusChip.hidden = true;
  var pending = null;   // the selection the pill refers to
  var pressing = false; // a press on the pill is under way

  // ---------------------------------------------------------------- highlights
  function unwrap() {
    var marks = root.querySelectorAll('mark.cmt-hl');
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i], p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
    }
    if (marks.length) root.normalize();
  }

  function wrapNode(node, base, hits) {
    var data = node.data, len = data.length, cuts = [0, len];
    hits.forEach(function (h) {
      var s = Math.max(h.s - base, 0), e = Math.min(h.e - base, len);
      if (cuts.indexOf(s) < 0) cuts.push(s);
      if (cuts.indexOf(e) < 0) cuts.push(e);
    });
    cuts.sort(function (x, y) { return x - y; });
    var structural = /^(TABLE|THEAD|TBODY|TFOOT|TR|COLGROUP|UL|OL|DL)$/.test(node.parentNode.nodeName);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < cuts.length - 1; i++) {
      var s = cuts[i], e = cuts[i + 1], piece = data.slice(s, e);
      var ids = [];
      hits.forEach(function (h) { if (h.s - base <= s && h.e - base >= e) ids.push(h.id); });
      var blank = /^\s*$/.test(piece) && (structural || piece.indexOf('\n') !== -1);
      if (!ids.length || blank) { frag.appendChild(document.createTextNode(piece)); continue; }
      var m = el('mark', 'cmt-hl', piece);
      m.setAttribute('data-ids', ids.join(' '));
      frag.appendChild(m);
    }
    node.parentNode.replaceChild(frag, node);
  }

  function paint() {
    unwrap();
    var idx = textIndex(), items = [], lo = Infinity, hi = -1;
    placed = {};
    function push(id, r) {
      items.push({ id: id, s: r[0], e: r[1] });
      placed[id] = true;
      lo = Math.min(lo, r[0]); hi = Math.max(hi, r[1]);
    }
    state.comments.forEach(function (c) {
      if (!safeId(c.id)) return;
      var r = resolve(c, idx.text);
      if (r) push(c.id, r);
    });
    if (state.draft) push('draft', [state.draft.start_offset, state.draft.end_offset]);
    if (!items.length) return;
    idx.nodes.forEach(function (n) {
      var a = n.start, b = a + n.node.data.length;
      if (b <= lo || a >= hi || a === b) return;
      var hits = items.filter(function (it) { return it.s < b && it.e > a; });
      if (hits.length) wrapNode(n.node, a, hits);
    });
  }

  function marksOf(id) { return root.querySelectorAll('mark.cmt-hl[data-ids~="' + id + '"]'); }

  // ---------------------------------------------------------------- cards
  function focusId() { return state.draft ? 'draft' : (state.editing || state.active); }

  function button(cls, label, onClick) {
    var b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', function (e) { e.stopPropagation(); onClick(b); });
    return b;
  }

  function field(tag, id, value, placeholder, label, max) {
    var f = el(tag, null);
    f.id = id;
    f.value = value;
    f.placeholder = placeholder;
    f.maxLength = max;
    f.setAttribute('aria-label', label);
    return f;
  }

  function composer(opts) {
    // opts: { id, text, withName, submitLabel, onInput, onSubmit, onCancel }
    var form = el('form', 'cmt-form');
    var name = null;
    if (opts.withName) {
      name = field('input', 'cmt-name', lsGet(NAME_KEY) || '', '你的名字（可不填）', '你的名字', MAX.name);
      name.type = 'text';
      name.autocomplete = 'nickname';
      form.appendChild(name);
    }
    var input = field('textarea', 'cmt-text-' + opts.id, opts.text, '写下评论…', '评论内容', MAX.body);
    input.rows = 3;
    input.addEventListener('input', function () { opts.onInput(input.value); });
    form.appendChild(input);
    if (state.error) {
      var err = el('p', 'cmt-error', state.error);
      err.setAttribute('role', 'alert');
      form.appendChild(err);
    }
    var row = el('div', 'cmt-row');
    var ok = el('button', 'cmt-primary', state.busy ? '保存中…' : opts.submitLabel);
    ok.type = 'submit';
    ok.disabled = state.busy;
    row.appendChild(ok);
    row.appendChild(button('cmt-link', '取消', opts.onCancel));
    form.appendChild(row);
    if (opts.withName) {
      form.appendChild(el('p', 'cmt-note', remote ? '所有打开这个页面的人都能看到这条评论。' : '只保存在这个浏览器里，别人看不到。'));
    }
    function submit() {
      var text = input.value.trim();
      if (!text) { input.focus(); return; }
      if (state.busy) return;
      opts.onSubmit(text, name ? name.value.trim().slice(0, MAX.name) : '');
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    form.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); opts.onCancel(); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
    });
    form.addEventListener('click', function (e) { e.stopPropagation(); });
    return form;
  }

  function quoteLine(text) { return el('p', 'cmt-quote', text.replace(/\s+/g, ' ')); }

  function commentCard(c) {
    var card = ui(el('article', 'cmt-card'));
    card.setAttribute('data-id', c.id);
    var head = el('div', 'cmt-head');
    head.appendChild(el('span', 'cmt-author', c.author_name || '匿名'));
    head.appendChild(el('span', 'cmt-time', when(c.created_at) + (c.updated_at ? ' · 已编辑' : '')));
    card.appendChild(head);
    card.appendChild(quoteLine(c.quote));
    if (state.editing === c.id) {
      card.appendChild(composer({
        id: c.id, text: state.editText, withName: false, submitLabel: '保存',
        onInput: function (v) { state.editText = v; },
        onSubmit: function (text) { saveEdit(c.id, text); },
        onCancel: function () { state.editing = null; state.error = ''; render(); }
      }));
      return card;
    }
    card.appendChild(el('p', 'cmt-body', c.body));
    if (isMine(c.id)) {
      var row = el('div', 'cmt-row cmt-own');
      row.appendChild(button('cmt-link', '编辑', function () {
        state.editing = c.id; state.editText = c.body; state.active = c.id; state.error = '';
        render();
        focusField('cmt-text-' + c.id);
      }));
      row.appendChild(button('cmt-link', '删除', function (b) {
        if (b.getAttribute('data-armed')) { removeComment(c.id); return; }
        b.setAttribute('data-armed', '1');
        b.textContent = '确认删除';
        window.setTimeout(function () { b.removeAttribute('data-armed'); b.textContent = '删除'; }, 4000);
      }));
      card.appendChild(row);
    }
    card.addEventListener('click', function () { activate(c.id, 'card'); });
    return card;
  }

  function draftCard() {
    var card = ui(el('article', 'cmt-card cmt-draft'));
    card.setAttribute('data-id', 'draft');
    card.appendChild(quoteLine(state.draft.quote));
    card.appendChild(composer({
      id: 'draft', text: state.draft.body, withName: true, submitLabel: '评论',
      onInput: function (v) { state.draft.body = v; },
      onSubmit: saveDraft,
      onCancel: function () { state.draft = null; state.error = ''; render(); }
    }));
    return card;
  }

  function focusField(id) {
    var f = document.getElementById(id);
    if (!f) return;
    try { f.focus({ preventScroll: WIDE.matches }); } catch (e) { f.focus(); }
    if (f.setSelectionRange) f.setSelectionRange(f.value.length, f.value.length);
  }

  // The top-level block that holds a highlight; narrow screens put the card after it.
  function blockOf(node) {
    var n = node;
    while (n.parentNode && n.parentNode !== root && n.parentNode.nodeName !== 'SECTION') n = n.parentNode;
    return n;
  }
  function inlineBox(after) {
    var next = after.nextElementSibling;
    if (next && next.classList.contains('cmt-inline')) return next;
    var box = ui(el('div', 'cmt-inline'));
    after.parentNode.insertBefore(box, after.nextSibling);
    return box;
  }

  function render() {
    paint();
    var old = root.querySelectorAll('.cmt-inline');
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    rail.textContent = '';
    orphans.textContent = '';
    var wide = WIDE.matches, lost = [];

    function place(id, card) {
      var marks = marksOf(id);
      if (!marks.length) return false;
      if (wide) rail.appendChild(card);
      else inlineBox(blockOf(marks[marks.length - 1])).appendChild(card);
      return true;
    }
    state.comments.forEach(function (c) {
      if (!safeId(c.id)) return;
      if (!placed[c.id] || !place(c.id, commentCard(c))) lost.push(c);
    });
    if (state.draft) place('draft', draftCard());
    if (lost.length) {
      orphans.appendChild(el('p', 'cmt-orphans-title', '下面的评论对应的原文已经改动，找不到原来的位置：'));
      lost.forEach(function (c) { orphans.appendChild(commentCard(c)); });
      root.appendChild(orphans);
    }
    applyFocus();
    layout();
    showStatus();
  }

  function applyFocus() {
    var id = focusId(), i;
    var marks = root.querySelectorAll('mark.cmt-hl');
    for (i = 0; i < marks.length; i++) {
      marks[i].classList.toggle('is-active', !!id && (' ' + marks[i].getAttribute('data-ids') + ' ').indexOf(' ' + id + ' ') !== -1);
    }
    var cards = document.querySelectorAll('.cmt-card');
    for (i = 0; i < cards.length; i++) cards[i].classList.toggle('is-active', cards[i].getAttribute('data-id') === id);
  }

  // Wide screens: each card sits level with its highlight and later cards move down
  // to make room. The focused card then takes its exact place, and only the cards
  // in its way move up.
  function layout() {
    if (!WIDE.matches) return;
    var railTop = rail.getBoundingClientRect().top, list = [], pin = -1, id = focusId(), i;
    Array.prototype.forEach.call(rail.children, function (card) {
      var marks = marksOf(card.getAttribute('data-id'));
      if (!marks.length) return;
      var r = marks[0].getBoundingClientRect();
      list.push({ card: card, want: Math.max(r.top - railTop - 6, 0), left: r.left, h: card.offsetHeight });
    });
    list.sort(function (a, b) { return a.want - b.want || a.left - b.left; });
    function packFrom(start) {
      for (var k = start; k < list.length; k++) {
        var floor = k ? list[k - 1].top + list[k - 1].h + GAP : 0;
        list[k].top = Math.max(list[k].want, floor);
      }
    }
    packFrom(0);
    for (i = 0; i < list.length; i++) if (list[i].card.getAttribute('data-id') === id) pin = i;
    if (pin >= 0 && list[pin].top > list[pin].want) {
      list[pin].top = list[pin].want;
      for (i = pin - 1; i >= 0; i--) {
        var ceiling = list[i + 1].top - GAP - list[i].h;
        if (list[i].top <= ceiling) break;
        list[i].top = ceiling;
      }
      packFrom(pin + 1);
    }
    list.forEach(function (it) { it.card.style.top = Math.round(it.top) + 'px'; });
  }

  function inView(node) {
    var r = node.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  }

  function activate(id, from) {
    if (state.draft || state.editing) return;
    state.active = id;
    applyFocus();
    layout();
    if (!id) return;
    var marks = marksOf(id), behavior = calm() ? 'auto' : 'smooth';
    if (from === 'card' && marks.length && !inView(marks[0])) marks[0].scrollIntoView({ behavior: behavior, block: 'center' });
    if (from === 'mark' && !WIDE.matches) {
      var card = root.querySelector('.cmt-card[data-id="' + id + '"]');
      if (card && !inView(card)) card.scrollIntoView({ behavior: behavior, block: 'nearest' });
    }
  }

  // ---------------------------------------------------------------- actions
  function fail(err) { state.busy = false; state.error = explain(err); render(); }

  function saveDraft(text, name) {
    var d = state.draft;
    if (name) lsSet(NAME_KEY, name);
    state.busy = true; state.error = ''; d.body = text;
    render();
    store.add({
      start_offset: d.start_offset, end_offset: d.end_offset, quote: d.quote, prefix: d.prefix, suffix: d.suffix,
      body: text, author_name: name || '匿名'
    }).then(function (row) {
      state.busy = false; state.draft = null;
      if (row && row.id) {
        state.comments.push(row);
        mine.push(row.id);
        lsSet(MINE_KEY, JSON.stringify(mine));
        state.active = row.id;
      }
      render();
    }, fail);
  }

  function saveEdit(id, text) {
    state.busy = true; state.error = ''; state.editText = text;
    render();
    store.edit(id, text).then(function (row) {
      state.busy = false; state.editing = null;
      state.comments = state.comments.map(function (c) { return c.id === id && row ? row : c; });
      render();
    }, fail);
  }

  function removeComment(id) {
    store.remove(id).then(function (removed) {
      if (removed === false) { load(true); return; }
      state.comments = state.comments.filter(function (c) { return c.id !== id; });
      if (state.active === id) state.active = null;
      render();
    }, function (err) { state.error = explain(err); showStatus(); });
  }

  function load(quiet) {
    if (!quiet) { state.status = 'loading'; showStatus(); }
    return store.list().then(function (rows) {
      state.comments = Array.isArray(rows) ? rows : [];
      state.status = 'ready'; state.error = '';
      render();
    }, function () {
      state.status = 'error';
      showStatus();
    });
  }

  function showStatus() {
    var text = '';
    if (state.status === 'error') text = '评论没有加载出来，点这里重试';
    else if (state.error && !state.draft && !state.editing) text = state.error;
    statusChip.textContent = text;
    statusChip.hidden = !text;
  }

  // ---------------------------------------------------------------- selecting text
  function readSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0), anc = range.commonAncestorContainer;
    if (anc.nodeType !== 1) anc = anc.parentElement;
    if (!anc || !root.contains(anc) || anc.closest('[data-cmt-ui]')) return null;
    var idx = textIndex(), off = offsetsOf(range, idx);
    if (!off || off.end - off.start > MAX.quote) return null;
    var rects = range.getClientRects();
    if (!rects.length) return null;
    return {
      start_offset: off.start, end_offset: off.end,
      quote: idx.text.slice(off.start, off.end),
      prefix: idx.text.slice(Math.max(0, off.start - MAX.context), off.start),
      suffix: idx.text.slice(off.end, off.end + MAX.context),
      rect: rects[rects.length - 1]
    };
  }

  function checkSelection() {
    if (pressing) return;
    if (state.draft || state.busy) { pill.hidden = true; return; }
    pending = readSelection();
    if (!pending) { pill.hidden = true; return; }
    var host = document.body.getBoundingClientRect();
    pill.hidden = false;
    var left = pending.rect.right - host.left - pill.offsetWidth / 2;
    var max = document.documentElement.clientWidth - host.left - pill.offsetWidth - 8;
    pill.style.top = Math.round(pending.rect.bottom - host.top + 8) + 'px';
    pill.style.left = Math.round(Math.max(8 - host.left, Math.min(left, max))) + 'px';
  }

  var selTimer = 0;
  function selectionSoon() {
    window.clearTimeout(selTimer);
    selTimer = window.setTimeout(checkSelection, 180);
  }

  function startDraft() {
    if (!pending) return;
    state.draft = {
      start_offset: pending.start_offset, end_offset: pending.end_offset, quote: pending.quote,
      prefix: pending.prefix, suffix: pending.suffix, body: ''
    };
    state.editing = null; state.error = '';
    pending = null;
    pill.hidden = true;
    var sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    render();
    focusField('cmt-text-draft');
  }

  // ---------------------------------------------------------------- wiring
  function start() {
    document.body.appendChild(rail);
    document.body.appendChild(pill);
    document.body.appendChild(statusChip);
    document.documentElement.classList.add('has-cmt');

    pill.addEventListener('mousedown', function (e) { e.preventDefault(); });
    pill.addEventListener('pointerdown', function () { pressing = true; });
    ['pointerup', 'pointercancel'].forEach(function (type) {
      document.addEventListener(type, function () {
        if (pressing) window.setTimeout(function () { pressing = false; selectionSoon(); }, 300);
      });
    });
    pill.addEventListener('click', startDraft);
    statusChip.addEventListener('click', function () {
      if (state.status === 'error') load(); else { state.error = ''; showStatus(); }
    });

    document.addEventListener('selectionchange', selectionSoon);
    document.addEventListener('mouseup', selectionSoon);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !pill.hidden) pill.hidden = true;
    });

    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t.closest) return;
      if (t.closest('[data-cmt-ui]')) return;
      var mark = t.closest('mark.cmt-hl');
      var sel = window.getSelection();
      if (mark && (!sel || sel.isCollapsed)) {
        var ids = mark.getAttribute('data-ids').split(' ').filter(function (id) { return id !== 'draft'; });
        if (!ids.length) return;
        var at = ids.indexOf(state.active);
        activate(ids[(at + 1) % ids.length], 'mark');
      } else if (state.active && !mark) {
        activate(null);
      }
    });

    var raf = 0;
    function relayout() {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(layout);
    }
    if (window.ResizeObserver) new ResizeObserver(relayout).observe(root);
    window.addEventListener('resize', relayout);
    window.addEventListener('load', relayout);
    var onMode = function () { render(); };
    if (WIDE.addEventListener) WIDE.addEventListener('change', onMode); else if (WIDE.addListener) WIDE.addListener(onMode);

    var lastLoad = Date.now();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden || state.draft || state.editing || state.busy) return;
      if (Date.now() - lastLoad < 60000) return;
      lastLoad = Date.now();
      load(true);
    });
    window.addEventListener('storage', function (e) {
      if (!remote && e.key === LOCAL_KEY && !state.draft && !state.editing) load(true);
    });

    load();
  }

  // Wait for MathJax's first pass so highlights are drawn on the final text.
  function boot() {
    var mj = window.MathJax && window.MathJax.startup && window.MathJax.startup.promise;
    if (mj && mj.then) mj.then(start, start); else start();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
