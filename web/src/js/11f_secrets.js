/* ============================================================
   Contraseñas guardadas en la configuración (servidor de marca de tiempo)
   Nunca se guardan en texto claro:
   - Windows: DPAPI, ligadas a la cuenta de Windows («dpapi:…»).
   - Android: clave AES-GCM del Android Keystore, que no sale del teléfono («ks:…»).
   - Navegador: clave AES-GCM no exportable guardada en IndexedDB («wc:…»). No protege
     frente a quien controle el navegador, pero la contraseña no queda legible en el
     almacenamiento ni en copias de la configuración.
   ============================================================ */
let _webSecretKey = null;
function webSecretKey() {
  if (_webSecretKey) return _webSecretKey;
  return (_webSecretKey = new Promise((res, rej) => {
    if (!window.indexedDB || !crypto.subtle) return rej(new Error('Este navegador no puede guardar contraseñas cifradas.'));
    const op = indexedDB.open('rubrica-secrets', 1);
    op.onupgradeneeded = () => op.result.createObjectStore('keys');
    op.onerror = () => rej(op.error);
    op.onsuccess = () => {
      const db = op.result, get = db.transaction('keys').objectStore('keys').get('k1');
      get.onerror = () => rej(get.error);
      get.onsuccess = async () => {
        if (get.result) return res(get.result);
        try {
          const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
          const tx = db.transaction('keys', 'readwrite'); tx.objectStore('keys').put(k, 'k1');
          tx.oncomplete = () => res(k); tx.onerror = () => rej(tx.error);
        } catch (e) { rej(e); }
      };
    };
  }).catch(e => { _webSecretKey = null; throw e; }));
}

/** Cifra un texto para guardarlo en la configuración. Devuelve '' si el texto está vacío. */
async function secretSeal(text) {
  if (!text) return '';
  if (NATIVE) return 'dpapi:' + (await natPost('secret-protect', { text })).v;
  if (PSN) return 'ks:' + (await PSN.secretProtect({ text })).v;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await webSecretKey(), new TextEncoder().encode(text)));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return 'wc:' + u8ToB64(out);
}

/** Descifra un valor guardado con secretSeal. Lanza un error claro si no corresponde a este equipo o cuenta. */
async function secretOpen(v) {
  if (!v) return '';
  const i = v.indexOf(':'), kind = v.slice(0, i), data = v.slice(i + 1);
  const other = tr('La contraseña guardada no se puede leer aquí (se guardó en otro equipo o programa). Escríbala de nuevo en Preferencias de firma.');
  if (kind === 'dpapi') { if (!NATIVE) throw new Error(other); return (await natPost('secret-unprotect', { v: data })).text; }
  if (kind === 'ks') { if (!PSN) throw new Error(other); return (await PSN.secretUnprotect({ v: data })).text; }
  if (kind === 'wc') {
    if (NATIVE || PSN) throw new Error(other);
    try { const b = b64ToU8(data); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, await webSecretKey(), b.slice(12))); }
    catch { throw new Error(other); }
  }
  throw new Error(other);
}

/** Contraseña de un servidor de marca de tiempo (las versiones anteriores la guardaban en texto claro). */
async function tsaPassword(server) {
  return server.passEnc ? secretOpen(server.passEnc) : (server.pass || '');
}

/** Al arrancar: cifra las contraseñas que versiones anteriores dejaron en texto claro. */
async function migrateSecrets() {
  const list = S.settings.tsaServers || [];
  if (!list.some(t => t.pass)) return;
  try {
    for (const t of list) if (t.pass) { t.passEnc = await secretSeal(t.pass); delete t.pass; }
    saveSettings();
  } catch (e) { console.warn('No se pudieron cifrar las contraseñas guardadas', e); }
}
