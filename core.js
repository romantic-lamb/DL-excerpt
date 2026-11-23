// 발췌기 연결 (DreamLand → 발췌기) — 본체
// 드림랜드에는 DL-excerpt.js(껍데기)를 설치합니다. 껍데기가 켜질 때마다 이 파일을 받아 실행합니다.
//
// 드림랜드에서 보고 있는 채팅을 발췌기(https://romantic-lamb.github.io/excerptourstory/)로 바로 보냅니다.
// 발췌기에서는 ‘채팅 파일에서 가져오기’와 같은 메시지 고르기 창이 열리고, 고른 메시지를 칸으로 가져옵니다.
//
// 보내는 길은 둘이고, 둘 다 서버를 거치지 않습니다.
//   · 짧으면 압축해서 주소의 # 뒤에 담습니다 (# 뒤는 서버로 가지 않습니다)
//   · 길면 발췌기 창을 열어 두고, 발췌기가 준비됐다고 알려 오면 그 창에만 postMessage 로 건넵니다

export const manifest = {
  id: 'dl-excerpt',
  name: '발췌기 연결',
  version: '0.1.0',
  author: 'romantic-lamb',
  description: '보고 있는 채팅을 발췌기로 보내 이미지 · PDF · HTML 발췌본으로 만듭니다. 메시지 메뉴의 ‘발췌기로 보내기’나 장면 패널에서 씁니다.',
};

const SITE = 'https://romantic-lamb.github.io/excerptourstory/';
const ORIGIN = new URL(SITE).origin;
const HASH_MAX = 60000;     // 주소에 담을 최대 길이. 넘으면 postMessage 로 건넨다
const WAIT_MS = 30000;      // 발췌기 창이 준비됐다고 알려 오기를 기다리는 시간

const isApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

export function activate(api) {
  const { h, btn, toast } = api;

  // ── 설정: 본문(번역/원문) · 숨긴 메시지 · 시스템 메시지 · 미리 골라 둘 최근 메시지 수 ──
  let opt = { text: 'tr', hidden: false, system: false, recent: 0 };
  const ready = api.store.get('opt', null).then(v => { if (v && typeof v === 'object') opt = { ...opt, ...v }; });
  const saveOpt = () => api.store.set('opt', opt);

  const swipeOf = m => (m.swipes && (m.swipes[m.sw] || m.swipes[0])) || {};
  function bodyOf(m) {
    const s = swipeOf(m);
    const tr = typeof s.tr === 'string' ? s.tr.trim() : '';
    return opt.text === 'tr' && tr ? s.tr : String(s.text || '');
  }

  // 발췌기가 읽는 SillyTavern 채팅 모양({ name, is_user, mes, send_date })으로 바꾼다
  function build(chat, msgs, pickIds) {
    const out = [], pick = [];
    for (const m of msgs || []) {
      if (!m) continue;
      if (m.role === 'system' && !opt.system) continue;
      if (m.hidden && !opt.hidden) continue;
      const mes = bodyOf(m);
      if (!mes.trim()) continue;
      if (pickIds && pickIds.has(m.id)) pick.push(out.length);
      out.push({ name: m.name || (m.role === 'user' ? 'User' : 'Character'), is_user: m.role === 'user', mes, send_date: m.ts || null });
    }
    const title = (api.chat.roomName && chat ? api.chat.roomName(chat) : '') || (chat && chat.name) || '';
    return { v: 1, title, msgs: out, pick };
  }

  async function pack(obj) {
    if (typeof CompressionStream !== 'function') return null;
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // 발췌기 창이 "준비됐어요"라고 하면 그 창에만 채팅을 건넨다
  let pending = null;
  function handoff(win, payload) {
    if (pending) pending.stop();
    const onMsg = e => {
      if (e.origin !== ORIGIN || e.source !== win || !e.data || e.data.type !== 'excerpt:ready') return;
      win.postMessage({ type: 'excerpt:chat', payload }, ORIGIN);
      stop();
    };
    const timer = setTimeout(() => stop(), WAIT_MS);
    const stop = () => { window.removeEventListener('message', onMsg); clearTimeout(timer); if (pending && pending.stop === stop) pending = null; };
    window.addEventListener('message', onMsg);
    pending = { stop };
  }

  // 창은 누른 순간에 바로 열어야 팝업 차단에 걸리지 않는다. 그래서 먼저 빈 창을 열고, 보낼 준비가 되면 주소를 넣는다
  function send(chat, msgs, pickIds) {
    if (!chat) { toast('채팅을 먼저 열어 주세요', 'err'); return; }
    const app = isApp();
    const win = app ? null : window.open('about:blank', '_blank');
    (async () => {
      await ready;
      const payload = build(chat, msgs, pickIds);
      if (!payload.msgs.length) { if (win) win.close(); toast('보낼 메시지가 없어요', 'err'); return; }
      let code = null;
      try { code = await pack(payload); } catch (e) { console.warn('[발췌기 연결] 압축하지 못했어요', e); }
      const short = code && code.length <= HASH_MAX;
      if (short) {
        const url = SITE + '#dl=' + code;
        if (win) win.location.href = url;
        else if (!window.open(url, '_blank')) { toast('발췌기 창을 열지 못했어요. 팝업 차단을 풀거나 ‘파일로 내려받기’를 써 주세요', 'err'); return; }
      } else {
        // 길어서 주소에 담을 수 없으면, 드림랜드가 연 창에 직접 건넨다 (앱에서는 창을 직접 열 수 없다)
        if (!win) { toast('채팅이 길어서 바로 보낼 수 없어요. ‘파일로 내려받기’로 받은 뒤 발췌기의 ‘채팅 파일에서 가져오기’로 열어 주세요', 'err'); return; }
        handoff(win, payload);
        win.location.href = SITE + '#dl=wait';
      }
      toast(`메시지 ${payload.msgs.length}개를 발췌기로 보냈어요${payload.pick.length ? ` (${payload.pick.length}개 골라 둠)` : ''}`, 'ok');
    })().catch(e => { if (win) win.close(); toast('발췌기로 보내지 못했어요: ' + (e && e.message || e), 'err'); });
  }

  async function saveFile(chat, msgs) {
    await ready;
    const payload = build(chat, msgs);
    if (!payload.msgs.length) { toast('내려받을 메시지가 없어요', 'err'); return; }
    const text = payload.msgs.map(m => JSON.stringify(m)).join('\n') + '\n';
    const name = (payload.title || 'dreamland-chat').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) + '.jsonl';
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/jsonl' })), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`${name} 을(를) 내려받았어요. 발췌기의 ‘채팅 파일에서 가져오기’로 열어 주세요`, 'ok');
  }

  const recentIds = (msgs, n) => new Set(n > 0 ? (msgs || []).filter(m => m && !(m.role === 'system' && !opt.system) && !(m.hidden && !opt.hidden)).slice(-n).map(m => m.id) : []);

  // ── 메시지 메뉴: 이 메시지를 골라 둔 채로 발췌기를 연다 ──
  api.messageAction({
    id: 'dl-excerpt-send', label: '발췌기로 보내기', icon: 'image',
    run: (msg, chat) => { const cur = api.chat.current(); send(chat || cur.chat, cur.msgs, new Set([msg.id])); },
  });

  // ── 장면 패널 ──
  api.style(`
    .dlx { display: flex; flex-direction: column; gap: 12px; }
    .dlx-sec { display: flex; flex-direction: column; gap: 6px; }
    .dlx-sec > b { font-size: .86em; color: var(--dim); }
    .dlx-hint { font-size: .8em; color: var(--faint); line-height: 1.5; }
    .dlx-chk { display: flex; gap: 8px; align-items: center; font-size: .9em; cursor: pointer; }
    .dlx-tools { display: flex; flex-wrap: wrap; gap: 6px; }
  `);

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
        h('div.dlx-hint', '발췌기의 메시지 고르기 창에 미리 체크해 둬요. 발췌기에서 더 고르거나 뺄 수 있어요. 메시지 하나만 보내려면 그 메시지 메뉴의 ‘발췌기로 보내기’를 누르세요.')),
      h('div.dlx-tools',
        btn('발췌기 열기', { ic: 'image', onclick: () => send(chat, live(), recentIds(live(), opt.recent)) }),
        btn('파일로 내려받기', { ic: 'import', cls: 'ghost', onclick: () => saveFile(chat, live()) })),
      h('div.dlx-hint', '채팅은 서버를 거치지 않고 이 기기의 브라우저 안에서만 건너가요. 발췌기 창이 열리지 않으면 ‘파일로 내려받기’로 받은 .jsonl 파일을 발췌기의 ‘채팅 파일에서 가져오기’로 여세요.'),
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

  return () => { if (pending) pending.stop(); };
}
