FROM python:3.11-slim

WORKDIR /app

# Instal dependensi sistem untuk kompilasi psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# --preload memastikan inisialisasi tabel & seed DB hanya dieksekusi sekali oleh master process
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "4", "--preload", "app:app"]