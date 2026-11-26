/* ============================================================
   07k · Leer en voz alta
   Lee el documento oración por oración desde la página actual (o
   solo el texto seleccionado), resalta lo que se está leyendo y
   avanza de página. Usa las voces del sistema (sin internet en
   Windows); en Android, el motor de voz del teléfono.
   ============================================================ */
const TTS = { on: false, paused: false, queue: [], i: 0, rate: 1, voice: null, bar: null, token: 0 };

const ttsNativeAndroid = () => !!(PSN && PSN.ttsSpeak);
function ttsAvailable() { return ttsNativeAndroid() || ('speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function'); }
function ttsVoices() {
  if (!('speechSynthesis' in window)) return [];
  const want = (LANG || 'es').slice(0, 2);
  const all = speechSynthesis.getVoices();
  return [...all.filter(v => v.lang.toLowerCase().startsWith(want)), ...all.filter(v => !v.lang.toLowerCase().startsWith(want))];
}

/** Oraciones de una página con las palabras que las forman (para resaltarlas). */
const TTS_ABBR = /^(Sr|Sra|Dr|Lic|Ing|No|Art|pág|etc|S\.A|Ud|Uds)\.$/i;
/** Corta una lista de palabras en oraciones (sin cortar en «No.», «Lic.», «S.A.»…). */
function sentencesFromWords(words, pi) {
  const out = []; let cur = [];
  const push = () => { if (cur.length) out.push({ page: pi, words: cur.some(w => w.w) ? cur : [], text: cur.map(w => w.t).join(' ').replace(/-\s(?=[a-záéíóúñü])/g, '') }); cur = []; };
  for (let k = 0; k < words.length; k++) {
    const w = words[k], prev = words[k - 1];
    if (w.br || prev && prev.w && (w.y - prev.y > prev.h * 2.2 || w.y < prev.y - prev.h)) push(); // salto de párrafo o de columna
    cur.push(w);
    if (/[.!?;:]["»”)]*$/.test(w.t) && !TTS_ABBR.test(w.t) || cur.length >= 40) push();
  }
  push();
  return out;
}

/** Oraciones de una página con las palabras que las forman (para resaltarlas). */
async function pageSentences(d, pi) {
  const out = sentencesFromWords(await pageWords(d, d.pages[pi], pi), pi);
  if (out.length) return out;
  // página girada o texto vertical: no hay posiciones para resaltar, pero se lee igual
  const p = d.pages[pi], src = d.sources[p.src];
  if (!src || src.kind !== 'pdf') return out;
  const tc = await getTextContent(src, p.idx), words = [];
  let br = false;
  for (const it of tc.items) {
    for (const m of (it.str || '').matchAll(/\S+/g)) { words.push({ t: m[0], br }); br = false; }
    if (it.hasEOL && !(it.str || '').trim()) br = true; // línea vacía: párrafo nuevo
  }
  return sentencesFromWords(words, pi);
}

function ttsHighlight(sent) {
  $$('.tts-hl').forEach(e => e.remove());
  if (!sent) return;
  const d = D(), p = d.pages[sent.page], parts = R.els.get(p.id); if (!parts) return;
  const s = d.scale;
  for (const r of wordRects(sent.words)) parts.pe.append(el('div', { class: 'tts-hl', style: { left: (r.x - 1) * s + 'px', top: r.y * s + 'px', width: (r.w + 2) * s + 'px', height: r.h * s + 'px' } }));
}

async function ttsSpeakOne(text, token) {
  if (ttsNativeAndroid()) { await PSN.ttsSpeak({ text, rate: TTS.rate, lang: (LOC && LOC()) || 'es-HN' }); return; }
  await new Promise(res => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = TTS.rate; u.lang = LOC();
    if (TTS.voice) try { u.voice = TTS.voice; u.lang = TTS.voice.lang; } catch { }
    u.onend = u.onerror = () => res();
    speechSynthesis.speak(u);
    // Chrome corta las lecturas largas si no se le «despierta» de vez en cuando
    const keep = setInterval(() => { if (token !== TTS.token || !speechSynthesis.speaking) return clearInterval(keep); if (!TTS.paused) { speechSynthesis.pause(); speechSynthesis.resume(); } }, 10000);
  });
}

async function ttsRun() {
  const token = ++TTS.token, d = D();
  while (TTS.on && token === TTS.token) {
    if (TTS.i >= TTS.queue.length) {
      // siguiente página con texto
      const last = TTS.queue.at(-1), next = last ? last.page + 1 : -1;
      if (TTS.selection || next < 0 || next >= d.pages.length) break;
      const more = await pageSentences(d, next);
      TTS.queue.push(...(more.length ? more : [{ page: next, words: [], text: '' }]));
      continue;
    }
    const sent = TTS.queue[TTS.i];
    if (!sent.text) { TTS.i++; continue; }
    if (sent.page !== D().cur) goToPage(sent.page, false);
    ttsHighlight(sent); ttsUpdateBar();
    await ttsSpeakOne(sent.text, token);
    if (token !== TTS.token) return;
    while (TTS.paused && TTS.on && token === TTS.token) await sleep(150);
    TTS.i++;
  }
  if (token === TTS.token) ttsStop(TTS.on && !TTS.selection ? tr('Fin del documento.') : null);
}

async function readAloud() {
  const d = D(); if (!d) return;
  if (TTS.on) { ttsTogglePause(); return; }
  if (!ttsAvailable()) { toast(tr('Este equipo no tiene voces para leer en voz alta.'), 'err', 6000); return; }
  if (!ttsNativeAndroid() && !speechSynthesis.getVoices().length) await new Promise(r => { speechSynthesis.onvoiceschanged = r; setTimeout(r, 1500); });
  TTS.rate = S.settings.ttsRate || 1;
  const vs = ttsVoices(); TTS.voice = vs.find(v => v.name === S.settings.ttsVoice) || vs[0] || null;
  // texto seleccionado en la página: se lee solo eso
  const selTxt = String(window.getSelection && window.getSelection()).replace(/\s+/g, ' ').trim();
  TTS.selection = selTxt.length > 2;
  TTS.queue = TTS.selection ? sentencesFromWords(selTxt.split(' ').map(t => ({ t })), D().cur) : await pageSentences(d, D().cur);
  if (!TTS.selection && !TTS.queue.length) {
    // página sin texto (escaneo): se avisa y se sigue con la siguiente que tenga texto
    toast(tr('Esta página no tiene texto. Si es un escaneo, aplique OCR para poder leerla.'), '', 5000);
  }
  TTS.i = 0; TTS.on = true; TTS.paused = false;
  ttsShowBar();
  ttsRun();
}
function ttsTogglePause() {
  if (!TTS.on) return;
  TTS.paused = !TTS.paused;
  if (ttsNativeAndroid()) { if (TTS.paused) PSN.ttsStop(); else { TTS.token++; ttsRun(); } }
  else if (TTS.paused) speechSynthesis.pause(); else speechSynthesis.resume();
  ttsUpdateBar();
}
function ttsSkip(n) {
  if (!TTS.on) return;
  TTS.i = clamp(TTS.i + n, 0, Math.max(0, TTS.queue.length - 1)); TTS.paused = false;
  if (ttsNativeAndroid()) PSN.ttsStop(); else speechSynthesis.cancel();
  TTS.token++; setTimeout(ttsRun, 60);
}
function ttsStop(msg) {
  TTS.on = false; TTS.paused = false; TTS.token++;
  if (ttsNativeAndroid()) PSN.ttsStop().catch(() => { }); else if ('speechSynthesis' in window) speechSynthesis.cancel();
  ttsHighlight(null); TTS.bar && TTS.bar.remove(); TTS.bar = null;
  if (msg) toast(msg, '', 3000);
}
function ttsShowBar() {
  TTS.bar && TTS.bar.remove();
  const btn = (icon, label, fn) => el('button', { class: 'icon-btn', html: ic(icon), title: label, 'aria-label': label, onclick: fn });
  const speed = el('select', { 'aria-label': 'Velocidad' });
  for (const r of [0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2]) speed.append(el('option', { value: r, text: r.toLocaleString(LOC()) + '×' }));
  speed.value = String(TTS.rate);
  speed.onchange = () => { TTS.rate = +speed.value; S.settings.ttsRate = TTS.rate; saveSettings(); ttsSkip(0); };
  const kids = [btn('skip-back', 'Oración anterior', () => ttsSkip(-1)), el('button', { class: 'icon-btn tts-play', 'aria-label': 'Pausa', onclick: ttsTogglePause }), btn('skip-forward', 'Oración siguiente', () => ttsSkip(1)), speed];
  if (!ttsNativeAndroid()) {
    const voice = el('select', { 'aria-label': 'Voz', style: { maxWidth: '170px' } });
    for (const v of ttsVoices()) voice.append(el('option', { value: v.name, text: `${v.name.replace(/^Microsoft |Google /, '')} (${v.lang})` }));
    if (TTS.voice) voice.value = TTS.voice.name;
    voice.onchange = () => { TTS.voice = ttsVoices().find(v => v.name === voice.value) || null; S.settings.ttsVoice = voice.value; saveSettings(); ttsSkip(0); };
    kids.push(voice);
  }
  kids.push(el('span', { class: 'tts-pos' }), btn('square', 'Detener', () => ttsStop()));
  TTS.bar = el('div', { class: 'tts-bar', role: 'region', 'aria-label': 'Leer en voz alta' }, icEl('volume-2'), ...kids);
  document.body.append(TTS.bar);
  ttsUpdateBar();
}
function ttsUpdateBar() {
  if (!TTS.bar) return;
  const pb = TTS.bar.querySelector('.tts-play'); pb.innerHTML = ic(TTS.paused ? 'play' : 'pause');
  const lab = tr(TTS.paused ? 'Continuar' : 'Pausa'); pb.title = lab; pb.setAttribute('aria-label', lab);
  const s = TTS.queue[TTS.i]; TTS.bar.querySelector('.tts-pos').textContent = s ? tr(`Página ${s.page + 1}`) : '';
}
