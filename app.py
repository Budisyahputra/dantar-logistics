import os
import io
import hmac
import hashlib
import re
import secrets
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, render_template, send_file, redirect, session, url_for
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash
import pandas as pd
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get('SECRET_KEY'),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=os.environ.get('SESSION_COOKIE_SECURE', 'false').lower() == 'true',
    PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
)

ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', '')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '')


def secure_equals(value, expected):
    return hmac.compare_digest(value.encode('utf-8'), expected.encode('utf-8'))


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get('admin_authenticated'):
            return jsonify({"error": "Login admin diperlukan"}), 401

        if request.method in {'POST', 'PUT', 'PATCH', 'DELETE'}:
            csrf_token = request.headers.get('X-CSRF-Token', '')
            session_token = session.get('csrf_token', '')
            if not csrf_token or not secure_equals(csrf_token, session_token):
                return jsonify({"error": "Token keamanan tidak valid"}), 403

        return view(*args, **kwargs)
    return wrapped


def corporate_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        account_id = session.get('corporate_id')
        account = db.session.get(CorporateAccount, account_id) if account_id else None
        if (
            not session.get('corporate_authenticated')
            or not account
            or not account.is_active
            or session.get('corporate_auth_hash') != account.password_hash
        ):
            session.clear()
            return jsonify({"error": "Login korporat diperlukan"}), 401

        if request.method in {'POST', 'PUT', 'PATCH', 'DELETE'}:
            csrf_token = request.headers.get('X-CSRF-Token', '')
            session_token = session.get('corporate_csrf_token', '')
            if not csrf_token or not secure_equals(csrf_token, session_token):
                return jsonify({"error": "Token keamanan tidak valid"}), 403

        return view(*args, **kwargs)
    return wrapped

# Menggunakan PostgreSQL dari Docker, atau fallback ke SQLite jika dijalankan lokal tanpa Docker
db_url = os.environ.get('DATABASE_URL', 'sqlite:///dantar_local.db')
if db_url and db_url.startswith('postgresql://'):
    db_url = db_url.replace('postgresql://', 'postgresql+psycopg2://', 1)

app.config['SQLALCHEMY_DATABASE_URI'] = db_url

db = SQLAlchemy(app)

# ==================== MODEL DATABASE ====================
class Shipment(db.Model):
    __tablename__ = 'shipments'
    id = db.Column(db.Integer, primary_key=True)
    resi = db.Column(db.String(40), unique=True, nullable=False, index=True)
    tipe = db.Column(db.String(10), nullable=False)        # B2B / B2C
    no_sj = db.Column(db.String(60), index=True)           # Nomor Surat Jalan (DO)
    no_po = db.Column(db.String(60), index=True)           # Nomor PO / Invoice
    pengirim = db.Column(db.String(150), nullable=False)
    penerima = db.Column(db.String(150), nullable=False)
    koli = db.Column(db.Integer, default=1)
    berat = db.Column(db.Float, default=1.0)
    cbm = db.Column(db.Float, default=0.1)
    armada = db.Column(db.String(120), default="Armada Terjadwal")
    status = db.Column(db.String(80), default="Manifested (Resi Baru)")
    status_pod = db.Column(db.String(120), default="Menunggu Pengiriman")
    riwayat = db.Column(db.Text, default="")               # Dipisahkan dengan ';'

    def to_dict(self):
        return {
            "resi": self.resi,
            "tipe": self.tipe,
            "sj": self.no_sj,
            "po": self.no_po,
            "pengirim": self.pengirim,
            "penerima": self.penerima,
            "koli": self.koli,
            "berat": self.berat,
            "cbm": self.cbm,
            "armada": self.armada,
            "status": self.status,
            "pod": self.status_pod,
            "riwayat": [r.strip() for r in (self.riwayat or "").split(";") if r.strip()]
        }

    def to_public_dict(self):
        return {
            "resi": self.resi,
            "tipe": self.tipe,
            "status": self.status,
        }


class CorporateAccount(db.Model):
    __tablename__ = 'corporate_accounts'
    id = db.Column(db.Integer, primary_key=True)
    company_name = db.Column(db.String(160), nullable=False)
    username = db.Column(db.String(50), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class ShipmentCorporateLink(db.Model):
    __tablename__ = 'shipment_corporate_links'
    shipment_id = db.Column(db.Integer, db.ForeignKey('shipments.id'), primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey('corporate_accounts.id'), nullable=False, index=True)


class CorporateLoginAttempt(db.Model):
    __tablename__ = 'corporate_login_attempts'
    id = db.Column(db.Integer, primary_key=True)
    attempt_key = db.Column(db.String(64), nullable=False, index=True)
    attempted_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)


class ShipmentTrackingCode(db.Model):
    __tablename__ = 'shipment_tracking_codes'
    shipment_id = db.Column(db.Integer, db.ForeignKey('shipments.id'), primary_key=True)
    code_hash = db.Column(db.String(64), nullable=False)


class TrackingCodeAttempt(db.Model):
    __tablename__ = 'tracking_code_attempts'
    id = db.Column(db.Integer, primary_key=True)
    shipment_id = db.Column(db.Integer, db.ForeignKey('shipments.id'), nullable=False, index=True)
    requester_hash = db.Column(db.String(64), nullable=False, index=True)
    attempted_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)


def hash_tracking_code(code):
    secret_key = app.config.get('SECRET_KEY')
    if not secret_key or secret_key.startswith('replace-with-'):
        raise RuntimeError('SECRET_KEY belum dikonfigurasi untuk kode akses pelacakan')
    return hmac.new(
        secret_key.encode('utf-8'),
        code.strip().upper().encode('utf-8'),
        hashlib.sha256
    ).hexdigest()


def new_tracking_code():
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    return ''.join(secrets.choice(alphabet) for _ in range(16))


def requester_hash():
    secret_key = app.config.get('SECRET_KEY')
    if not secret_key or secret_key.startswith('replace-with-'):
        raise RuntimeError('SECRET_KEY belum dikonfigurasi untuk kode akses pelacakan')
    address = request.remote_addr or 'unknown'
    return hmac.new(
        secret_key.encode('utf-8'),
        address.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()


def corporate_login_attempt_key(username):
    secret_key = app.config.get('SECRET_KEY')
    if not secret_key or secret_key.startswith('replace-with-'):
        raise RuntimeError('SECRET_KEY belum dikonfigurasi untuk login korporat')
    value = f"{username.strip().lower()}:{request.remote_addr or 'unknown'}"
    return hmac.new(secret_key.encode('utf-8'), value.encode('utf-8'), hashlib.sha256).hexdigest()


def store_tracking_code(shipment, code=None):
    code = code or new_tracking_code()
    access = db.session.get(ShipmentTrackingCode, shipment.id)
    if access:
        access.code_hash = hash_tracking_code(code)
    else:
        db.session.add(ShipmentTrackingCode(
            shipment_id=shipment.id,
            code_hash=hash_tracking_code(code)
        ))
    return code


def seed_initial_data():
    if Shipment.query.count() == 0:
        samples = [
            Shipment(
                resi="DAN-B2B-2611-0001", tipe="B2B", no_sj="SJ-2026-881", no_po="PO-9901",
                pengirim="PT Tekstil Makmur (Bandung)", penerima="Gudang Garmen Nusantara (Jakarta)",
                koli=24, berat=680, cbm=4.2, armada="CDD Box B 9412 TX (Pak Hendra)",
                status="Delivered (Terkirim)", status_pod="POD Selesai (Stempel Basah Gudang)",
                riwayat="05 Nov 2026 14:20 - Diterima Gudang Garmen (24 Koli lengkap, SJ distempel basah); 05 Nov 2026 08:15 - Truk CDD berangkat menuju Jakarta; 04 Nov 2026 17:40 - Muatan 24 Koli diverifikasi sesuai SJ-2026-881"
            ),
            Shipment(
                resi="DAN-B2B-2611-0002", tipe="B2B", no_sj="SJ-2026-882", no_po="PO-9902",
                pengirim="CV Baja Presisi (Bekasi)", penerima="PT Konstruksi Utama (Semarang)",
                koli=12, berat=1450, cbm=6.0, armada="Fuso Box B 9801 KJG (Pak Wahyu)",
                status="In Transit (Lintas Kota)", status_pod="Menunggu Bongkar Muat di Tujuan",
                riwayat="06 Nov 2026 11:30 - Melintas Tol Cipali menuju Hub Semarang; 05 Nov 2026 19:15 - Pickup 12 Palet selesai di pabrik CV Baja Presisi"
            ),
            Shipment(
                resi="DAN-B2C-2611-0101", tipe="B2C", no_sj="-", no_po="INV-771",
                pengirim="Kopi Nusantara (Jakarta)", penerima="Budi Santoso (Depok)",
                koli=1, berat=3, cbm=0.02, armada="Kurir Motor Express (Rian)",
                status="Delivered (Terkirim)", status_pod="Foto Bukti Paket Diterima",
                riwayat="06 Nov 2026 15:40 - Paket diterima langsung oleh Budi Santoso; 06 Nov 2026 09:00 - Dibawa kurir menuju alamat Depok"
            )
        ]
        db.session.add_all(samples)
        db.session.commit()

with app.app_context():
    try:
        db.create_all()
        seed_initial_data()
    except Exception as e:
        db.session.rollback()
        print(f"DB Init Notice: {e}")

# ==================== ROUTES & REST API ====================
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    if not app.config['SECRET_KEY'] or app.config['SECRET_KEY'].startswith('replace-with-'):
        return render_template(
            'admin_login.html',
            csrf_token='',
            error='Login belum tersedia. Atur SECRET_KEY pada konfigurasi environment.',
            disabled=True
        ), 503

    if not ADMIN_USERNAME or not ADMIN_PASSWORD or ADMIN_PASSWORD.startswith('replace-with-'):
        return render_template(
            'admin_login.html',
            csrf_token='',
            error='Login belum dikonfigurasi. Atur ADMIN_USERNAME dan ADMIN_PASSWORD pada file .env.',
            disabled=True
        ), 503

    if session.get('admin_authenticated') and request.method == 'GET':
        return redirect(url_for('index', admin='1'))

    if request.method == 'POST':
        csrf_token = request.form.get('csrf_token', '')
        session_token = session.get('csrf_token', '')
        if not csrf_token or not secure_equals(csrf_token, session_token):
            return render_template(
                'admin_login.html',
                csrf_token=session_token,
                error='Sesi formulir tidak valid. Muat ulang halaman dan coba lagi.',
                disabled=False
            ), 400

        username = request.form.get('username', '')
        password = request.form.get('password', '')
        valid_username = secure_equals(username, ADMIN_USERNAME)
        valid_password = secure_equals(password, ADMIN_PASSWORD)
        if valid_username and valid_password:
            session.clear()
            session.permanent = True
            session['admin_authenticated'] = True
            session['csrf_token'] = secrets.token_urlsafe(32)
            return redirect(url_for('index', admin='1'))

        return render_template(
            'admin_login.html',
            csrf_token=session_token,
            error='Nama pengguna atau kata sandi tidak sesuai.',
            disabled=False
        ), 401

    session['csrf_token'] = secrets.token_urlsafe(32)
    return render_template(
        'admin_login.html',
        csrf_token=session['csrf_token'],
        error='',
        disabled=False
    )

@app.route('/admin/logout', methods=['POST'])
def admin_logout():
    csrf_token = request.headers.get('X-CSRF-Token', '')
    session_token = session.get('csrf_token', '')
    if not session.get('admin_authenticated'):
        return jsonify({"error": "Login admin diperlukan"}), 401
    if not csrf_token or not secure_equals(csrf_token, session_token):
        return jsonify({"error": "Token keamanan tidak valid"}), 403

    session.clear()
    return jsonify({"message": "Logout berhasil"})

@app.route('/corporate/login', methods=['GET', 'POST'])
def corporate_login():
    if not app.config.get('SECRET_KEY') or app.config['SECRET_KEY'].startswith('replace-with-'):
        return render_template(
            'corporate_login.html',
            csrf_token='',
            error='Login korporat belum tersedia. Atur SECRET_KEY pada environment.',
            disabled=True
        ), 503

    if session.get('corporate_authenticated') and request.method == 'GET':
        return redirect(url_for('corporate_portal'))

    if request.method == 'POST':
        csrf_token = request.form.get('csrf_token', '')
        session_token = session.get('corporate_login_csrf_token', '')
        if not csrf_token or not secure_equals(csrf_token, session_token):
            return render_template(
                'corporate_login.html',
                csrf_token=session_token,
                error='Sesi formulir tidak valid. Muat ulang halaman dan coba lagi.',
                disabled=False
            ), 400

        username = request.form.get('username', '').strip().lower()
        try:
            attempt_key = corporate_login_attempt_key(username)
        except RuntimeError as error:
            return render_template(
                'corporate_login.html',
                csrf_token=session_token,
                error=str(error),
                disabled=True
            ), 503

        now = datetime.utcnow()
        db.session.query(CorporateLoginAttempt).filter(
            CorporateLoginAttempt.attempted_at < now - timedelta(days=1)
        ).delete(synchronize_session=False)
        recent_attempts = CorporateLoginAttempt.query.filter(
            CorporateLoginAttempt.attempt_key == attempt_key,
            CorporateLoginAttempt.attempted_at >= now - timedelta(minutes=15)
        ).count()
        if recent_attempts >= 5:
            db.session.commit()
            return render_template(
                'corporate_login.html',
                csrf_token=session_token,
                error='Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.',
                disabled=False
            ), 429

        account = CorporateAccount.query.filter_by(username=username, is_active=True).first()
        if not account or not check_password_hash(account.password_hash, request.form.get('password', '')):
            db.session.add(CorporateLoginAttempt(attempt_key=attempt_key, attempted_at=now))
            db.session.commit()
            session['corporate_login_csrf_token'] = secrets.token_urlsafe(32)
            return render_template(
                'corporate_login.html',
                csrf_token=session['corporate_login_csrf_token'],
                error='Nama pengguna atau kata sandi tidak sesuai.',
                disabled=False
            ), 401

        session.clear()
        session.permanent = True
        session['corporate_authenticated'] = True
        session['corporate_id'] = account.id
        session['corporate_auth_hash'] = account.password_hash
        session['corporate_csrf_token'] = secrets.token_urlsafe(32)
        return redirect(url_for('corporate_portal'))

    session['corporate_login_csrf_token'] = secrets.token_urlsafe(32)
    return render_template(
        'corporate_login.html',
        csrf_token=session['corporate_login_csrf_token'],
        error='',
        disabled=False
    )

@app.route('/corporate')
def corporate_portal():
    account_id = session.get('corporate_id')
    if not session.get('corporate_authenticated') or not account_id:
        return redirect(url_for('corporate_login'))
    account = db.session.get(CorporateAccount, account_id)
    if (
        not account
        or not account.is_active
        or session.get('corporate_auth_hash') != account.password_hash
    ):
        session.clear()
        return redirect(url_for('corporate_login'))
    return render_template('corporate_portal.html', company_name=account.company_name)

@app.route('/corporate/logout', methods=['POST'])
def corporate_logout():
    if not session.get('corporate_authenticated'):
        return jsonify({"error": "Login korporat diperlukan"}), 401
    csrf_token = request.headers.get('X-CSRF-Token', '')
    session_token = session.get('corporate_csrf_token', '')
    if not csrf_token or not secure_equals(csrf_token, session_token):
        return jsonify({"error": "Token keamanan tidak valid"}), 403
    session.clear()
    return jsonify({"message": "Logout berhasil"})

@app.route('/api/corporate/session')
def corporate_session():
    account_id = session.get('corporate_id')
    account = db.session.get(CorporateAccount, account_id) if account_id else None
    authenticated = bool(
        session.get('corporate_authenticated')
        and account
        and account.is_active
        and session.get('corporate_auth_hash') == account.password_hash
    )
    if session.get('corporate_authenticated') and not authenticated:
        session.clear()
    return jsonify({
        "authenticated": authenticated,
        "company_name": account.company_name if authenticated else None,
        "csrf_token": session.get('corporate_csrf_token') if authenticated else None
    })

@app.route('/api/corporate/shipments')
@corporate_required
def corporate_shipments():
    account_id = session['corporate_id']
    account = db.session.get(CorporateAccount, account_id)
    if not account or not account.is_active:
        session.clear()
        return jsonify({"error": "Akun korporat tidak aktif"}), 401

    shipments = Shipment.query.join(
        ShipmentCorporateLink,
        ShipmentCorporateLink.shipment_id == Shipment.id
    ).filter(
        ShipmentCorporateLink.company_id == account_id,
        Shipment.tipe == 'B2B'
    ).order_by(Shipment.id.desc()).all()
    return jsonify([{"id": item.id, **item.to_dict()} for item in shipments])

@app.route('/api/admin/session', methods=['GET'])
def admin_session():
    authenticated = bool(session.get('admin_authenticated'))
    return jsonify({
        "authenticated": authenticated,
        "csrf_token": session.get('csrf_token') if authenticated else None
    })

@app.route('/api/shipments', methods=['GET'])
@admin_required
def get_all_shipments():
    items = Shipment.query.order_by(Shipment.id.desc()).all()
    links = {
        link.shipment_id: link.company_id
        for link in ShipmentCorporateLink.query.all()
    }
    companies = {
        account.id: account.company_name
        for account in CorporateAccount.query.all()
    }
    return jsonify([
        {
            **item.to_dict(),
            "id": item.id,
            "company_id": links.get(item.id),
            "company_name": companies.get(links.get(item.id))
        }
        for item in items
    ])

@app.route('/api/companies', methods=['GET', 'POST'])
@admin_required
def manage_companies():
    if request.method == 'GET':
        return jsonify([
            {
                "id": account.id,
                "company_name": account.company_name,
                "username": account.username,
                "is_active": account.is_active
            }
            for account in CorporateAccount.query.order_by(CorporateAccount.company_name).all()
        ])

    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        return jsonify({"error": "Format permintaan tidak valid."}), 400
    company_name = str(body.get('company_name', '')).strip()
    username = str(body.get('username', '')).strip().lower()
    password = str(body.get('password', ''))
    if not company_name or len(company_name) > 160:
        return jsonify({"error": "Nama perusahaan wajib diisi (maksimal 160 karakter)."}), 400
    if not re.fullmatch(r'[a-z0-9][a-z0-9._-]{2,49}', username):
        return jsonify({"error": "Username 3-50 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung."}), 400
    if len(password) < 12:
        return jsonify({"error": "Password awal harus minimal 12 karakter."}), 400
    if CorporateAccount.query.filter(
        db.func.lower(CorporateAccount.username) == username
    ).first():
        return jsonify({"error": "Username sudah digunakan."}), 409

    account = CorporateAccount(
        company_name=company_name,
        username=username,
        password_hash=generate_password_hash(password)
    )
    db.session.add(account)
    db.session.commit()
    return jsonify({
        "message": "Akun korporat berhasil dibuat.",
        "account": {
            "id": account.id,
            "company_name": account.company_name,
            "username": account.username,
            "is_active": account.is_active
        }
    }), 201

@app.route('/api/companies/<int:company_id>/reset-password', methods=['POST'])
@admin_required
def reset_corporate_password(company_id):
    account = db.session.get(CorporateAccount, company_id)
    if not account:
        return jsonify({"error": "Akun perusahaan tidak ditemukan."}), 404
    temporary_password = secrets.token_urlsafe(18)
    account.password_hash = generate_password_hash(temporary_password)
    db.session.commit()
    return jsonify({
        "message": "Password baru hanya ditampilkan kali ini.",
        "username": account.username,
        "temporary_password": temporary_password
    })

@app.route('/api/admin/shipments/<int:shipment_id>/company', methods=['POST'])
@admin_required
def link_shipment_company(shipment_id):
    shipment = db.session.get(Shipment, shipment_id)
    if not shipment:
        return jsonify({"error": "Kiriman tidak ditemukan."}), 404
    if shipment.tipe != 'B2B':
        return jsonify({"error": "Hanya kiriman B2B yang dapat ditautkan ke akun korporat."}), 400

    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        return jsonify({"error": "Format permintaan tidak valid."}), 400
    company_id = body.get('company_id')
    link = db.session.get(ShipmentCorporateLink, shipment.id)
    if company_id in (None, ''):
        if link:
            db.session.delete(link)
        db.session.commit()
        return jsonify({"message": "Tautan perusahaan dihapus.", "company_id": None})

    try:
        company_id = int(company_id)
    except (TypeError, ValueError):
        return jsonify({"error": "Akun perusahaan tidak valid."}), 400
    account = db.session.get(CorporateAccount, company_id)
    if not account or not account.is_active:
        return jsonify({"error": "Akun perusahaan tidak ditemukan atau tidak aktif."}), 404
    if link:
        link.company_id = account.id
    else:
        db.session.add(ShipmentCorporateLink(shipment_id=shipment.id, company_id=account.id))
    db.session.commit()
    return jsonify({
        "message": "Kiriman berhasil ditautkan.",
        "company_id": account.id,
        "company_name": account.company_name
    })

@app.route('/api/track', methods=['GET'])
def track_shipment():
    q = request.args.get('q', '').strip().upper()
    if not q:
        return jsonify({"found": False, "message": "Masukkan nomor pencarian"}), 400

    item = Shipment.query.filter(
        (db.func.upper(Shipment.resi) == q) |
        (db.func.upper(Shipment.no_sj) == q) |
        (db.func.upper(Shipment.no_po) == q)
    ).first()

    if not item:
        return jsonify({"found": False, "message": "Data Resi / Surat Jalan / PO tidak ditemukan"}), 404

    return jsonify({"found": True, "data": item.to_public_dict()})

@app.route('/api/track/verify', methods=['POST'])
def verify_tracking_code():
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        return jsonify({"error": "Format permintaan tidak valid"}), 400
    q = str(body.get('q', '')).strip().upper()
    code = str(body.get('code', '')).strip()
    if not q or len(q) > 100 or len(code) != 16:
        return jsonify({"error": "Nomor kiriman dan kode akses wajib diisi"}), 400

    item = Shipment.query.filter(
        (db.func.upper(Shipment.resi) == q) |
        (db.func.upper(Shipment.no_sj) == q) |
        (db.func.upper(Shipment.no_po) == q)
    ).first()
    if not item:
        return jsonify({"error": "Kiriman atau kode akses tidak valid"}), 404
    if item.tipe != 'B2C':
        return jsonify({"error": "Detail B2B hanya tersedia melalui Portal Korporat."}), 403

    if not app.config.get('SECRET_KEY') or app.config['SECRET_KEY'].startswith('replace-with-'):
        return jsonify({"error": "Verifikasi kode akses belum dikonfigurasi"}), 503

    now = datetime.utcnow()
    window_start = now - timedelta(minutes=15)
    remote_hash = requester_hash()
    db.session.query(TrackingCodeAttempt).filter(
        TrackingCodeAttempt.attempted_at < now - timedelta(days=1)
    ).delete(synchronize_session=False)
    attempt_count = TrackingCodeAttempt.query.filter(
        TrackingCodeAttempt.requester_hash == remote_hash,
        TrackingCodeAttempt.attempted_at >= window_start
    ).count()
    shipment_attempt_count = TrackingCodeAttempt.query.filter(
        TrackingCodeAttempt.shipment_id == item.id,
        TrackingCodeAttempt.requester_hash == remote_hash,
        TrackingCodeAttempt.attempted_at >= window_start
    ).count()
    if attempt_count >= 10 or shipment_attempt_count >= 5:
        db.session.commit()
        return jsonify({"error": "Terlalu banyak percobaan. Coba lagi dalam 15 menit."}), 429

    db.session.add(TrackingCodeAttempt(
        shipment_id=item.id,
        requester_hash=remote_hash,
        attempted_at=now
    ))
    db.session.commit()

    access = db.session.get(ShipmentTrackingCode, item.id)
    if not access or not hmac.compare_digest(access.code_hash, hash_tracking_code(code)):
        return jsonify({"error": "Kiriman atau kode akses tidak valid"}), 403

    return jsonify({"verified": True, "data": item.to_dict()})

@app.route('/api/shipments', methods=['POST'])
@admin_required
def create_shipment():
    if not app.config.get('SECRET_KEY') or app.config['SECRET_KEY'].startswith('replace-with-'):
        return jsonify({"error": "SECRET_KEY belum dikonfigurasi untuk membuat kode akses"}), 503

    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        return jsonify({"error": "Format permintaan tidak valid."}), 400
    tipe = str(body.get('tipe', 'B2B')).strip().upper()
    if tipe not in {'B2B', 'B2C'}:
        return jsonify({"error": "Tipe kiriman harus B2B atau B2C."}), 400
    company = None
    if tipe == 'B2B':
        try:
            company_id = int(body.get('company_id', 0))
        except (TypeError, ValueError):
            company_id = 0
        company = db.session.get(CorporateAccount, company_id) if company_id else None
        if not company or not company.is_active:
            return jsonify({"error": "Pilih akun perusahaan aktif untuk kiriman B2B."}), 400
    yymm = datetime.now().strftime('%y%m')
    urut = Shipment.query.count() + 1
    kode_resi = f"DAN-{tipe}-{yymm}-{urut:04d}"

    berat = float(body.get('berat', 10))
    cbm = round(berat / 250.0, 2)
    waktu = datetime.now().strftime('%d %b %Y %H:%M')

    baru = Shipment(
        resi=kode_resi,
        tipe=tipe,
        no_sj=str(body.get('sj') or '-').strip(),
        no_po=str(body.get('po') or f'PO-AUTO-{urut:04d}').strip(),
        pengirim=str(body.get('pengirim') or 'Vendor Pengirim').strip(),
        penerima=str(body.get('penerima') or 'Gudang Penerima').strip(),
        koli=int(body.get('koli', 1)),
        berat=berat,
        cbm=cbm,
        armada="CDE Engkel Box (Terjadwal)" if tipe == "B2B" else "Kurir D'Antar Reguler",
        status="Manifested (Resi Baru)",
        status_pod="Menunggu Pengiriman",
        riwayat=f"{waktu} - Resi {kode_resi} diterbitkan secara otomatis oleh sistem"
    )
    db.session.add(baru)
    db.session.flush()
    if company:
        db.session.add(ShipmentCorporateLink(shipment_id=baru.id, company_id=company.id))
    tracking_code = store_tracking_code(baru) if tipe == 'B2C' else None
    db.session.commit()
    return jsonify({
        "message": "Resi berhasil dibuat",
        "data": baru.to_dict(),
        "tracking_code": tracking_code
    }), 201

@app.route('/api/shipments/<int:shipment_id>/tracking-code', methods=['POST'])
@admin_required
def issue_tracking_code(shipment_id):
    shipment = db.session.get(Shipment, shipment_id)
    if not shipment:
        return jsonify({"error": "Kiriman tidak ditemukan"}), 404
    if shipment.tipe != 'B2C':
        return jsonify({"error": "Kiriman B2B menggunakan akses Portal Korporat."}), 400

    try:
        code = store_tracking_code(shipment)
        db.session.commit()
    except RuntimeError as error:
        db.session.rollback()
        return jsonify({"error": str(error)}), 503

    return jsonify({
        "message": "Kode akses baru dibuat. Kode hanya ditampilkan kali ini.",
        "resi": shipment.resi,
        "tracking_code": code
    })

@app.route('/api/upload-excel', methods=['POST'])
@admin_required
def upload_excel():
    if 'file' not in request.files:
        return jsonify({"error": "File Excel tidak ditemukan"}), 400

    file = request.files['file']
    try:
        df = pd.read_excel(file).fillna("-")
        inserted, updated = 0, 0

        for _, row in df.iterrows():
            resi_code = str(row.get('No_Resi', '')).strip().upper()
            if not resi_code or resi_code == "-":
                continue

            existing = Shipment.query.filter_by(resi=resi_code).first()
            if existing:
                existing.status = str(row.get('Status', existing.status)).strip()
                existing.status_pod = str(row.get('Status_POD', existing.status_pod)).strip()
                existing.armada = str(row.get('Armada', existing.armada)).strip()
                existing.riwayat = str(row.get('Riwayat', existing.riwayat)).strip()
                updated += 1
            else:
                baru = Shipment(
                    resi=resi_code,
                    tipe=str(row.get('Tipe', 'B2B')).strip().upper(),
                    no_sj=str(row.get('No_SJ', '-')).strip(),
                    no_po=str(row.get('No_PO', '-')).strip(),
                    pengirim=str(row.get('Pengirim', '-')).strip(),
                    penerima=str(row.get('Penerima', '-')).strip(),
                    koli=int(float(row.get('Koli', 1))) if str(row.get('Koli', '')).replace('.','',1).isdigit() else 1,
                    berat=float(row.get('Berat_Kg', 1.0)) if str(row.get('Berat_Kg', '')).replace('.','',1).isdigit() else 1.0,
                    cbm=float(row.get('Volume_CBM', 0.1)) if str(row.get('Volume_CBM', '')).replace('.','',1).isdigit() else 0.1,
                    armada=str(row.get('Armada', 'Armada Terjadwal')).strip(),
                    status=str(row.get('Status', 'Manifested')).strip(),
                    status_pod=str(row.get('Status_POD', 'Menunggu Pengiriman')).strip(),
                    riwayat=str(row.get('Riwayat', 'Data diimpor dari Master Excel')).strip()
                )
                db.session.add(baru)
                inserted += 1

        db.session.commit()
        return jsonify({
            "message": f"Sinkronisasi selesai: {inserted} resi baru ditambahkan, {updated} resi diperbarui."
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Gagal memproses Excel: {str(e)}"}), 500

@app.route('/api/export-excel', methods=['GET'])
@admin_required
def export_excel():
    items = Shipment.query.order_by(Shipment.id.asc()).all()
    rows = [{
        "No_Resi": i.resi, "Tipe": i.tipe, "No_SJ": i.no_sj, "No_PO": i.no_po,
        "Pengirim": i.pengirim, "Penerima": i.penerima, "Koli": i.koli,
        "Berat_Kg": i.berat, "Volume_CBM": i.cbm, "Armada": i.armada,
        "Status": i.status, "Status_POD": i.status_pod, "Riwayat": i.riwayat
    } for i in items]

    df = pd.DataFrame(rows)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Data_DAntar')
    output.seek(0)

    return send_file(
        output,
        download_name="Master_Data_DAntar_Logistik.xlsx",
        as_attachment=True
    )

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=True)