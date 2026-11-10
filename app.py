import os
import io
from datetime import datetime
from flask import Flask, request, jsonify, render_template, send_file
from flask_sqlalchemy import SQLAlchemy
import pandas as pd

app = Flask(__name__)

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

@app.route('/api/shipments', methods=['GET'])
def get_all_shipments():
    items = Shipment.query.order_by(Shipment.id.desc()).all()
    return jsonify([i.to_dict() for i in items])

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

    return jsonify({"found": True, "data": item.to_dict()})

@app.route('/api/shipments', methods=['POST'])
def create_shipment():
    body = request.json or {}
    tipe = str(body.get('tipe', 'B2B')).strip().upper()
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
    db.session.commit()
    return jsonify({"message": "Resi berhasil dibuat", "data": baru.to_dict()}), 201

@app.route('/api/upload-excel', methods=['POST'])
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