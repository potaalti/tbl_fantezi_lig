import { haftaSiralamasi, takimHaftaPuani, genelKlasman, haftaDurumu } from './scoring.js';

const YENILEME_MS = 60_000;
const SECIM_ANAHTARI = 'tbl-fantezi-takimim';
const veri = { ayarlar: null, kadrolar: [], index: null, haftalar: new Map() };
const icerik = document.getElementById('icerik');

// ---------- yardımcılar ----------
const kacis = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// "KİPAŞ K.B.B." -> "Kipaş K.B.B."; 3 harf ve altı kısaltmalar (MKE, OGM, TED) ve
// zaten küçük harf içeren kelimeler (iLab) olduğu gibi kalır
const baslik = s => String(s ?? '').split(' ').map(k =>
  k !== k.toLocaleUpperCase('tr') || k.replace(/\./g, '').length <= 3 ? k
    : k.toLocaleLowerCase('tr').replace(/(^|[.\-])(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase('tr'))
).join(' ');

const dakika = sn => `${Math.floor(sn / 60)}:${String(sn % 60).padStart(2, '0')}`;
const tarihSaat = iso => new Date(iso).toLocaleString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const takimLinki = (ad, n) => `#/takim/${encodeURIComponent(ad)}/${n}`;

// Seçilen takım bu cihazda saklanır; depolama kapalıysa her açılışta yeniden sorulur
let seciliTakim = null;
try { seciliTakim = localStorage.getItem(SECIM_ANAHTARI); } catch { /* depolama yok */ }
function takimSec(ad) {
  seciliTakim = ad;
  try { localStorage.setItem(SECIM_ANAHTARI, ad); } catch { /* depolama yok */ }
}

async function json(yol) {
  const r = await fetch(`${yol}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${yol} yüklenemedi (${r.status})`);
  return r.json();
}

async function haftaYukle(n, zorla = false) {
  if (!zorla && veri.haftalar.has(n)) return veri.haftalar.get(n);
  const h = await json(`data/hafta/${n}.json`);
  veri.haftalar.set(n, h);
  return h;
}

async function kadrolariYukle() {
  const { haftalar } = await json('data/kadro/index.json');
  const kadrolar = await Promise.all(haftalar.map(n => json(`data/kadro/${n}.json`)));
  veri.kadrolar = haftalar.map((n, i) => ({ hafta: n, takimlar: kadrolar[i] }));
}

async function hepsiniYukle() {
  [veri.ayarlar, veri.index, veri.rehber] = await Promise.all([
    json('data/ayarlar.json'), json('data/hafta/index.json'), json('data/oyuncular.json'), kadrolariYukle(),
  ]);
  await Promise.all(veri.index.haftalar.map(n => haftaYukle(n)));
}

const sonHafta = () => veri.index.haftalar.at(-1);
const haftaListesi = () => veri.index.haftalar.map(n => veri.haftalar.get(n));
// Fantezi ligi TBL'nin başlangıç haftasında 1. hafta olarak başlar (TBL 7. hafta = 1. hafta).
// Adreslerde ve veride TBL hafta numarası kullanılır; ekranda fantezi hafta numarası gösterilir.
const fHafta = n => n - veri.ayarlar.baslangicHaftasi + 1;
// Haftalık eşitlikte Türk oyunculara bakılır; KKTC'li oyuncular da Türk sayılır
const TURK_ULKELER = new Set(['TÜRKİYE', 'KKTC']);
const turkMu = id => TURK_ULKELER.has(veri.rehber[id]?.ulke);
const haftaSirasi = n => haftaSiralamasi(kadroBul(n), veri.haftalar.get(n), veri.ayarlar.puanTablosu, turkMu);
const klasmanHesapla = haftalar => genelKlasman(kadroBul, haftalar, veri.ayarlar.puanTablosu, turkMu);
// Bir hafta, o haftadan önce kaydedilmiş en son kadroyla puanlanır
const kadroBul = n => (veri.kadrolar.findLast(k => k.hafta <= n) ?? veri.kadrolar[0]).takimlar;
const sonKadro = () => veri.kadrolar.at(-1).takimlar;

// ---------- ortak parçalar ----------
// tbl: başlıkta TBL hafta numarası gösterilir (Maçlar sekmesi), yoksa fantezi hafta numarası
function haftaSecici(n, rota, tbl = false) {
  const h = veri.index.haftalar;
  const i = h.indexOf(n);
  const d = haftaDurumu(veri.haftalar.get(n));
  const durum = d.tamamlandi ? 'Tamamlandı' : `${d.bitti}/${d.toplam} maç bitti${d.canli ? ' · canlı' : ''}`;
  const [ust, alt] = tbl ? [`TBL ${n}. Hafta`, `Fantezi ${fHafta(n)}. hafta · ${durum}`]
    : [`${fHafta(n)}. Hafta`, `TBL ${n}. hafta · ${durum}`];
  const ok = (hedef, isaret) => hedef === undefined ? `<span class="pasif">${isaret}</span>` : `<a href="#/${rota}/${hedef}" aria-label="Hafta ${fHafta(hedef)}">${isaret}</a>`;
  return `<div class="hafta-secici">
    ${ok(h[i - 1], '‹')}
    <div class="baslik"><strong>${ust}</strong><small>${alt}</small></div>
    ${ok(h[i + 1], '›')}
  </div>`;
}

// Geçmiş haftalara hızlı geçiş düğmeleri (birden fazla hafta varsa)
function haftaCipleri(n, rota) {
  const h = veri.index.haftalar;
  if (h.length < 2) return '';
  return `<div class="secenekler hafta-cipleri">${h.map(k =>
    `<a class="secenek ${k === n ? 'aktif' : ''}" href="#/${rota}/${k}">${fHafta(k)}. hafta</a>`).join('')}</div>`;
}

const siraRozeti = sira => `<span class="sira ${sira <= 3 ? 's' + sira : ''}">${sira}</span>`;
const benimMi = ad => ad === seciliTakim ? 'benim' : '';

// ---------- ekranlar ----------
function secimEkrani() {
  const liste = [...sonKadro()].sort((a, b) => a.ad.localeCompare(b.ad, 'tr')).map(t => `
    <a class="satir ${benimMi(t.ad)}" href="#/sec/${encodeURIComponent(t.ad)}">
      <div class="ad"><strong>${kacis(t.ad)}</strong>${t.sahibi ? `<small>${kacis(t.sahibi)}</small>` : ''}</div>
      <span class="ok">›</span>
    </a>`).join('');
  return `<div class="karsilama"><strong>Takımını seç</strong><small>Seçimin bu telefonda hatırlanır, sonra değiştirebilirsin.</small></div>
    <section class="kart">${liste}</section>`;
}

function haftalikEkran(n) {
  const siralama = haftaSirasi(n);
  const satirlar = siralama.map(s => {
    // Eşit VP'de sırayı en yüksek VP'li Türk oyuncu belirler; bunu satırda göster
    const esitlik = !s.vpEsitligi ? '' : s.enIyiTurk
      ? `Eşitlik: ${s.enIyiTurk.ad} ${s.enIyiTurk.vp} VP` : 'Eşitlik: Türk oyuncu yok';
    const alt = [s.sahibi, esitlik].filter(Boolean).map(kacis).join(' · ');
    return `
    <a class="satir ${benimMi(s.ad)}" href="${takimLinki(s.ad, n)}">
      ${siraRozeti(s.sira)}
      <div class="ad"><strong>${kacis(s.ad)}</strong>${alt ? `<small>${alt}</small>` : ''}</div>
      <div class="sayi"><strong>${s.toplam}</strong><small>VP</small></div>
      <span class="cip">+${s.puan}</span>
    </a>`;
  }).join('');
  return `${haftaSecici(n, 'hafta')}${haftaCipleri(n, 'hafta')}<section class="kart"><h2>VP sıralaması · kazanılan puan</h2>${satirlar}</section>`;
}

function genelEkran() {
  const haftalar = haftaListesi();
  const klasman = klasmanHesapla(haftalar);
  // Önceki haftaya göre sıra değişimi
  const onceki = haftalar.length > 1 ? klasmanHesapla(haftalar.slice(0, -1)) : null;
  const oncekiSira = new Map(onceki?.map(s => [s.ad, s.sira]) ?? []);
  const satirlar = klasman.map(s => {
    const fark = oncekiSira.has(s.ad) ? oncekiSira.get(s.ad) - s.sira : 0;
    const degisim = fark > 0 ? `<span class="degisim yukari">▲${fark}</span>` : fark < 0 ? `<span class="degisim asagi">▼${-fark}</span>` : '';
    const son = s.haftalar.at(-1);
    return `
    <a class="satir ${benimMi(s.ad)}" href="${takimLinki(s.ad, sonHafta())}">
      ${siraRozeti(s.sira)}
      <div class="ad"><strong>${kacis(s.ad)} ${degisim}</strong><small>Son hafta ${son ? son.sira + '.' : '-'} · ${s.vp} VP</small></div>
      <div class="sayi"><strong>${s.puan}</strong><small>puan</small></div>
    </a>`;
  }).join('');
  const ilk = fHafta(haftalar[0]?.hafta), son = fHafta(haftalar.at(-1)?.hafta);
  const aralik = !haftalar.length ? '' : ilk === son ? `${ilk}. hafta` : `${ilk}–${son}. haftalar`;
  return `<div class="hafta-secici"><span></span><div class="baslik"><strong>Genel Klasman</strong><small>${aralik}</small></div><span></span></div>
    <section class="kart"><h2>Haftalık puanların toplamı</h2>${satirlar}</section>`;
}

function oyuncuSatiri(o) {
  let durum;
  if (o.eslesmedi) durum = "TBF'de bulunamadı";
  else if (o.macDurumu === 'bay') durum = 'Takımı bay';
  else if (o.macDurumu === 'oynanmadi') durum = o.mac ? tarihSaat(o.mac.tarih) : 'Maç yok';
  else if (o.saniye === 0) durum = o.macDurumu === 'canli' ? 'Henüz süre almadı' : 'Süre almadı';
  else durum = `${dakika(o.saniye)} dk`;

  let etiket = '';
  if (o.rol === 'as' && !o.sayildi) etiket = `<span class="etiket cikti">yerine ${kacis(o.yerineGiren)}</span>`;
  if (o.rol === 'yedek' && o.sayildi) etiket = `<span class="etiket girdi">${kacis(o.yerineGirdigi)} yerine</span>`;
  if (o.macDurumu === 'canli') etiket += '<span class="etiket canli-e">canlı</span>';
  const takim = o.tblTakim ? `${kacis(baslik(o.tblTakim))} · ` : '';

  const etiketAc = o.id ? `a href="#/oyuncu/${o.id}"` : 'div';
  return `<${etiketAc} class="satir oyuncu ${o.sayildi ? '' : 'sayilmadi'}">
    <div class="ad"><strong>${kacis(o.ad)}${etiket}</strong><small>${takim}${durum}</small></div>
    <div class="sayi"><strong>${o.vp}</strong><small>VP</small></div>
  </${o.id ? 'a' : 'div'}>`;
}

function takimEkrani(ad, n, kendi) {
  const takim = kadroBul(n).find(t => t.ad === ad);
  if (!takim) return '<p class="bos">Takım bulunamadı.</p>';
  const hafta = veri.haftalar.get(n);
  const sonuc = takimHaftaPuani(takim, hafta);
  const sira = haftaSirasi(n).find(s => s.ad === ad);
  const genel = klasmanHesapla(haftaListesi()).find(s => s.ad === ad);
  const rota = kendi ? 'takimim' : 'takim/' + encodeURIComponent(ad);
  const gecmis = genel.haftalar.slice().reverse().map(h => `
    <a class="satir" href="#/${rota}/${h.hafta}">
      <div class="ad"><strong>${fHafta(h.hafta)}. Hafta</strong><small>${h.vp} VP</small></div>
      <div class="sayi"><strong>${h.sira}.</strong></div>
      <span class="cip">+${h.puan}</span>
    </a>`).join('');
  const ust = kendi
    ? `<a class="geri" href="#/secim">Takım değiştir</a>`
    : geriLinki(`#/hafta/${n}`);

  return `${ust}
    <section class="kart">
      <div class="takim-baslik"><strong>${kacis(sonuc.ad)}</strong>${sonuc.sahibi ? `<small>${kacis(sonuc.sahibi)}</small>` : ''}</div>
      <div class="ozet">
        <div><strong>${sonuc.toplam}</strong><small>Hafta VP</small></div>
        <div><strong>${sira.sira}.</strong><small>Hafta sırası</small></div>
        <div><strong>${genel.sira}.</strong><small>Genel (${genel.puan} p)</small></div>
      </div>
    </section>
    ${haftaSecici(n, rota)}
    <section class="kart"><h2>As kadro</h2>${sonuc.aslar.map(oyuncuSatiri).join('')}</section>
    <section class="kart"><h2>Yedekler</h2>${sonuc.yedekler.map(oyuncuSatiri).join('')}</section>
    <section class="kart"><h2>Haftalar</h2>${gecmis}</section>`;
}

// Boştaki oyuncular: aktif TBL kadrolarında olup hiçbir fantezi takımında olmayanlar
const SIRALAMALAR = {
  vp: { ad: 'VP ort.', fn: (a, b) => b.vpOrt - a.vpOrt },
  hafta: { ad: 'Bu hafta', fn: (a, b) => (b.buHafta ?? -99) - (a.buHafta ?? -99) },
  sayi: { ad: 'Sayı ort.', fn: (a, b) => b.sayiOrt - a.sayiOrt },
};
let arama = '';
const aramaNorm = s => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '');

function bostakiOyuncular() {
  const sahipli = new Set(sonKadro().flatMap(t => [...t.as, ...t.yedek]).map(o => o.id).filter(Boolean));
  const hafta = veri.haftalar.get(sonHafta());
  return Object.entries(veri.rehber)
    .filter(([id, o]) => o.aktif && !sahipli.has(id))
    .map(([id, o]) => ({ id, ...o, buHafta: hafta.oyuncular[id]?.vp ?? null }));
}

function bostakiListesi(oyuncular) {
  const q = aramaNorm(arama.trim());
  const liste = q ? oyuncular.filter(o => aramaNorm(`${o.ad} ${o.takim}`).includes(q)) : oyuncular;
  if (!liste.length) return '<p class="bos">Oyuncu bulunamadı.</p>';
  return liste.map(o => `
    <a class="satir" href="#/oyuncu/${o.id}">
      <div class="ad"><strong>${kacis(o.ad)}</strong><small>${kacis(baslik(o.takim))} · ${o.mac} maç · ${o.sayiOrt} sayı</small></div>
      <div class="sayi ikincil"><strong>${o.buHafta ?? '–'}</strong><small>bu hafta</small></div>
      <div class="sayi"><strong>${o.vpOrt}</strong><small>VP ort.</small></div>
    </a>`).join('');
}

const gecerliSiralama = anahtar => SIRALAMALAR[anahtar] ? anahtar : 'vp';
const siraliBostakiler = anahtar => bostakiOyuncular().sort(SIRALAMALAR[gecerliSiralama(anahtar)].fn);

function bostakilerEkrani(siralamaAnahtari) {
  const siralama = gecerliSiralama(siralamaAnahtari);
  const oyuncular = siraliBostakiler(siralama);
  const secenekler = Object.entries(SIRALAMALAR).map(([k, s]) =>
    `<a class="secenek ${k === siralama ? 'aktif' : ''}" href="#/bostakiler/${k}">${s.ad}</a>`).join('');
  return `<div class="karsilama"><strong>Boştaki oyuncular</strong><small>${oyuncular.length} oyuncu hiçbir takımda değil. Transfer için lig yöneticisine bildir.</small></div>
    <input id="arama" class="arama" type="search" placeholder="Oyuncu ya da TBL takımı ara" value="${kacis(arama)}" autocomplete="off">
    <div class="secenekler">${secenekler}</div>
    <section class="kart" id="bostaki-liste">${bostakiListesi(oyuncular)}</section>`;
}

function bostakilerBagla(siralamaAnahtari) {
  const girdi = document.getElementById('arama');
  girdi.addEventListener('input', () => {
    arama = girdi.value;
    document.getElementById('bostaki-liste').innerHTML = bostakiListesi(siraliBostakiler(siralamaAnahtari));
  });
}

// Oyuncu detayı: TBL haftalarına göre maç maç istatistikler
const sureSn = s => { const [dk, sn] = String(s || '0:00').split(':').map(Number); return (dk || 0) * 60 + (sn || 0); };
const geriLinki = yedek => `<a class="geri" href="${yedek}" onclick="if (history.length > 1) { history.back(); return false; }">‹ Geri</a>`;

function oyuncuSahibi(id) {
  for (const t of sonKadro()) {
    if (t.as.some(o => o.id === id)) return `${t.ad} · As`;
    if (t.yedek.some(o => o.id === id)) return `${t.ad} · Yedek`;
  }
  return 'Boşta';
}

function oyuncuEkrani(id) {
  const o = veri.rehber[id];
  if (!o) return '<p class="bos">Oyuncu bulunamadı.</p>';
  return `${geriLinki('#/bostakiler')}
    <section class="kart">
      <div class="takim-baslik"><strong>${kacis(o.ad)}</strong><small>${kacis(baslik(o.takim))} · ${kacis(oyuncuSahibi(id))}</small></div>
      <div class="ozet" id="oyuncu-ozet"><div><strong>…</strong><small>Maç</small></div><div><strong>…</strong><small>VP ort.</small></div><div><strong>…</strong><small>Sayı ort.</small></div></div>
    </section>
    <section class="kart"><h2>TBL haftaları</h2><div id="oyuncu-maclar"><p class="bos">Yükleniyor…</p></div></section>`;
}

// Oyuncunun o hafta istatistiği yoksa nedeni (sadece maç listesi elimizde olan haftalar için bilinir)
function macYokAciklamasi(h, tblTakim) {
  const hafta = veri.haftalar.get(h);
  if (!hafta || !tblTakim) return 'Maç kaydı yok';
  const mac = hafta.maclar.find(m => m.ev === tblTakim || m.dep === tblTakim);
  if (!mac) return 'Takımı bay';
  if (mac.durum === 'oynanmadi') return `${mac.ev === tblTakim ? 'vs' : '@'} ${kacis(baslik(mac.ev === tblTakim ? mac.dep : mac.ev))} · ${tarihSaat(mac.tarih)}`;
  return 'Maç kadrosunda yok';
}

async function oyuncuGecmisiDoldur(id) {
  let maclar = [];
  try {
    maclar = await json(`data/oyuncu/${id}.json`);
  } catch {
    // Dosya yoksa oyuncu bu sezon hiç maç kadrosuna girmemiştir
  }
  const ozet = document.getElementById('oyuncu-ozet');
  const liste = document.getElementById('oyuncu-maclar');
  if (!ozet || !liste) return; // bu arada başka sayfaya geçildi

  const oynanan = maclar.filter(m => sureSn(m.sure) > 0);
  const ort = alan => oynanan.length ? (oynanan.reduce((t, m) => t + m[alan], 0) / oynanan.length).toFixed(1) : '–';
  ozet.innerHTML = `
    <div><strong>${oynanan.length}</strong><small>Maç</small></div>
    <div><strong>${ort('vp')}</strong><small>VP ort.</small></div>
    <div><strong>${ort('sayi')}</strong><small>Sayı ort.</small></div>`;

  const haftaya = new Map();
  for (const m of maclar) haftaya.set(m.hafta, [...(haftaya.get(m.hafta) ?? []), m]);
  const satirlar = [];
  for (let h = veri.index.guncelHafta; h >= 1; h--) {
    const hm = haftaya.get(h);
    if (!hm) {
      satirlar.push(`<div class="satir oyuncu sayilmadi"><div class="ad"><strong>${h}. Hafta</strong><small>${macYokAciklamasi(h, veri.rehber[id]?.takim)}</small></div></div>`);
      continue;
    }
    for (const m of hm) {
      const oynadi = sureSn(m.sure) > 0;
      const skor = m.skor !== null ? `${Number(m.skor) > Number(m.rakipSkor) ? 'G' : 'M'} ${m.skor}-${m.rakipSkor} · ` : '';
      const detay = oynadi
        ? `${m.sure} dk · ${m.sayi} sy · ${m.rib} rb · ${m.ast} as`
        : 'Süre almadı';
      const canli = m.durum === 'canli' ? '<span class="etiket canli-e">canlı</span>' : '';
      const [ac, kapa] = m.mac ? [`<a href="#/mac/${m.mac}"`, '</a>'] : ['<div', '</div>'];
      satirlar.push(`${ac} class="satir oyuncu ${oynadi ? '' : 'sayilmadi'}">
        <div class="ad"><strong>${h}. Hafta <span class="rakip">${m.evde ? 'vs' : '@'} ${kacis(baslik(m.rakip))}</span>${canli}</strong>
          <small>${m.durum === 'canli' ? '' : skor}${detay}</small></div>
        <div class="sayi"><strong>${m.vp}</strong><small>VP</small></div>
      ${kapa}`);
    }
  }
  liste.innerHTML = satirlar.join('');
}

// ---------- maçlar ----------
const gunBasligi = iso => new Date(iso).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
// TBF saati henüz belli olmayan maçları 00:00 olarak verir
const saatYazisi = iso => iso.endsWith('T00:00:00') ? 'Saat belli değil'
  : new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const kazananSinifi = (m, taraf) => {
  if (m.durum !== 'bitti') return '';
  const ev = Number(m.evSkor), dep = Number(m.depSkor);
  return (taraf === 'ev' ? ev > dep : dep > ev) ? 'kazanan' : '';
};

function macSatiri(m) {
  const orta = m.durum === 'oynanmadi'
    ? `<strong>${saatYazisi(m.tarih)}</strong>${m.yayin ? `<small>${kacis(m.yayin)}</small>` : ''}`
    : `<strong>${m.evSkor ?? 0} - ${m.depSkor ?? 0}</strong><small>${m.durum === 'canli' ? '<span class="canli-yazi">Canlı</span>' : 'MS'}</small>`;
  return `<a class="mac" href="#/mac/${m.id}">
    <span class="${kazananSinifi(m, 'ev')}">${kacis(baslik(m.ev))}</span>
    <span class="skor">${orta}</span>
    <span class="dep ${kazananSinifi(m, 'dep')}">${kacis(baslik(m.dep))}</span>
  </a>`;
}

function maclarEkrani(n) {
  const hafta = veri.haftalar.get(n);
  const gunler = new Map();
  for (const m of hafta.maclar) {
    const gun = m.tarih.slice(0, 10);
    gunler.set(gun, [...(gunler.get(gun) ?? []), m]);
  }
  const bloklar = [...gunler.values()].map(maclar =>
    `<section class="kart"><h2>${gunBasligi(maclar[0].tarih)}</h2>${maclar.map(macSatiri).join('')}</section>`).join('');
  const oynayan = new Set(hafta.maclar.flatMap(m => [m.ev, m.dep]));
  const tumTakimlar = new Set(Object.values(veri.rehber).filter(o => o.aktif).map(o => o.takim));
  const bay = [...tumTakimlar].filter(t => !oynayan.has(t));
  const bayNotu = bay.length ? `<p class="guncelleme">Bay: ${bay.map(t => kacis(baslik(t))).join(', ')}</p>` : '';
  return `${haftaSecici(n, 'maclar', true)}${bloklar}${bayNotu}`;
}

function macBul(id) {
  for (const h of veri.haftalar.values()) {
    const m = h.maclar.find(x => String(x.id) === String(id));
    if (m) return m;
  }
  return null;
}

function macEkrani() {
  return `${geriLinki('#/maclar')}<div id="mac-detay"><p class="bos">Yükleniyor…</p></div>`;
}

const atis = ([b, d]) => `${b}/${d}`;
const KUTU_SUTUNLARI = [
  ['Dk', o => o.sure], ['Sy', o => o.sayi], ['2S', o => atis(o.iki)], ['3S', o => atis(o.uc)], ['SA', o => atis(o.sa)],
  ['Rb', o => o.rib], ['As', o => o.ast], ['Tç', o => o.tc], ['Bl', o => o.blk], ['Tk', o => o.tk], ['F', o => o.faul], ['VP', o => o.vp],
];

function kutuSkorTablosu(takim) {
  const benim = sonKadro().find(t => t.ad === seciliTakim);
  const benimkiler = new Set([...(benim?.as ?? []), ...(benim?.yedek ?? [])].map(o => o.id));
  const satirlar = takim.oyuncular.map(o => {
    const oynadi = sureSn(o.sure) > 0;
    return `<tr class="${oynadi ? '' : 'oynamadi'} ${benimkiler.has(o.id) ? 'benim-oyuncu' : ''}">
      <th><a href="#/oyuncu/${o.id}">${o.ilk5 ? '<b>' : ''}${kacis(o.ad)}${o.ilk5 ? '</b>' : ''}</a></th>
      ${KUTU_SUTUNLARI.map(([, f]) => `<td>${kacis(f(o))}</td>`).join('')}
    </tr>`;
  }).join('');
  const topla = alan => takim.oyuncular.reduce((t, o) => t + (Number(o[alan]) || 0), 0);
  const toplaAtis = alan => atis([0, 1].map(i => takim.oyuncular.reduce((t, o) => t + o[alan][i], 0)));
  const toplam = `<tr class="toplam"><th>Toplam</th><td></td><td>${topla('sayi')}</td><td>${toplaAtis('iki')}</td>
    <td>${toplaAtis('uc')}</td><td>${toplaAtis('sa')}</td><td>${topla('rib')}</td><td>${topla('ast')}</td>
    <td>${topla('tc')}</td><td>${topla('blk')}</td><td>${topla('tk')}</td><td>${topla('faul')}</td><td>${topla('vp')}</td></tr>`;
  return `<section class="kart"><h2>${kacis(baslik(takim.ad))}</h2>
    <div class="tablo-kaydir"><table class="kutu">
      <thead><tr><th>Oyuncu</th>${KUTU_SUTUNLARI.map(([b]) => `<td>${b}</td>`).join('')}</tr></thead>
      <tbody>${satirlar}${toplam}</tbody>
    </table></div></section>`;
}

function macBasligi(m) {
  const durum = m.durum === 'canli' ? '<span class="canli-yazi">Canlı</span>' : m.durum === 'bitti' ? 'Maç sonu' : saatYazisi(m.tarih);
  const skor = m.durum === 'oynanmadi' ? '–' : `${m.evSkor ?? 0} - ${m.depSkor ?? 0}`;
  const bilgi = [gunBasligi(m.tarih), m.salon, m.yayin].filter(Boolean).map(kacis).join(' · ');
  return `<section class="kart mac-baslik">
    <div class="mac-takimlar">
      <strong class="${kazananSinifi(m, 'ev')}">${kacis(baslik(m.ev))}</strong>
      <div class="mac-skor"><strong>${skor}</strong><small>${durum}</small></div>
      <strong class="${kazananSinifi(m, 'dep')}">${kacis(baslik(m.dep))}</strong>
    </div>
    <p class="mac-bilgi">${m.hafta ? `TBL ${m.hafta}. Hafta · ` : ''}${bilgi}</p>
  </section>`;
}

function ceyrekTablosu(d) {
  const n = Math.max(d.ev.ceyrekler.length, d.dep.ceyrekler.length);
  if (!n) return '';
  const baslikHucre = i => i < 4 ? `Ç${i + 1}` : `U${i - 3}`;
  const satir = t => `<tr><th>${kacis(baslik(t.ad))}</th>${Array.from({ length: n }, (_, i) => `<td>${t.ceyrekler[i] ?? '–'}</td>`).join('')}<td><b>${t.skor ?? 0}</b></td></tr>`;
  return `<section class="kart"><div class="tablo-kaydir"><table class="kutu ceyrek">
    <thead><tr><th></th>${Array.from({ length: n }, (_, i) => `<td>${baslikHucre(i)}</td>`).join('')}<td>T</td></tr></thead>
    <tbody>${satir(d.ev)}${satir(d.dep)}</tbody></table></div></section>`;
}

async function macDetayDoldur(id) {
  let d = null;
  try {
    d = await json(`data/mac/${id}.json`);
  } catch {
    // Maç henüz oynanmadıysa box score dosyası yoktur
  }
  const kutu = document.getElementById('mac-detay');
  if (!kutu) return; // bu arada başka sayfaya geçildi
  // Box score dosyasında ev/dep takım nesnesidir; başlık için takım adları gerekir
  const mac = d ? { ...d, ev: d.ev.ad, dep: d.dep.ad } : macBul(id);
  if (!mac) {
    kutu.innerHTML = '<p class="bos">Maç bulunamadı.</p>';
    return;
  }
  kutu.innerHTML = macBasligi(mac) + (d
    ? ceyrekTablosu(d) + kutuSkorTablosu(d.ev) + kutuSkorTablosu(d.dep)
      + '<p class="guncelleme">Kalın: ilk 5 · 2S/3S/SA: isabet/deneme</p>'
    : `<p class="bos">${mac.durum === 'oynanmadi' ? 'Maç henüz oynanmadı.' : 'İstatistikler henüz gelmedi.'}</p>`);
}

// ---------- yönlendirme ----------
function ciz() {
  const [, sekme = '', a, b] = location.hash.split('/');
  if (sekme === 'sec' && a) {
    takimSec(decodeURIComponent(a));
    location.replace('#/takimim');
    return;
  }
  const secimGecerli = sonKadro().some(t => t.ad === seciliTakim);
  const gecerli = n => veri.index.haftalar.includes(n) ? n : sonHafta();

  let html, aktif = sekme;
  if (sekme === 'secim' || (!secimGecerli && sekme !== 'takim')) { html = secimEkrani(); aktif = 'takimim'; }
  else if (sekme === 'genel') html = genelEkran();
  else if (sekme === 'hafta') html = haftalikEkran(gecerli(Number(a)));
  else if (sekme === 'takim') html = takimEkrani(decodeURIComponent(a ?? ''), gecerli(Number(b)), false);
  else if (sekme === 'bostakiler') html = bostakilerEkrani(a);
  else if (sekme === 'oyuncu') html = oyuncuEkrani(a);
  else if (sekme === 'maclar') html = maclarEkrani(gecerli(Number(a)));
  else if (sekme === 'mac') { html = macEkrani(); aktif = 'maclar'; }
  else { html = takimEkrani(seciliTakim, gecerli(Number(a)), true); aktif = 'takimim'; }
  // Otomatik yenileme arama kutusuna yazarken odağı kaçırmasın
  const aramaOdakta = document.activeElement?.id === 'arama';
  icerik.innerHTML = html;
  if (aktif === 'bostakiler') {
    bostakilerBagla(a);
    if (aramaOdakta) document.getElementById('arama').focus();
  }
  if (sekme === 'oyuncu') oyuncuGecmisiDoldur(a);
  if (sekme === 'mac') macDetayDoldur(a);

  document.querySelectorAll('.alt-menu a').forEach(el => el.classList.toggle('aktif', el.dataset.sekme === aktif));
  document.getElementById('canli').hidden = !haftaDurumu(veri.haftalar.get(sonHafta())).canli;
  document.getElementById('guncelleme').textContent =
    `Son veri: ${new Date(veri.index.guncelleme).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

function uyarilar() {
  const u = [];
  if (veri.ayarlar.ornekKadrolar) u.push('Örnek kadrolar gösteriliyor. Gerçek kadrolar eklenince değişecek.');
  if (veri.ayarlar.puanTablosuGecici) u.push('Sıralama puanları geçici.');
  document.getElementById('uyarilar').innerHTML = u.map(m => `<div class="uyari">${m}</div>`).join('');
}

// Güncel hafta bitmediyse veriyi periyodik olarak yenile
async function yenile() {
  try {
    const eskiSon = sonHafta();
    veri.index = await json('data/hafta/index.json');
    await haftaYukle(sonHafta(), true);
    if (eskiSon !== sonHafta()) await Promise.all(veri.index.haftalar.map(n => haftaYukle(n)));
    ciz();
  } catch (e) {
    console.warn('Yenileme başarısız', e);
  }
}

async function basla() {
  try {
    await hepsiniYukle();
  } catch (e) {
    icerik.innerHTML = `<p class="bos">Veriler yüklenemedi.<br>${kacis(e.message)}</p>`;
    return;
  }
  document.getElementById('lig-adi').textContent = veri.ayarlar.ligAdi;
  uyarilar();
  window.addEventListener('hashchange', () => { ciz(); window.scrollTo(0, 0); });
  ciz();
  setInterval(() => {
    if (!document.hidden && !haftaDurumu(veri.haftalar.get(sonHafta())).tamamlandi) yenile();
  }, YENILEME_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) yenile(); });
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
basla();
