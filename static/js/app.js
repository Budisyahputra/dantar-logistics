let dbCache = [];
let aktif = null;

async function muatSemuaData() {
  try {
    const res = await fetch('/api/shipments');
    dbCache = await res.json();
    if (dbCache.length && !aktif) aktif = dbCache[0];
    renderTabel();
    isiDropdownCetak();
  } catch (err) {
    console.error("Gagal memuat data dari server:", err);
  }
}

function bukaTab(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + id).classList.add('active');
  document.getElementById('btn-' + id).classList.add('active');
  if (id === 'print') { isiDropdownCetak(); renderCetakan(); }
  if (id === 'admin') muatSemuaData();
  window.scrollTo(0, 0);
}

function hitungTarif() {
  const tipe = document.getElementById('cTipe').value;
  const rute = parseFloat(document.getElementById('cRute').value);
  const berat = parseFloat(document.getElementById('cBerat').value) || 1;
  const cbm = parseFloat(document.getElementById('cCbm').value) || 0.1;
  const pakaiBerat = Math.max(berat, cbm * 250);
  const tarif = Math.round(pakaiBerat * (tipe === 'B2B' ? 2200 : 4500) * rute);
  document.getElementById('cHasilHarga').innerText = 'Rp ' + tarif.toLocaleString('id-ID');

  let armada = "Kurir Motor / Blind Van";
  if (berat > 4500 || cbm > 14) armada = "Truk Fuso / Wingbox (8–15 Ton)";
  else if (berat > 2000 || cbm > 6) armada = "Truk CDD Double Box (4.5 Ton)";
  else if (berat > 500 || cbm > 2) armada = "Truk CDE Engkel Box (2.2 Ton)";
  document.getElementById('cHasilArmada').innerText = 'Armada: ' + armada;
}

function lacakDariHero() {
  const v = document.getElementById('heroInput').value.trim();
  if (!v) return alert('Ketik Nomor Resi atau Surat Jalan terlebih dahulu.');
  pilihContoh(v);
}

function pilihContoh(kode) {
  bukaTab('track');
  document.getElementById('trackInput').value = kode;
  prosesLacak();
}

async function prosesLacak() {
  const q = document.getElementById('trackInput').value.trim();
  if (!q) return;

  const card = document.getElementById('hasilCard');
  try {
    const res = await fetch(`/api/track?q=${encodeURIComponent(q)}`);
    const json = await res.json();
    if (!res.ok || !json.found) {
      card.style.display = 'none';
      return alert(json.message || 'Data tidak ditemukan.');
    }

    const d = json.data;
    aktif = d;
    card.style.display = 'block';
    document.getElementById('outTipeBadge').innerText = d.tipe === 'B2B' ? 'B2B KARGO VENDOR' : 'B2C REGULER';
    document.getElementById('outTipeBadge').className = 'badge ' + (d.tipe === 'B2B' ? 'b-b2b' : 'b-b2c');
    document.getElementById('outStatusBadge').innerText = d.status;
    document.getElementById('outStatusBadge').className = 'badge ' + (d.status.includes('Delivered') ? 'b-ok' : 'b-wait');
    document.getElementById('outResi').innerText = d.resi;
    document.getElementById('outRef').innerText = `No. Surat Jalan: ${d.sj} | Ref PO: ${d.po}`;
    document.getElementById('outPengirim').innerText = d.pengirim;
    document.getElementById('outPenerima').innerText = d.penerima;
    document.getElementById('outMuatan').innerText = `${d.koli} Koli (${d.berat} Kg / ${d.cbm} CBM)`;
    document.getElementById('outArmada').innerText = d.armada;
    document.getElementById('outPod').innerText = d.pod;

    const ul = document.getElementById('outTimeline');
    ul.innerHTML = '';
    d.riwayat.forEach(r => {
      const li = document.createElement('li');
      li.innerText = r;
      ul.appendChild(li);
    });
  } catch (err) {
    alert('Gagal menghubungi server pelacakan.');
  }
}

function bukaModal() {
  if (!aktif) return;
  document.getElementById('judulModal').innerText = `Dokumen POD — ${aktif.resi}`;
  document.getElementById('isiModal').innerHTML = `
    <p><strong>No. Surat Jalan:</strong> ${aktif.sj} (PO: ${aktif.po})</p>
    <p><strong>Pengirim:</strong> ${aktif.pengirim}</p>
    <p><strong>Penerima:</strong> ${aktif.penerima}</p>
    <p><strong>Muatan Fisik:</strong> ${aktif.koli} Koli (${aktif.berat} Kg)</p>
    <div style="margin-top:10px; padding:8px; border:2px solid #1e40af; color:#1e40af; font-weight:800; text-align:center;">
      STEMPEL BASAH GUDANG PENERIMA<br>${aktif.pod.toUpperCase()}
    </div>
  `;
  document.getElementById('modalPod').classList.add('open');
}
function tutupModal() { document.getElementById('modalPod').classList.remove('open'); }

function loncatKeCetak() {
  bukaTab('print');
  if (aktif) document.getElementById('selResiCetak').value = aktif.resi;
  renderCetakan();
}

function qrSvg(teks) {
  let h = 0;
  for (let i = 0; i < teks.length; i++) h = ((h << 5) - h) + teks.charCodeAt(i);
  let rects = '';
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const corner = (r < 3 && c < 3) || (r < 3 && c > 5) || (r > 5 && c < 3);
      if (corner || Math.abs((h * (r + 1) * (c + 2) + r * 13) % 5) < 2) {
        rects += `<rect x="${c * 8}" y="${r * 8}" width="8" height="8" fill="#000"/>`;
      }
    }
  }
  return `<svg width="72" height="72" viewBox="0 0 72 72" style="border:2px solid #000; padding:2px; background:#fff;">${rects}</svg>`;
}

function isiDropdownCetak() {
  const s = document.getElementById('selResiCetak');
  s.innerHTML = '';
  dbCache.forEach(d => {
    const o = document.createElement('option');
    o.value = d.resi;
    o.innerText = `${d.resi} (${d.tipe} - ${d.penerima})`;
    s.appendChild(o);
  });
}

function renderCetakan() {
  if (!dbCache.length) return;
  const kode = document.getElementById('selResiCetak').value;
  const fmt = document.getElementById('selFormatCetak').value;
  const d = dbCache.find(x => x.resi === kode) || dbCache[0];
  const box = document.getElementById('areaCetak');
  const qr = qrSvg(d.resi);

  if (fmt === 'AWB') {
    box.innerHTML = `
      <div style="display:flex; justify-content:space-between; border-bottom:2px solid #000; padding-bottom:8px; margin-bottom:8px;">
        <div><strong>D'ANTAR LOGISTIK — AWB KARGO B2B</strong><div style="font-size:11px;">Surat Jalan & Lembar Balikan POD</div></div>
        <div style="text-align:right;"><strong>${d.resi}</strong><div style="font-size:11px;">SJ: ${d.sj} | PO: ${d.po}</div></div>
      </div>
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:center; font-size:12px;">
        <div>
          <p><strong>Pengirim:</strong> ${d.pengirim}</p>
          <p><strong>Penerima:</strong> ${d.penerima}</p>
          <p><strong>Muatan:</strong> ${d.koli} Koli | ${d.berat} Kg (${d.cbm} CBM) — ${d.armada}</p>
        </div>
        ${qr}
      </div>
      <div class="sign-grid">
        <div class="sign-cell"><strong>Pengirim</strong><span>(Stempel & TTD)</span></div>
        <div class="sign-cell"><strong>Supir Armada</strong><span>(Tanda Tangan)</span></div>
        <div class="sign-cell"><strong>Gudang Penerima (POD)</strong><span>(Wajib Stempel Basah)</span></div>
      </div>
    `;
  } else if (fmt === 'KOLI') {
    box.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #000; padding-bottom:6px; margin-bottom:8px;">
        <strong>LABEL PENANDA KOLI KARGO B2B</strong>
        <span style="background:#000; color:#fff; padding:3px 8px; font-weight:800; font-size:13px;">KOLI 1 DARI ${d.koli}</span>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
        <div>
          <p><strong>NO. RESI:</strong> ${d.resi}</p>
          <p><strong>SURAT JALAN:</strong> ${d.sj}</p>
          <p><strong>TUJUAN:</strong> ${d.penerima}</p>
        </div>
        ${qr}
      </div>
    `;
  } else {
    box.innerHTML = `
      <div style="display:flex; justify-content:space-between; border-bottom:1px solid #000; padding-bottom:6px; margin-bottom:8px;">
        <strong>D'ANTAR EXPRESS (THERMAL A6)</strong>
        <span>${d.tipe}</span>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
        <div><strong>${d.resi}</strong><p>Penerima: ${d.penerima}</p><p>Pengirim: ${d.pengirim}</p></div>
        ${qr}
      </div>
    `;
  }
}

function renderTabel() {
  document.getElementById('jmlData').innerText = dbCache.length;
  const tb = document.getElementById('tabelAdmin');
  tb.innerHTML = '';
  dbCache.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${d.resi}</strong></td>
      <td><span class="badge ${d.tipe === 'B2B' ? 'b-b2b' : 'b-b2c'}">${d.tipe}</span></td>
      <td>${d.sj}</td>
      <td>${d.pengirim}</td>
      <td>${d.penerima}</td>
      <td>${d.koli} Koli (${d.berat} Kg)</td>
      <td>${d.status}</td>
      <td><button class="chip" onclick="pilihContoh('${d.resi}')">Lacak</button></td>
    `;
    tb.appendChild(tr);
  });
}

async function buatResiServer() {
  const payload = {
    tipe: document.getElementById('inTipe').value,
    sj: document.getElementById('inSJ').value.trim(),
    pengirim: document.getElementById('inPengirim').value.trim(),
    penerima: document.getElementById('inPenerima').value.trim(),
    koli: parseInt(document.getElementById('inKoli').value) || 1,
    berat: parseFloat(document.getElementById('inBerat').value) || 10
  };
  if (!payload.pengirim || !payload.penerima) {
    return alert('Mohon isi Nama Pengirim dan Penerima.');
  }

  const res = await fetch('/api/shipments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (res.ok) {
    await muatSemuaData();
    alert(`Resi baru berhasil disimpan ke PostgreSQL: ${json.data.resi}`);
  }
}

function unduhExcelServer() {
  window.location.href = '/api/export-excel';
}

async function unggahExcelServer(e) {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/upload-excel', {
    method: 'POST',
    body: formData
  });
  const json = await res.json();
  if (res.ok) {
    await muatSemuaData();
    alert(json.message);
  } else {
    alert(json.error || 'Gagal mengunggah file Excel.');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  hitungTarif();
  await muatSemuaData();
  document.getElementById('trackInput').value = 'DAN-B2B-2611-0001';
  prosesLacak();
});