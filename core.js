// 발췌기 연결 (DL-excerpt) — 본체
// 드림랜드에는 DL-excerpt.js(껍데기)를 설치합니다. 껍데기가 켜질 때마다 이 파일을 받아 실행합니다.
//
// 발췌기(romantic-lamb/excerptourstory)를 드림랜드 화면 안에 띄우고, 보고 있는 채팅을 바로 넣어 줍니다.
// 발췌기에서는 ‘채팅 파일에서 가져오기’와 같은 메시지 고르기 창이 열리고, 고른 메시지를 칸으로 가져옵니다.
//
// · 발췌기 페이지는 GitHub에서 최신본을 받아 띄웁니다. 받지 못하면 마지막으로 받아 둔 것을 씁니다.
// · 채팅은 드림랜드 안에서 발췌기 칸으로 바로 건너갑니다. 바깥 사이트나 서버를 거치지 않습니다.
// · 발췌기 창을 닫아도 쓰던 내용은 남아 있다가, 다시 열면 그대로 이어집니다 (드림랜드를 새로 고치기 전까지).

export const manifest = {
  id: 'dl-excerpt',
  name: '발췌기 연결',
  version: '0.2.2',
  author: 'romantic-lamb',
  description: '드림랜드 안에서 발췌기를 열어, 보고 있는 채팅을 이미지 · PDF · HTML 발췌본으로 만듭니다. 메시지 메뉴의 ‘발췌기로 보내기’나 장면 패널에서 씁니다.',
};

const PAGE_URL = 'https://raw.githubusercontent.com/romantic-lamb/excerptourstory/main/index.html';
const TIMEOUT = 8000;

export function activate(api) {
  const { h, btn, iconBtn, toast } = api;

  // ── 설정: 본문(번역/원문) · 숨긴 메시지 · 시스템 메시지 · 미리 골라 둘 최근 메시지 수 ──
  let opt = { text: 'tr', hidden: false, system: false, recent: 0, big: false };
  const ready = api.store.get('opt', null).then(v => { if (v && typeof v === 'object') opt = { ...opt, ...v }; });
  const saveOpt = () => api.store.set('opt', opt);

  const swipeOf = m => (m.swipes && (m.swipes[m.sw] || m.swipes[0])) || {};
  function bodyOf(m) {
    const s = swipeOf(m);
    const tr = typeof s.tr === 'string' ? s.tr.trim() : '';
    return opt.text === 'tr' && tr ? s.tr : String(s.text || '');
  }
  const skip = m => !m || (m.role === 'system' && !opt.system) || (m.hidden && !opt.hidden);

  // 발췌기가 읽는 SillyTavern 채팅 모양({ name, is_user, mes, send_date })으로 바꾼다
  function build(chat, msgs, pickIds) {
    const out = [], pick = [];
    for (const m of msgs || []) {
      if (skip(m)) continue;
      const mes = bodyOf(m);
      if (!mes.trim()) continue;
      if (pickIds && pickIds.has(m.id)) pick.push(out.length);
      out.push({ name: m.name || (m.role === 'user' ? 'User' : 'Character'), is_user: m.role === 'user', mes, send_date: m.ts || null });
    }
    const title = (api.chat.roomName && chat ? api.chat.roomName(chat) : '') || (chat && chat.name) || '';
    return { v: 1, title, msgs: out, pick };
  }
  const recentIds = (msgs, n) => new Set(n > 0 ? (msgs || []).filter(m => !skip(m)).slice(-n).map(m => m.id) : []);

  // ── 발췌기 페이지 받기: 최신본을 받고, 안 되면 저장본 ──
  async function fetchPage() {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(`${PAGE_URL}?t=${Date.now()}`, { cache: 'no-store', signal: ctl.signal });
      if (!r.ok) throw new Error(String(r.status));
      const html = await r.text();
      if (!/receiveFromDreamland/.test(html)) throw new Error('발췌기 페이지 모양이 아니에요');
      return html;
    } finally { clearTimeout(timer); }
  }
  let pageP = null;
  function loadPage() {
    return pageP ||= (async () => {
      const cached = await api.store.get('page', null);
      try {
        const fresh = await fetchPage();
        if (fresh !== cached) await api.store.set('page', fresh);
        return fresh;
      } catch (e) {
        console.warn('[발췌기 연결] 발췌기 최신본을 받지 못해 저장본을 씁니다', e);
        if (cached) return cached;
        pageP = null;
        throw new Error('발췌기를 받지 못했어요. 인터넷 연결을 확인해 주세요');
      }
    })();
  }

  // ── 화면 안의 발췌기 창 ──
  api.style(`
    .dlx-ov { position: fixed; inset: 0; z-index: 9000; display: flex; }
    .dlx-ov[hidden] { display: none; }
    .dlx-win { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; background: var(--bg, #111); overflow: hidden; }
    .dlx-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 6px 10px; padding-top: max(6px, env(safe-area-inset-top)); border-bottom: 1px solid var(--line, rgba(127,127,127,.25)); background: var(--surface, inherit); }
    .dlx-bar b { flex: 1 1 auto; font-size: .95em; }
    .dlx-size { display: none; }
    .dlx-frame { flex: 1 1 auto; width: 100%; border: 0; background: #fff; }
    /* 넓은 화면: 가운데 뜬 창. 바깥을 누르면 닫힌다 (쓰던 내용은 남는다) */
    @media (min-width: 900px) {
      .dlx-ov { align-items: center; justify-content: center; padding: 3vh 3vw; background: rgba(0, 0, 0, .45); }
      .dlx-win { flex: 0 1 auto; width: min(1200px, 100%); height: min(860px, 100%); border-radius: 12px; box-shadow: 0 18px 60px rgba(0, 0, 0, .45); }
      .dlx-bar { padding-top: 6px; }
      .dlx-size { display: inline-flex; }
      .dlx-ov.big { padding: 0; }
      .dlx-ov.big .dlx-win { width: 100%; height: 100%; border-radius: 0; }
    }
    .dlx-wait { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; color: var(--dim); font-size: .9em; }
    .dlx { display: flex; flex-direction: column; gap: 12px; }
    .dlx-sec { display: flex; flex-direction: column; gap: 6px; }
    .dlx-sec > b { font-size: .86em; color: var(--dim); }
    .dlx-hint { font-size: .8em; color: var(--faint); line-height: 1.5; }
    .dlx-chk { display: flex; gap: 8px; align-items: center; font-size: .9em; cursor: pointer; }
    .dlx-tools { display: flex; flex-wrap: wrap; gap: 6px; }
  `);

  // 드림랜드는 보안 정책(CSP)상 앱 화면 안에서 바깥 스크립트를 돌리지 못한다. 그래서 드림랜드가 메시지 속 HTML 화면에 쓰는
  // 빈 틀(/frame)을 빌려 그 안에 발췌기를 쓴다. 틀은 { dlFrameReady } 를 보내 오고, { dlHtml } 을 받으면 그 문서를 쓴다
  let ov = null, frame = null, frameReady = false, queued = null, pageHtml = null;
  const post = payload => frame.contentWindow.postMessage({ type: 'excerpt:chat', payload }, '*');
  const onMsg = e => {
    if (!frame || e.source !== frame.contentWindow || !e.data) return;
    if (e.data.dlFrameReady != null && pageHtml) { frame.contentWindow.postMessage({ dlHtml: pageHtml, init: { script: true } }, '*'); return; }
    if (e.data.type !== 'excerpt:ready') return;
    frameReady = true;
    if (queued) { post(queued); queued = null; }
  };
  window.addEventListener('message', onMsg);
  const onKey = e => { if (e.key === 'Escape' && ov && !ov.hidden) close(); };
  document.addEventListener('keydown', onKey);

  function close() { if (ov) ov.hidden = true; }
  function ensureOverlay() {
    if (ov) { ov.hidden = false; return; }
    const wait = h('div.dlx-wait', '발췌기를 불러오는 중…');
    const size = iconBtn('panel', '', () => { opt.big = !opt.big; saveOpt(); fitSize(); }, 'dlx-size');
    const fitSize = () => { ov.classList.toggle('big', !!opt.big); const t = opt.big ? '창으로 줄이기' : '화면에 꽉 채우기'; size.title = t; size.setAttribute('aria-label', t); };
    ov = h('div.dlx-ov', { onclick: e => { if (e.target === ov) close(); } },
      h('div.dlx-win',
        h('div.dlx-bar',
          h('b', '발췌기'),
          btn('지금 채팅 다시 넣기', { ic: 'import', cls: 'ghost', onclick: () => { const c = api.chat.current(); if (c.chat) send(c.chat, c.msgs, recentIds(c.msgs, opt.recent)); } }),
          size,
          iconBtn('x', '닫기 (쓰던 내용은 남아요)', close)),
        wait));
    fitSize();
    document.body.append(ov);
    loadPage().then(html => {
      pageHtml = html;
      frame = h('iframe.dlx-frame', { title: '발췌기', allow: 'clipboard-write' });
      // allow-same-origin: 발췌기가 꾸미기 값 · 쓰던 글을 브라우저에 기억하고 이미지를 복사하려면 필요하다 (내 저장소의 발췌기만 띄운다)
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms allow-modals allow-downloads');
      frame.src = new URL('/frame', location.origin).href;
      wait.replaceWith(frame);
    }).catch(e => { wait.textContent = e.message || String(e); });
  }

  function send(chat, msgs, pickIds) {
    if (!chat) { toast('채팅을 먼저 열어 주세요', 'err'); return; }
    ready.then(() => {
      const payload = build(chat, msgs, pickIds);
      if (!payload.msgs.length) { toast('보낼 메시지가 없어요', 'err'); return; }
      ensureOverlay();
      if (frame && frameReady) post(payload); else queued = payload;
    });
  }

  // ── 메시지 메뉴: 이 메시지를 골라 둔 채로 발췌기를 연다 ──
  api.messageAction({
    id: 'dl-excerpt-send', label: '발췌기로 보내기', icon: 'image',
    run: (msg, chat) => { const cur = api.chat.current(); send(chat || cur.chat, cur.msgs, new Set([msg.id])); },
  });

  // ── 장면 패널 ──
  function view(chat, msgs) {
    const set = (k, v) => { opt[k] = v; saveOpt(); };
    const chk = (k, label) => h('label.dlx-chk', h('input', { type: 'checkbox', checked: !!opt[k], onchange: e => set(k, e.target.checked) }), label);
    const sel = (k, list) => h('select.inp', { onchange: e => set(k, typeof opt[k] === 'number' ? +e.target.value : e.target.value) },
      list.map(([v, l]) => h('option', { value: String(v), selected: opt[k] === v }, l)));
    const live = () => api.chat.current().msgs || msgs;
    return [
      h('div.dlx-sec', h('b', '보낼 글'),
        sel('text', [['tr', '번역이 있으면 번역문'], ['orig', '늘 원문']]),
        chk('hidden', '숨긴 메시지도 보내기'),
        chk('system', '시스템 메시지도 보내기')),
      h('div.dlx-sec', h('b', '미리 골라 두기'),
        sel('recent', [[0, '고르지 않음 (발췌기에서 고르기)'], [10, '최근 10개'], [20, '최근 20개'], [50, '최근 50개']]),
        h('div.dlx-hint', '발췌기의 메시지 고르기 창에 미리 체크해 둬요. 거기서 더 고르거나 뺄 수 있어요. 메시지 하나만 보내려면 그 메시지 메뉴의 ‘발췌기로 보내기’를 누르세요.')),
      h('div.dlx-tools',
        btn('발췌기 열기', { ic: 'image', onclick: () => send(chat, live(), recentIds(live(), opt.recent)) }),
        btn('보내지 않고 열기', { ic: 'image', cls: 'ghost', onclick: () => ensureOverlay() })),
      h('div.dlx-hint', '발췌기는 드림랜드 화면 안에서 열려요. 닫아도 쓰던 내용은 남아 있다가 다시 열면 이어져요.'),
    ];
  }

  api.panel({
    title: '발췌기', icon: 'image',
    render: (chat, msgs) => {
      const root = h('div.dlx');
      if (!chat) return root;
      ready.then(() => root.replaceChildren(...view(chat, msgs)));
      return root;
    },
  });

  api.command('excerpt', {
    help: '발췌기 열기. /excerpt 20 처럼 쓰면 최근 20개를 골라 둔 채로 엽니다',
    run: arg => { const cur = api.chat.current(); send(cur.chat, cur.msgs, recentIds(cur.msgs, parseInt(arg, 10) || opt.recent)); },
  });

  return () => {
    window.removeEventListener('message', onMsg);
    document.removeEventListener('keydown', onKey);
    if (ov) ov.remove();
    ov = frame = null;
  };
}
