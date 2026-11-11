let dbCache = [];
let aktif = null;
let csrfToken = '';
let dataAdminDimuat = false;
let lastTrackedQuery = '';
let corporateAccounts = [];

async function muatSemuaData() {
  try {
    const res = await fetch('/api/shipments');
    if (res.status === 401) {
      csrfToken = '';
      dataAdminDimuat = false;
      window.location.assign('/admin/login');
      return false;
    }
    if (!res.ok) throw new Error(`Request gagal (${res.status})`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Format data kiriman tidak valid');
    dbCache = data;
    await muatDaftarPerusahaan();
    if (dbCache.length && !aktif) aktif = dbCache[0];
    dataAdminDimuat = true;
    renderTabel();
    isiDropdownCetak();
    return true;
  } catch (err) {
    console.error("Gagal memuat data dari server:", err);
    showToast('Data admin gagal dimuat. Coba muat ulang halaman.', 'error', 'Gagal memuat data');
    return false;
  }
}

async function muatDaftarPerusahaan() {
  const res = await fetch('/api/companies');
  if (!res.ok) throw new Error(`Gagal memuat akun perusahaan (${res.status})`);
  corporateAccounts = await res.json();
  renderDaftarPerusahaan();
  isiPilihanPerusahaan();
}

function isiPilihanPerusahaan() {
  const select = document.getElementById('shipmentCompanySelect');
  select.replaceChildren(new Option('Pilih perusahaan', ''));
  corporateAccounts.filter(account => account.is_active).forEach(account => {
    select.add(new Option(`${account.company_name} (${account.username})`, account.id));
  });
  toggleCompanyField();
}

function toggleCompanyField() {
  const isB2B = document.getElementById('inTipe').value === 'B2B';
  document.getElementById('shipmentCompanyField').hidden = !isB2B;
}

function renderDaftarPerusahaan() {
  const table = document.getElementById('tabelPerusahaan');
  table.replaceChildren();
  corporateAccounts.forEach(account => {
    const row = document.createElement('tr');
    [account.company_name, account.username, account.is_active ? 'Aktif' : 'Nonaktif'].forEach(value => {
      const cell = document.createElement('td');
      cell.innerText = value;
      row.appendChild(cell);
    });
    const actions = document.createElement('td');
    const resetButton = document.createElement('button');
    resetButton.className = 'chip';
    resetButton.innerText = 'Reset password';
    resetButton.addEventListener('click', () => resetPasswordKorporat(account.id));
    actions.appendChild(resetButton);
    row.appendChild(actions);
    table.appendChild(row);
  });
}

async function cekSesiAdmin() {
  const res = await fetch('/api/admin/session');
  if (!res.ok) throw new Error(`Server merespons HTTP ${res.status}`);
  const data = await res.json();
  if (typeof data.authenticated !== 'boolean') {
    throw new Error('Respons status sesi tidak valid');
  }
  csrfToken = data.csrf_token || '';
  return data.authenticated;
}

async function bukaTab(id) {
  if (id === 'admin' || id === 'print') {
    try {
      if (!await cekSesiAdmin()) {
        window.location.assign('/admin/login');
        return;
      }
    } catch (err) {
      console.error('Gagal memverifikasi sesi admin:', err);
      showToast(`Tidak dapat memverifikasi sesi admin. ${err.message || 'Periksa koneksi ke server.'}`, 'error', 'Sesi admin');
      return;
    }
    if (!dataAdminDimuat && !await muatSemuaData()) return;
  }

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + id).classList.add('active');
  document.getElementById('btn-' + id).classList.add('active');
  if (id === 'print') { isiDropdownCetak(); renderCetakan(); }
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
  if (!v) return showToast('Ketik nomor resi atau Surat Jalan terlebih dahulu.', 'warning', 'Nomor belum diisi');
  pilihContoh(v);
}

function pilihContoh(kode) {
  bukaTab('track');
  document.getElementById('trackInput').value = kode;
  prosesLacak();
}

function updateStatusPelacakan(status) {
  const normalized = status.toLowerCase();
  const delivered = normalized.includes('delivered') || normalized.includes('terkirim');
  const inTransit = normalized.includes('transit') || normalized.includes('perjalanan');
  const completed = delivered || inTransit;
  const currentStep = delivered ? 3 : inTransit ? 2 : 1;
  const label = delivered ? 'Terkirim' : inTransit ? 'Dalam perjalanan' : 'Resi dibuat';

  const statusBadge = document.getElementById('outStatusBadge');
  statusBadge.innerText = label;
  statusBadge.className = `badge ${delivered ? 'b-ok' : inTransit ? 'b-transit' : 'b-wait'}`;
  document.getElementById('statusIcon').innerText = delivered ? '✓' : inTransit ? '→' : '…';
  document.getElementById('shipmentProgress').dataset.step = currentStep;
  document.querySelectorAll('.progress-step').forEach((step, index) => {
    step.classList.toggle('is-complete', delivered || (inTransit && index === 0));
    step.classList.toggle('is-current', index + 1 === currentStep);
    step.classList.toggle('is-upcoming', index + 1 > currentStep);
    step.setAttribute('aria-current', index + 1 === currentStep ? 'step' : 'false');
  });
  document.getElementById('shipmentProgress').classList.toggle('is-delivered', delivered);
  document.getElementById('shipmentProgress').classList.toggle('is-in-transit', inTransit);
  document.getElementById('shipmentProgress').classList.toggle('is-created', !completed);
}

async function prosesLacak() {
  const q = document.getElementById('trackInput').value.trim();
  if (!q) return;

  const card = document.getElementById('hasilCard');
  card.style.display = 'none';
  try {
    const res = await fetch(`/api/track?q=${encodeURIComponent(q)}`);
    const json = await res.json();
    if (!res.ok || !json.found) {
      card.style.display = 'none';
      return showToast(json.message || 'Data tidak ditemukan.', 'error', 'Kiriman tidak ditemukan');
    }

    const d = json.data;
    aktif = d;
    lastTrackedQuery = q.toUpperCase();
    document.getElementById('detailTerlindungi').style.display = 'none';
    document.getElementById('trackingCodeInput').value = '';
    document.getElementById('trackingCodeMessage').innerText = '';
    card.style.display = 'block';
    document.getElementById('outTipeBadge').innerText = d.tipe === 'B2B' ? 'B2B KARGO VENDOR' : 'B2C REGULER';
    document.getElementById('outTipeBadge').className = 'badge ' + (d.tipe === 'B2B' ? 'b-b2b' : 'b-b2c');
    updateStatusPelacakan(d.status);
    document.getElementById('outResi').innerText = d.resi;
  } catch (err) {
    console.error('Gagal menghubungi server pelacakan:', err);
    showToast('Periksa koneksi Anda lalu coba lacak kembali.', 'error', 'Pelacakan gagal');
  }
}

async function verifikasiKodeAkses() {
  const q = document.getElementById('trackInput').value.trim();
  const code = document.getElementById('trackingCodeInput').value.trim();
  const message = document.getElementById('trackingCodeMessage');
  const details = document.getElementById('detailTerlindungi');
  details.style.display = 'none';

  if (!q || !code) {
    message.innerText = 'Masukkan nomor kiriman dan kode akses.';
    return;
  }

  try {
    const res = await fetch('/api/track/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, code })
    });
    const json = await res.json();
    if (!res.ok || !json.verified) {
      message.innerText = json.error || 'Kode akses tidak dapat diverifikasi.';
      return;
    }

    const d = json.data;
    aktif = d;
    document.getElementById('trackingCodeInput').value = '';
    document.getElementById('outTipeBadge').innerText = d.tipe === 'B2B' ? 'B2B KARGO VENDOR' : 'B2C REGULER';
    document.getElementById('outTipeBadge').className = 'badge ' + (d.tipe === 'B2B' ? 'b-b2b' : 'b-b2c');
    updateStatusPelacakan(d.status);
    document.getElementById('outResi').innerText = d.resi;
    document.getElementById('outRef').innerText = `No. Surat Jalan: ${d.sj} | Ref PO: ${d.po}`;
    document.getElementById('outPengirim').innerText = d.pengirim;
    document.getElementById('outPenerima').innerText = d.penerima;
    document.getElementById('outMuatan').innerText = `${d.koli} Koli (${d.berat} Kg / ${d.cbm} CBM)`;
    document.getElementById('outArmada').innerText = d.armada;
    document.getElementById('outPod').innerText = d.pod;

    const timeline = document.getElementById('outTimeline');
    timeline.replaceChildren();
    d.riwayat.forEach(item => {
      const entry = document.createElement('li');
      entry.innerText = item;
      timeline.appendChild(entry);
    });
    message.innerText = 'Kode benar. Detail kiriman dibuka.';
    details.style.display = 'block';
  } catch (err) {
    console.error('Gagal memverifikasi kode akses:', err);
    message.innerText = 'Gagal menghubungi server. Coba lagi.';
  }
}

function bukaModal() {
  if (!aktif) return;
  document.getElementById('judulModal').innerText = `Dokumen POD — ${aktif.resi}`;
  const content = document.getElementById('isiModal');
  content.replaceChildren();
  [
    ['No. Surat Jalan', `${aktif.sj} (PO: ${aktif.po})`],
    ['Pengirim', aktif.pengirim],
    ['Penerima', aktif.penerima],
    ['Muatan Fisik', `${aktif.koli} Koli (${aktif.berat} Kg)`]
  ].forEach(([label, value]) => {
    const paragraph = document.createElement('p');
    const strong = document.createElement('strong');
    strong.innerText = `${label}: `;
    paragraph.append(strong, document.createTextNode(value));
    content.appendChild(paragraph);
  });
  const pod = document.createElement('div');
  pod.className = 'pod-stamp-preview';
  pod.innerText = `STATUS POD\n${aktif.pod.toUpperCase()}`;
  content.appendChild(pod);
  document.getElementById('modalPod').classList.add('open');
}
function tutupModal() { document.getElementById('modalPod').classList.remove('open'); }

function loncatKeCetak() {
  bukaTab('print').then(() => {
    if (document.getElementById('view-print').classList.contains('active')) {
      if (aktif) document.getElementById('selResiCetak').value = aktif.resi;
      renderCetakan();
    }
  });
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
  tb.replaceChildren();
  dbCache.forEach(d => {
    const tr = document.createElement('tr');
    const values = [d.resi, d.tipe, d.sj];
    values.forEach((value, index) => {
      const td = document.createElement('td');
      if (index === 0) {
        const strong = document.createElement('strong');
        strong.innerText = value;
        td.appendChild(strong);
      } else if (index === 1) {
        const badge = document.createElement('span');
        badge.className = `badge ${d.tipe === 'B2B' ? 'b-b2b' : 'b-b2c'}`;
        badge.innerText = value;
        td.appendChild(badge);
      } else {
        td.innerText = value ?? '';
      }
      tr.appendChild(td);
    });
    const companyCell = document.createElement('td');
    if (d.tipe === 'B2B') {
      const companySelect = document.createElement('select');
      companySelect.className = 'shipment-company-select';
      companySelect.add(new Option('Belum ditautkan', ''));
      corporateAccounts.filter(account => account.is_active).forEach(account => {
        companySelect.add(new Option(account.company_name, account.id));
      });
      companySelect.value = d.company_id || '';
      companySelect.setAttribute('aria-label', `Perusahaan untuk kiriman ${d.resi}`);
      companySelect.addEventListener('change', () => tautkanPerusahaan(d.id, companySelect.value));
      companyCell.appendChild(companySelect);
    } else {
      companyCell.innerText = '—';
    }
    tr.appendChild(companyCell);
    [d.pengirim, d.penerima, `${d.koli} Koli (${d.berat} Kg)`, d.status].forEach(value => {
      const cell = document.createElement('td');
      cell.innerText = value ?? '';
      tr.appendChild(cell);
    });
    const actions = document.createElement('td');
    const trackButton = document.createElement('button');
    trackButton.className = 'chip';
    trackButton.innerText = 'Lacak';
    trackButton.addEventListener('click', () => pilihContoh(d.resi));
    actions.appendChild(trackButton);
    if (d.tipe === 'B2C') {
      const codeButton = document.createElement('button');
      codeButton.className = 'chip access-code-action';
      codeButton.innerText = 'Terbitkan kode';
      codeButton.addEventListener('click', () => terbitkanKodeAkses(d.id));
      actions.appendChild(codeButton);
    }
    tr.appendChild(actions);
    tb.appendChild(tr);
  });
}

async function buatAkunKorporat(event) {
  event.preventDefault();
  const payload = {
    company_name: document.getElementById('companyNameInput').value.trim(),
    username: document.getElementById('companyUsernameInput').value.trim().toLowerCase(),
    password: document.getElementById('companyPasswordInput').value
  };
  try {
    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Gagal membuat akun korporat.', 'error', 'Akun gagal dibuat');
      return;
    }
    event.target.reset();
    await muatDaftarPerusahaan();
    renderTabel();
    showAppDialog({
      title: 'Akun perusahaan berhasil dibuat',
      message: `Perusahaan: ${data.account.company_name}\nUsername: ${data.account.username}\n\nSimpan password yang dimasukkan saat pembuatan dan berikan secara aman kepada perusahaan.`,
      type: 'success'
    });
  } catch (error) {
    console.error('Gagal membuat akun perusahaan:', error);
    showToast('Tidak dapat menghubungi server untuk membuat akun perusahaan.', 'error', 'Akun gagal dibuat');
  }
}

async function resetPasswordKorporat(companyId) {
  if (!await showConfirm(
    'Password lama langsung tidak berlaku. Pastikan Anda siap menyampaikan password baru dengan aman.',
    { title: 'Reset password perusahaan', confirmLabel: 'Reset password' }
  )) return;
  try {
    const res = await fetch(`/api/companies/${companyId}/reset-password`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken }
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Gagal mereset password perusahaan.', 'error', 'Reset gagal');
      return;
    }
    showAppDialog({
      title: 'Password sementara dibuat',
      message: `Username: ${data.username}\nPassword: ${data.temporary_password}\n\nPassword ini hanya ditampilkan kali ini. Bagikan melalui kanal aman.`,
      type: 'success',
      confirmLabel: 'Selesai',
      copyText: data.temporary_password
    });
  } catch (error) {
    console.error('Gagal mereset password akun korporat:', error);
    showToast('Tidak dapat menghubungi server untuk mereset password.', 'error', 'Reset gagal');
  }
}

async function tautkanPerusahaan(shipmentId, companyId) {
  try {
    const res = await fetch(`/api/admin/shipments/${shipmentId}/company`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ company_id: companyId || null })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Gagal menautkan kiriman ke perusahaan.', 'error', 'Tautan gagal');
      await muatSemuaData();
      return;
    }
    await muatSemuaData();
    showToast(data.message || 'Kiriman berhasil ditautkan ke perusahaan.', 'success', 'Kiriman diperbarui');
  } catch (error) {
    console.error('Gagal menautkan kiriman ke perusahaan:', error);
    showToast('Tidak dapat menghubungi server untuk menautkan kiriman.', 'error', 'Tautan gagal');
  }
}

async function terbitkanKodeAkses(shipmentId) {
  if (!await showConfirm(
    'Kode akses lama langsung tidak berlaku. Pastikan Anda dapat membagikan kode baru kepada penerima.',
    { title: 'Terbitkan kode akses baru', confirmLabel: 'Terbitkan kode' }
  )) return;
  const res = await fetch(`/api/shipments/${shipmentId}/tracking-code`, {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken }
  });
  const data = await res.json();
  if (!res.ok) {
    showToast(data.error || 'Gagal menerbitkan kode akses.', 'error', 'Kode gagal dibuat');
    return;
  }
  showAppDialog({
    title: 'Kode akses berhasil dibuat',
    message: `Resi: ${data.resi}\nKode: ${data.tracking_code}\n\nKode ini hanya ditampilkan kali ini. Bagikan hanya kepada penerima yang berhak.`,
    type: 'success',
    confirmLabel: 'Selesai',
    copyText: data.tracking_code
  });
}

async function buatResiServer() {
  const tipe = document.getElementById('inTipe').value;
  const payload = {
    tipe,
    company_id: tipe === 'B2B' ? document.getElementById('shipmentCompanySelect').value : null,
    sj: document.getElementById('inSJ').value.trim(),
    pengirim: document.getElementById('inPengirim').value.trim(),
    penerima: document.getElementById('inPenerima').value.trim(),
    koli: parseInt(document.getElementById('inKoli').value) || 1,
    berat: parseFloat(document.getElementById('inBerat').value) || 10
  };
  if (!payload.pengirim || !payload.penerima) {
    return showToast('Mohon isi nama pengirim dan penerima.', 'warning', 'Data belum lengkap');
  }
  if (tipe === 'B2B' && !payload.company_id) {
    return showToast('Pilih akun perusahaan untuk kiriman B2B.', 'warning', 'Perusahaan belum dipilih');
  }

  const res = await fetch('/api/shipments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (res.ok) {
    await muatSemuaData();
    if (tipe === 'B2C') {
      showAppDialog({
        title: 'Resi B2C berhasil dibuat',
        message: `Resi: ${json.data.resi}\nKode akses: ${json.tracking_code}\n\nKode hanya ditampilkan kali ini. Simpan dan bagikan secara aman kepada penerima.`,
        type: 'success',
        confirmLabel: 'Selesai',
        copyText: json.tracking_code
      });
    } else {
      showToast(`Resi ${json.data.resi} berhasil ditautkan ke akun perusahaan.`, 'success', 'Resi B2B dibuat');
    }
  } else {
    showToast(json.error || 'Gagal membuat resi.', 'error', 'Resi gagal dibuat');
  }
}

function unduhExcelServer() {
  window.location.href = '/api/export-excel';
}

async function logoutAdmin() {
  const res = await fetch('/admin/logout', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken }
  });
  if (res.ok) {
    csrfToken = '';
    dataAdminDimuat = false;
    window.location.assign('/');
  } else {
    showToast('Sesi tidak dapat ditutup. Muat ulang halaman dan coba lagi.', 'error', 'Logout gagal');
  }
}

async function unggahExcelServer(e) {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/upload-excel', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken },
    body: formData
  });
  const json = await res.json();
  if (res.ok) {
    await muatSemuaData();
    showToast(json.message, 'success', 'Sinkronisasi selesai');
  } else {
    showToast(json.error || 'Gagal mengunggah file Excel.', 'error', 'Impor gagal');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  hitungTarif();
  const trackInput = document.getElementById('trackInput');
  trackInput.addEventListener('input', () => {
    if (trackInput.value.trim().toUpperCase() !== lastTrackedQuery) {
      document.getElementById('hasilCard').style.display = 'none';
      document.getElementById('detailTerlindungi').style.display = 'none';
      aktif = null;
    }
  });
  trackInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') prosesLacak();
  });
  trackInput.value = 'DAN-B2B-2611-0001';
  prosesLacak();
  if (new URLSearchParams(window.location.search).has('admin')) bukaTab('admin');
});