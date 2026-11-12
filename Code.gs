/**
 * RAIS Weekly Check-In — backend Google Apps Script
 * Google Sheet = database. Satu Sheet untuk satu kohort.
 *
 * PEMASANGAN (±10 minit)
 * 1. Cipta Google Sheet baharu, cth "RAIS Check-In DB".
 * 2. Extensions > Apps Script. Padam kod sedia ada dalam Code.gs, tampal fail ini.
 * 3. Klik (+) di sebelah Files > HTML. Namakan tepat "Index". Tampal kandungan Index.html.
 * 4. Pilih fungsi "setup" di bar atas > Run. Benarkan akses bila diminta.
 *    Admin awal ditetapkan dalam ADMIN_AWAL di bawah. Jika kataLaluan dibiarkan kosong,
 *    setup jana kata laluan rawak dan paparkannya dalam Execution log.
 *    Kata laluan awal wajib ditukar semasa log masuk pertama.
 * 5. Deploy > New deployment > jenis "Web app".
 *    Execute as: Me.  Who has access: Anyone.  > Deploy. Salin URL web app.
 * 6. Buka URL itu, log masuk sebagai admin, tukar kata laluan,
 *    tetapkan tarikh mula program (tab Akaun), kemudian daftar peserta (tab Pengguna).
 *
 * KEMAS KINI KOD: Deploy > Manage deployments > Edit (ikon pensel) > Version: New version > Deploy.
 * Jika admin terlupa kata laluan: dalam Sheet, menu RAIS > Jana kata laluan sementara
 * (pilih baris admin dalam tab Users dahulu).
 */

var TZ = 'Asia/Kuala_Lumpur';
var T = { USERS: 'Users', HARIAN: 'LogHarian', MINGGUAN: 'Mingguan', SESI: 'Sesi', CONFIG: 'Config' };
var SUM_KEYS = ['hariDilog', 'solatDirekod', 'jemaah', 'awal', 'lewat', 'tinggal', 'tahajud', 'tahapSolat',
  'quranMin', 'solatMin', 'infaq', 'hariBaseline', 'oneToOne',
  'L_perkataan', 'L_solat', 'L_1to1', 'L_giving', 'L_wakafKeluarga', 'L_wakafKhairi', 'refleksiDiisi'];
var HEAD = {};
HEAD[T.USERS] = ['id', 'emel', 'nama', 'kumpulan', 'peranan', 'aktif', 'salt', 'hash', 'tukarKataLaluan', 'dicipta', 'logMasukTerakhir'];
HEAD[T.HARIAN] = ['kunci', 'userId', 'tarikh', 'minggu', 'data', 'dikemaskini'];
HEAD[T.MINGGUAN] = ['kunci', 'userId', 'minggu'].concat(SUM_KEYS, ['data', 'dikemaskini']);
HEAD[T.SESI] = ['token', 'userId', 'tamat'];
HEAD[T.CONFIG] = ['kunci', 'nilai'];
var SESI_HARI = 30;
var ITER = 200;
/** Akaun admin yang dicipta oleh setup. Kata laluan ini sementara sahaja: sistem paksa tukar semasa log masuk pertama. */
var ADMIN_AWAL = { emel: 'admin@qlf.com', kataLaluan: '', nama: 'Admin QLF' }; // jangan commit kata laluan sebenar

/* ================= Web app ================= */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('RAIS Weekly Check-In')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('RAIS')
    .addItem('Sediakan sistem (setup)', 'setup')
    .addItem('Jana kata laluan sementara (baris dipilih dalam Users)', 'resetBarisDipilih')
    .addToUi();
}

/* ================= Setup (jalankan sekali dari editor) ================= */
function setup() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(HEAD).forEach(function (n) {
    var s = ss.getSheetByName(n) || ss.insertSheet(n);
    if (s.getLastRow() === 0) {
      s.getRange(1, 1, 1, HEAD[n].length).setValues([HEAD[n]]).setFontWeight('bold');
      s.setFrozenRows(1);
    }
  });
  ['Sheet1', 'Helaian1'].forEach(function (nm) {
    var d = ss.getSheetByName(nm);
    if (d && d.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(d);
  });
  var c = cfg_();
  if (!c.tarikhMula) setCfg_('tarikhMula', isnin_(new Date()));
  if (!c.namaProgram) setCfg_('namaProgram', 'RAIS Weekly Check-In');

  var msg;
  var emel = String(ADMIN_AWAL.emel).trim().toLowerCase();
  var ada = rows_(T.USERS).some(function (u) { return u.emel === emel; });
  if (!ada) {
    var pw = String(ADMIN_AWAL.kataLaluan || '') || tempPw_();
    appendRows_(T.USERS, [userRow_({ emel: emel, nama: ADMIN_AWAL.nama, kumpulan: '', peranan: 'admin' }, pw)]);
    msg = 'Admin dicipta.\nEmel: ' + emel + '\nKata laluan sementara: ' + pw +
      '\nAnda akan diminta menukarnya semasa log masuk pertama.';
  } else {
    msg = 'Sistem sudah disediakan. Akaun ' + emel + ' sudah wujud dan kata laluannya tidak diubah.';
  }
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* dijalankan dari editor tanpa UI Sheet */ }
}

/** Menu Sheet: jana kata laluan sementara untuk baris yang dipilih dalam tab Users. */
function resetBarisDipilih() {
  var ui = SpreadsheetApp.getUi(); // gagal di luar UI Sheet, jadi tidak boleh dipanggil dari web app
  var s = SpreadsheetApp.getActiveSheet();
  if (s.getName() !== T.USERS) { ui.alert('Pilih satu baris dalam tab Users dahulu.'); return; }
  var row = s.getActiveRange().getRow();
  var u = rows_(T.USERS).filter(function (x) { return x._row === row; })[0];
  if (!u) { ui.alert('Pilih baris pengguna (bukan baris tajuk).'); return; }
  var pw = tempPw_(), salt = 's' + rnd_();
  setCols_(T.USERS, row, { salt: salt, hash: 'h' + hash_(pw, salt), tukarKataLaluan: true, aktif: true });
  killSessions_(u.id);
  ui.alert('Kata laluan sementara untuk ' + u.emel + ':\n\n' + pw);
}

/* ================= Auth ================= */
function login(emel, pw) {
  emel = String(emel || '').trim().toLowerCase();
  pw = String(pw || '');
  var cache = CacheService.getScriptCache(), fk = 'f:' + emel;
  var fails = Number(cache.get(fk) || 0);
  if (fails >= 5) throw new Error('Terlalu banyak cubaan. Cuba lagi selepas 10 minit.');
  var u = rows_(T.USERS).filter(function (x) { return x.emel === emel; })[0];
  if (!u || !aktif_(u) || ('h' + hash_(pw, u.salt)) !== u.hash) {
    cache.put(fk, String(fails + 1), 600);
    throw new Error('Emel atau kata laluan salah.');
  }
  cache.remove(fk);
  var tok = newSession_(u.id);
  setCols_(T.USERS, u._row, { logMasukTerakhir: new Date() });
  if (Math.random() < 0.1) pruneSessions_();
  return bootstrap_(u, tok);
}

function resume(tok) {
  var u = auth_(tok);
  return bootstrap_(u, tok);
}

function logout(tok) {
  try {
    var s = sh_(T.SESI);
    var f = s.getRange('A:A').createTextFinder(String(tok)).matchEntireCell(true).findNext();
    if (f) s.deleteRow(f.getRow());
    CacheService.getScriptCache().remove('k:' + tok);
  } catch (e) { }
  return { ok: true };
}

function changePassword(tok, lama, baru) {
  var u = auth_(tok);
  if (('h' + hash_(String(lama || ''), u.salt)) !== u.hash) throw new Error('Kata laluan semasa tidak betul.');
  baru = String(baru || '');
  if (baru.length < 8) throw new Error('Kata laluan baharu mesti sekurang-kurangnya 8 aksara.');
  if (baru.length > 100) throw new Error('Kata laluan terlalu panjang.');
  var salt = 's' + rnd_();
  setCols_(T.USERS, u._row, { salt: salt, hash: 'h' + hash_(baru, salt), tukarKataLaluan: false });
  return { ok: true };
}

/* ================= Data pengguna ================= */
/**
 * Simpan perubahan. p = { days: { 'YYYY-MM-DD': {...} }, weeks: { '3': { form: {...}, sum: {...} } } }
 */
function sync(tok, p) {
  var u = auth_(tok);
  p = p || {};
  var days = p.days || {}, weeks = p.weeks || {};
  var dk = Object.keys(days), wk = Object.keys(weeks);
  if (dk.length > 120 || wk.length > 13) throw new Error('Terlalu banyak data dalam satu simpanan.');
  var start = cfg_().tarikhMula, now = new Date();
  var dRows = dk.map(function (d) {
    if (!/^\d{4}-\d\d-\d\d$/.test(d)) throw new Error('Tarikh tidak sah: ' + d);
    var js = JSON.stringify(days[d] || {});
    if (js.length > 20000) throw new Error('Data hari ' + d + ' terlalu besar.');
    return [u.id + '|' + d, u.id, d, mingguOf_(d, start), js, now];
  });
  var wRows = wk.map(function (w) {
    var n = Number(w);
    if (!(n >= 1 && n <= 13)) throw new Error('Minggu tidak sah: ' + w);
    var x = weeks[w] || {}, s = x.sum || {};
    var js = JSON.stringify(x.form || {});
    if (js.length > 30000) throw new Error('Data minggu ' + n + ' terlalu besar.');
    return [u.id + '|w' + n, u.id, n].concat(SUM_KEYS.map(function (k) { return cleanSum_(k, s[k]); }), [js, now]);
  });
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (dRows.length) upsert_(T.HARIAN, dRows);
    if (wRows.length) upsert_(T.MINGGUAN, wRows);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, masa: now.toISOString() };
}

/* ================= Admin ================= */
function adminDashboard(tok) {
  admin_(tok);
  var weeks = rows_(T.MINGGUAN).map(function (r) {
    var o = { userId: String(r.userId), minggu: Number(r.minggu), dikemaskini: r.dikemaskini };
    SUM_KEYS.forEach(function (k) { o[k] = r[k]; });
    return o;
  });
  var c = cfg_();
  return {
    users: rows_(T.USERS).map(pubAdmin_),
    weeks: weeks,
    config: { tarikhMula: c.tarikhMula, namaProgram: c.namaProgram },
    sheetUrl: SpreadsheetApp.getActive().getUrl(),
    appUrl: ScriptApp.getService().getUrl() || '',
    dijana: new Date().toISOString()
  };
}

function adminSaveUser(tok, x) {
  var me = admin_(tok);
  x = x || {};
  var emel = String(x.emel || '').trim().toLowerCase();
  var nama = String(x.nama || '').trim();
  var kumpulan = String(x.kumpulan || '').trim();
  var peranan = x.peranan === 'admin' ? 'admin' : 'pengguna';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emel)) throw new Error('Emel tidak sah.');
  if (!nama || nama.length > 80) throw new Error('Nama diperlukan (maksimum 80 aksara).');
  if (kumpulan.length > 40) throw new Error('Nama kumpulan terlalu panjang.');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var users = rows_(T.USERS);
    var clash = users.filter(function (u) { return u.emel === emel && u.id !== x.id; })[0];
    if (clash) throw new Error('Emel ini sudah didaftarkan.');
    if (x.id) {
      var u = users.filter(function (v) { return v.id === x.id; })[0];
      if (!u) throw new Error('Pengguna tidak dijumpai.');
      var aktif = x.aktif === undefined ? aktif_(u) : !!x.aktif;
      if (u.id === me.id && (peranan !== 'admin' || !aktif)) throw new Error('Anda tidak boleh membuang akses admin atau menyahaktifkan akaun sendiri.');
      setCols_(T.USERS, u._row, { emel: emel, nama: safe_(nama), kumpulan: safe_(kumpulan), peranan: peranan, aktif: aktif });
      if (!aktif) killSessions_(u.id);
      var nu = rows_(T.USERS).filter(function (v) { return v.id === x.id; })[0];
      return { user: pubAdmin_(nu) };
    }
    var pw = tempPw_();
    var row = userRow_({ emel: emel, nama: nama, kumpulan: kumpulan, peranan: peranan }, pw);
    appendRows_(T.USERS, [row]);
    var created = rows_(T.USERS).filter(function (v) { return v.id === row[0]; })[0];
    return { user: pubAdmin_(created), kataLaluan: pw };
  } finally {
    lock.releaseLock();
  }
}

function adminResetPassword(tok, id) {
  var me = admin_(tok);
  if (id === me.id) throw new Error('Untuk akaun sendiri, guna Tukar kata laluan di tab Akaun.');
  var u = userById_(id);
  if (!u) throw new Error('Pengguna tidak dijumpai.');
  var pw = tempPw_(), salt = 's' + rnd_();
  setCols_(T.USERS, u._row, { salt: salt, hash: 'h' + hash_(pw, salt), tukarKataLaluan: true });
  killSessions_(u.id);
  return { emel: u.emel, nama: u.nama, kataLaluan: pw };
}

/** text: satu pengguna sebaris — "nama, emel, kumpulan" (koma atau tab). */
function adminBulkAdd(tok, text) {
  admin_(tok);
  var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  if (lines.length > 300) throw new Error('Maksimum 300 baris dalam satu masa.');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var seen = {};
    rows_(T.USERS).forEach(function (u) { seen[u.emel] = 1; });
    var out = [], add = [];
    lines.forEach(function (l, i) {
      var p = l.split(/\t|,/).map(function (s) { return s.trim(); });
      var nama = p[0] || '', emel = (p[1] || '').toLowerCase(), kumpulan = p[2] || '';
      if (i === 0 && /emel|email/i.test(l)) return; // baris tajuk
      var r = { baris: i + 1, nama: nama, emel: emel, kumpulan: kumpulan };
      if (!nama || nama.length > 80) r.ralat = 'Nama kosong atau terlalu panjang';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emel)) r.ralat = 'Emel tidak sah';
      else if (seen[emel]) r.ralat = 'Emel sudah didaftarkan';
      if (!r.ralat) {
        seen[emel] = 1;
        r.kataLaluan = tempPw_();
        add.push(userRow_({ emel: emel, nama: nama, kumpulan: kumpulan, peranan: 'pengguna' }, r.kataLaluan));
      }
      out.push(r);
    });
    if (add.length) appendRows_(T.USERS, add);
    return { hasil: out, users: rows_(T.USERS).map(pubAdmin_) };
  } finally {
    lock.releaseLock();
  }
}

function adminSetConfig(tok, x) {
  admin_(tok);
  x = x || {};
  if (x.tarikhMula !== undefined) {
    if (!/^\d{4}-\d\d-\d\d$/.test(String(x.tarikhMula))) throw new Error('Tarikh mula tidak sah.');
    setCfg_('tarikhMula', String(x.tarikhMula));
  }
  if (x.namaProgram !== undefined) {
    var n = String(x.namaProgram).trim();
    if (!n || n.length > 80) throw new Error('Nama program diperlukan (maksimum 80 aksara).');
    setCfg_('namaProgram', safe_(n));
  }
  var c = cfg_();
  return { tarikhMula: c.tarikhMula, namaProgram: c.namaProgram };
}

/* ================= Dalaman ================= */
function sh_(n) {
  var s = SpreadsheetApp.getActive().getSheetByName(n);
  if (!s) throw new Error('Sistem belum disediakan. Jalankan fungsi setup dalam Apps Script.');
  return s;
}

function rows_(n) {
  var s = sh_(n), lr = s.getLastRow(), h = HEAD[n];
  if (lr < 2) return [];
  return s.getRange(2, 1, lr - 1, h.length).getValues().map(function (r, i) {
    var o = { _row: i + 2 };
    h.forEach(function (k, j) { o[k] = norm_(r[j]); });
    return o;
  });
}

function norm_(x) {
  if (x instanceof Date) return Utilities.formatDate(x, TZ, "yyyy-MM-dd'T'HH:mm:ss");
  if (typeof x === 'string' && x.charAt(0) === "'") return x.slice(1);
  return x;
}

function dateStr_(x) {
  if (x instanceof Date) return Utilities.formatDate(x, TZ, 'yyyy-MM-dd');
  return String(x).slice(0, 10);
}

function ensureRows_(s, need) {
  var max = s.getMaxRows();
  if (need > max) s.insertRowsAfter(max, need - max + 200);
}

function appendRows_(n, rows) {
  var s = sh_(n), lr = s.getLastRow();
  ensureRows_(s, lr + rows.length);
  s.getRange(lr + 1, 1, rows.length, HEAD[n].length).setValues(rows);
}

function upsert_(n, rows) {
  var s = sh_(n), lr = s.getLastRow(), w = HEAD[n].length, idx = {};
  if (lr > 1) s.getRange(2, 1, lr - 1, 1).getValues().forEach(function (r, i) { idx[String(r[0])] = i + 2; });
  var add = [];
  rows.forEach(function (r) {
    var at = idx[r[0]];
    if (at) s.getRange(at, 1, 1, w).setValues([r]);
    else add.push(r);
  });
  if (add.length) appendRows_(n, add);
}

function setCols_(n, row, obj) {
  var s = sh_(n);
  Object.keys(obj).forEach(function (k) {
    var j = HEAD[n].indexOf(k);
    if (j >= 0) s.getRange(row, j + 1).setValue(obj[k]);
  });
}

function cfg_() {
  var o = {};
  rows_(T.CONFIG).forEach(function (r) { o[String(r.kunci)] = r.nilai; });
  if (o.tarikhMula) o.tarikhMula = String(o.tarikhMula).slice(0, 10);
  return o;
}

function setCfg_(k, v) {
  var r = rows_(T.CONFIG).filter(function (x) { return x.kunci === k; })[0];
  if (r) setCols_(T.CONFIG, r._row, { nilai: v });
  else appendRows_(T.CONFIG, [[k, v]]);
}

function userRow_(u, pw) {
  var salt = 's' + rnd_();
  return ['u' + rnd_().slice(0, 16), u.emel, safe_(u.nama), safe_(u.kumpulan || ''), u.peranan,
    true, salt, 'h' + hash_(pw, salt), true, new Date(), ''];
}

function userById_(id) {
  return rows_(T.USERS).filter(function (u) { return u.id === id; })[0];
}

function aktif_(u) {
  return u.aktif === true || String(u.aktif).toUpperCase() === 'TRUE';
}

function bool_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function pub_(u) {
  return { id: u.id, emel: u.emel, nama: String(u.nama), kumpulan: String(u.kumpulan || ''), peranan: u.peranan, tukarKataLaluan: bool_(u.tukarKataLaluan) };
}

function pubAdmin_(u) {
  var o = pub_(u);
  o.aktif = aktif_(u);
  o.dicipta = String(u.dicipta || '');
  o.logMasukTerakhir = String(u.logMasukTerakhir || '');
  return o;
}

function bootstrap_(u, tok) {
  var c = cfg_(), days = {}, weeks = {}, sums = {};
  var hs = sh_(T.HARIAN), lr = hs.getLastRow();
  if (lr > 1) {
    hs.getRange(2, 2, lr - 1, 4).getValues().forEach(function (r) { // userId, tarikh, minggu, data
      if (String(r[0]) !== u.id) return;
      try { days[dateStr_(r[1])] = JSON.parse(r[3]); } catch (e) { }
    });
  }
  rows_(T.MINGGUAN).forEach(function (r) {
    if (String(r.userId) !== u.id) return;
    var n = Number(r.minggu), s = {};
    try { weeks[n] = JSON.parse(r.data || '{}'); } catch (e) { }
    SUM_KEYS.forEach(function (k) { s[k] = r[k]; });
    sums[n] = s;
  });
  return {
    token: tok, user: pub_(u),
    config: { tarikhMula: c.tarikhMula, namaProgram: c.namaProgram },
    data: { days: days, weeks: weeks, sums: sums }
  };
}

function admin_(tok) {
  var u = auth_(tok);
  if (u.peranan !== 'admin') throw new Error('Akses admin diperlukan.');
  return u;
}

function auth_(tok) {
  if (!tok || typeof tok !== 'string' || tok.charAt(0) !== 't') throw new Error('SESI_TAMAT');
  var c = CacheService.getScriptCache(), uid = c.get('k:' + tok);
  if (!uid) {
    var s = sh_(T.SESI);
    var f = s.getRange('A:A').createTextFinder(tok).matchEntireCell(true).findNext();
    if (!f) throw new Error('SESI_TAMAT');
    var r = s.getRange(f.getRow(), 1, 1, 3).getValues()[0];
    if (new Date(r[2]).getTime() < Date.now()) throw new Error('SESI_TAMAT');
    uid = String(r[1]);
    c.put('k:' + tok, uid, 21600);
  }
  var u = userById_(uid);
  if (!u || !aktif_(u)) throw new Error('SESI_TAMAT');
  return u;
}

function newSession_(uid) {
  var tok = 't' + rnd_() + rnd_();
  appendRows_(T.SESI, [[tok, uid, new Date(Date.now() + SESI_HARI * 864e5)]]);
  CacheService.getScriptCache().put('k:' + tok, uid, 21600);
  return tok;
}

function killSessions_(uid) {
  var s = sh_(T.SESI), c = CacheService.getScriptCache();
  rows_(T.SESI).reverse().forEach(function (r) {
    if (String(r.userId) === uid) {
      c.remove('k:' + r.token);
      s.deleteRow(r._row);
    }
  });
}

function pruneSessions_() {
  var s = sh_(T.SESI), now = Date.now(), n = 0;
  rows_(T.SESI).reverse().forEach(function (r) {
    if (n < 200 && new Date(r.tamat).getTime() < now) { s.deleteRow(r._row); n++; }
  });
}

function hash_(pw, salt) {
  var h = salt + '|' + pw;
  for (var i = 0; i < ITER; i++) {
    h = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + '|' + salt, Utilities.Charset.UTF_8));
  }
  return h;
}

function hex_(bytes) {
  return bytes.map(function (b) { var v = (b + 256) % 256; return (v < 16 ? '0' : '') + v.toString(16); }).join('');
}

function rnd_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function tempPw_() {
  var a = 'abcdefghjkmnpqrstuvwxyz23456789', b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, rnd_() + rnd_());
  var s = '';
  for (var i = 0; i < 8; i++) s += a.charAt(((b[i] + 256) % 256) % a.length);
  return s;
}

function safe_(v) {
  v = String(v == null ? '' : v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function cleanSum_(k, v) {
  if (k.indexOf('L_') === 0) return (v === 'g' || v === 'y' || v === 'r') ? v : '';
  if (k === 'tahapSolat') {
    if (v === '' || v === null || v === undefined) return '';
    var t = Number(v);
    return t >= 0 && t <= 3 ? Math.round(t) : '';
  }
  var n = Number(v);
  if (!isFinite(n) || n < 0) n = 0;
  return Math.min(1e7, Math.round(n * 100) / 100);
}

function mingguOf_(d, start) {
  if (!start) return '';
  return Math.floor((Date.parse(d) - Date.parse(start)) / (7 * 864e5)) + 1;
}

function isnin_(d) {
  var dow = Number(Utilities.formatDate(d, TZ, 'u')); // 1 = Isnin
  return Utilities.formatDate(new Date(d.getTime() - (dow - 1) * 864e5), TZ, 'yyyy-MM-dd');
}
