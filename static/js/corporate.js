let corporateCsrfToken = '';

function shipmentStatusClass(status) {
  const value = status.toLowerCase();
  if (value.includes('delivered') || value.includes('terkirim')) return 'b-ok';
  if (value.includes('transit') || value.includes('perjalanan')) return 'b-transit';
  return 'b-wait';
}

async function loadCorporateShipments() {
  const message = document.getElementById('corporateMessage');
  const table = document.getElementById('corporateShipments');
  message.innerText = 'Memuat daftar kiriman...';
  try {
    const [sessionResponse, shipmentsResponse] = await Promise.all([
      fetch('/api/corporate/session'),
      fetch('/api/corporate/shipments')
    ]);
    const auth = await sessionResponse.json();
    if (!auth.authenticated) {
      window.location.assign('/corporate/login');
      return;
    }
    if (!shipmentsResponse.ok) throw new Error(`Server merespons HTTP ${shipmentsResponse.status}`);
    corporateCsrfToken = auth.csrf_token || '';
    const shipments = await shipmentsResponse.json();
    table.replaceChildren();
    shipments.forEach(shipment => {
      const row = document.createElement('tr');
      const cells = [
        shipment.resi,
        shipment.sj,
        shipment.po,
        shipment.penerima,
        `${shipment.koli} koli · ${shipment.berat} kg · ${shipment.cbm} CBM`
      ];
      cells.forEach(value => {
        const cell = document.createElement('td');
        cell.innerText = value || '—';
        row.appendChild(cell);
      });
      const status = document.createElement('td');
      const statusBadge = document.createElement('span');
      statusBadge.className = `badge ${shipmentStatusClass(shipment.status)}`;
      statusBadge.innerText = shipment.status;
      status.appendChild(statusBadge);
      row.appendChild(status);

      const pod = document.createElement('td');
      pod.innerText = shipment.pod || '—';
      row.appendChild(pod);
      table.appendChild(row);
    });
    document.getElementById('corporateShipmentCount').innerText = shipments.length;
    message.innerText = shipments.length ? '' : 'Belum ada kiriman yang ditautkan ke akun perusahaan ini.';
  } catch (error) {
    console.error('Gagal memuat kiriman korporat:', error);
    message.innerText = 'Daftar kiriman gagal dimuat. Coba muat ulang.';
  }
}

async function logoutCorporate() {
  try {
    const response = await fetch('/corporate/logout', {
      method: 'POST',
      headers: { 'X-CSRF-Token': corporateCsrfToken }
    });
    if (!response.ok) throw new Error(`Server merespons HTTP ${response.status}`);
    window.location.assign('/corporate/login');
  } catch (error) {
    console.error('Gagal logout portal korporat:', error);
    alert('Logout gagal. Coba muat ulang halaman.');
  }
}

document.addEventListener('DOMContentLoaded', loadCorporateShipments);
