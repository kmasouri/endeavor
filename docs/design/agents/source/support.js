// Minimal local renderer for .dc.html artboards, used only to screenshot and export them.
(function () {
  const override = Object.fromEntries(new URLSearchParams(location.search));

  class DCLogic {
    constructor(props) { this.props = props; this.state = {}; }
    setState(patch) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); this.__render(); }
    forceUpdate() { this.__render(); }
  }
  window.DCLogic = DCLogic;

  let suppress = false;
  const HOLE =/\{\{\s*([^}]+?)\s*\}\}/g;
  const WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;

  function lookup(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    const parts = path.split('.');
    let v = scope;
    for (const p of parts) { if (v == null) return undefined; v = v[p]; }
    return v;
  }

  function load(name) {
    // The standalone preview embeds every artboard, so it opens straight from disk.
    if (window.__DC_FILES) return new DOMParser().parseFromString(window.__DC_FILES[name + '.dc.html'], 'text/html');
    const xhr = new XMLHttpRequest();
    xhr.open('GET', name + '.dc.html', false);
    xhr.send();
    return new DOMParser().parseFromString(xhr.responseText, 'text/html');
  }

  function camel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

  function mount(doc, host, passed) {
    const xdc = doc.querySelector('x-dc');
    const script = doc.querySelector('script[data-dc-script]');
    const decl = JSON.parse(script.getAttribute('data-props') || '{}');
    const props = {};
    for (const [k, d] of Object.entries(decl)) if (!k.startsWith('$') && d && 'default' in d) props[k] = d.default;
    Object.assign(props, passed);
    const helmet = xdc.querySelector('helmet');
    if (helmet) { for (const s of helmet.querySelectorAll('style')) document.head.appendChild(s.cloneNode(true)); helmet.remove(); }
    const Component = new Function('DCLogic', script.textContent + '\n;return Component;')(DCLogic);
    const inst = new Component(props);
    inst.state = inst.state || {};
    inst.__render = () => {
      const vals = inst.renderVals();
      // Keep focus on a redrawn field so typing keeps working.
      const active = document.activeElement;
      const key = active && host.contains(active) ? active.getAttribute('aria-label') : null;
      host.replaceChildren(...[...xdc.childNodes].flatMap((n) => process(n, vals)));
      if (key) {
        const next = host.querySelector(`[aria-label="${CSS.escape(key)}"]`);
        if (next) {
          suppress = true;
          next.focus();
          if (typeof next.value === 'string' && next.setSelectionRange) next.setSelectionRange(next.value.length, next.value.length);
          suppress = false;
        }
      }
    };
    inst.__render();
  }

  function process(node, scope) {
    if (node.nodeType === Node.TEXT_NODE) {
      return [document.createTextNode(node.textContent.replace(HOLE, (_, p) => { const v = lookup(p, scope); return v == null ? '' : String(v); }))];
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const tag = node.tagName.toLowerCase();
    const raw = (name) => { const m = (node.getAttribute(name) || '').match(WHOLE); return m ? lookup(m[1], scope) : node.getAttribute(name); };
    if (tag === 'sc-for') {
      const list = raw('list') || [];
      const as = node.getAttribute('as') || 'item';
      return list.flatMap((item, i) => [...node.childNodes].flatMap((c) => process(c, Object.assign(Object.create(scope), { [as]: item, $index: i }))));
    }
    if (tag === 'sc-if') return raw('value') ? [...node.childNodes].flatMap((c) => process(c, scope)) : [];
    if (tag === 'dc-import') {
      const passed = {};
      for (const a of node.attributes) if (a.name !== 'name' && !a.name.startsWith('hint-')) passed[camel(a.name)] = raw(a.name);
      const host = document.createElement('div');
      mount(load(node.getAttribute('name')), host, passed);
      return [host];
    }
    const el = node.cloneNode(false);
    for (const a of [...node.attributes]) {
      if (!a.value.includes('{{')) continue;
      const m = a.value.match(WHOLE);
      const v = m ? lookup(m[1], scope) : a.value.replace(HOLE, (_, p) => String(lookup(p, scope) ?? ''));
      if (/^on[A-Z]/.test(a.name) || /^on[a-z]+$/.test(a.name) && typeof v === 'function') {
        el.removeAttribute(a.name);
        if (typeof v === 'function') el.addEventListener(a.name.slice(2).toLowerCase(), (e) => { if (!suppress) v(e); });
      } else if (a.name === 'value') { el.removeAttribute('value'); el.value = v ?? ''; el.setAttribute('value', v ?? ''); }
      else el.setAttribute(a.name, v == null ? '' : String(v));
    }
    for (const c of node.childNodes) el.append(...process(c, scope));
    return [el];
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (window.__DC_FILES) {
      const { screen = 'Main', ...rest } = override;
      mount(load(screen), document.getElementById('dc-root'), rest);
      document.documentElement.dataset.rendered = 'true';
      return;
    }
    const xdc = document.querySelector('x-dc');
    const host = document.createElement('div');
    host.id = 'dc-root';
    xdc.replaceWith(host);
    const doc = document.implementation.createHTMLDocument('');
    doc.body.append(xdc, document.querySelector('script[data-dc-script]'));
    mount(doc, host, override);
    document.documentElement.dataset.rendered = 'true';
  });
})();
