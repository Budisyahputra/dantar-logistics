let activeDialogResolve = null;
let dialogPreviousFocus = null;

function showToast(message, type = 'info', title = '') {
  const region = document.getElementById('notificationRegion');
  if (!region) return;

  const toast = document.createElement('article');
  toast.className = `app-toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerText = type === 'success' ? '✓' : type === 'error' ? '!' : type === 'warning' ? '!' : 'i';

  const content = document.createElement('div');
  content.className = 'toast-content';
  if (title) {
    const heading = document.createElement('strong');
    heading.innerText = title;
    content.appendChild(heading);
  }
  const text = document.createElement('p');
  text.innerText = message;
  content.appendChild(text);

  const close = document.createElement('button');
  close.className = 'toast-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Tutup notifikasi');
  close.innerText = '×';
  close.addEventListener('click', () => dismissToast(toast));

  toast.append(icon, content, close);
  region.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  window.setTimeout(() => dismissToast(toast), type === 'error' ? 6500 : 4200);
}

function dismissToast(toast) {
  if (!toast.isConnected) return;
  toast.classList.remove('toast-visible');
  window.setTimeout(() => toast.remove(), 180);
}

function showAppDialog({
  title,
  message,
  type = 'info',
  confirmLabel = 'Mengerti',
  cancelLabel = '',
  copyText = ''
}) {
  const overlay = document.getElementById('appDialog');
  const heading = document.getElementById('appDialogTitle');
  const content = document.getElementById('appDialogMessage');
  const icon = document.getElementById('appDialogIcon');
  const confirmButton = document.getElementById('appDialogConfirm');
  const cancelButton = document.getElementById('appDialogCancel');
  const copyButton = document.getElementById('appDialogCopy');

  if (!overlay || activeDialogResolve) return Promise.resolve(false);

  heading.innerText = title;
  content.innerText = message;
  icon.className = `dialog-icon dialog-${type}`;
  icon.innerText = type === 'success' ? '✓' : type === 'warning' ? '!' : type === 'error' ? '!' : 'i';
  confirmButton.innerText = confirmLabel;
  cancelButton.innerText = cancelLabel || 'Batal';
  cancelButton.hidden = !cancelLabel;
  copyButton.hidden = !copyText;
  copyButton.dataset.copyText = copyText;
  dialogPreviousFocus = document.activeElement;
  overlay.hidden = false;
  document.body.classList.add('dialog-open');

  return new Promise(resolve => {
    activeDialogResolve = resolve;
    confirmButton.focus();
  });
}

function showConfirm(message, options = {}) {
  return showAppDialog({
    title: options.title || 'Konfirmasi tindakan',
    message,
    type: 'warning',
    confirmLabel: options.confirmLabel || 'Lanjutkan',
    cancelLabel: options.cancelLabel || 'Batal'
  });
}

function closeAppDialog(confirmed) {
  const overlay = document.getElementById('appDialog');
  if (!overlay || !activeDialogResolve) return;
  overlay.hidden = true;
  document.body.classList.remove('dialog-open');
  document.getElementById('appDialogMessage').innerText = '';
  document.getElementById('appDialogCopy').dataset.copyText = '';
  const resolve = activeDialogResolve;
  activeDialogResolve = null;
  resolve(confirmed);
  if (dialogPreviousFocus && dialogPreviousFocus.isConnected) dialogPreviousFocus.focus();
}

async function copyDialogText() {
  const text = document.getElementById('appDialogCopy').dataset.copyText;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Teks berhasil disalin ke clipboard.', 'success', 'Tersalin');
  } catch (error) {
    console.error('Gagal menyalin teks dialog:', error);
    showToast('Clipboard tidak tersedia. Pilih dan salin teks pada dialog.', 'warning', 'Salin manual');
  }
}

document.addEventListener('keydown', event => {
  if (!activeDialogResolve) return;
  if (event.key === 'Escape') {
    closeAppDialog(false);
    return;
  }
  if (event.key !== 'Tab') return;

  const overlay = document.getElementById('appDialog');
  const focusable = [...overlay.querySelectorAll('button:not([hidden]):not(:disabled)')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
