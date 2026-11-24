export default function SetupPage() {
  return (
    <html lang="id">
      <head>
        <title>Setup HTTPS — ECamScanner</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, sans-serif; background: #f9fafb; color: #111; padding: 24px 16px 48px; max-width: 480px; margin: 0 auto; }
          h1 { font-size: 22px; font-weight: 700; color: #1d4ed8; margin-bottom: 6px; }
          .sub { color: #6b7280; font-size: 14px; margin-bottom: 28px; }
          h2 { font-size: 15px; font-weight: 600; margin-bottom: 10px; color: #111827; }
          .card { background: white; border-radius: 16px; padding: 18px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); border: 1px solid #e5e7eb; }
          ol { padding-left: 20px; }
          li { font-size: 14px; line-height: 1.7; color: #374151; margin-bottom: 4px; }
          li b { color: #111827; }
          .btn { display: block; background: #2563eb; color: white; text-align: center; padding: 14px; border-radius: 12px; font-size: 16px; font-weight: 600; text-decoration: none; margin-bottom: 12px; }
          .btn2 { display: block; background: #f3f4f6; color: #374151; text-align: center; padding: 14px; border-radius: 12px; font-size: 15px; font-weight: 500; text-decoration: none; border: 1px solid #d1d5db; }
          .note { background: #fef3c7; border: 1px solid #fcd34d; border-radius: 10px; padding: 12px 14px; font-size: 13px; color: #92400e; margin-top: 16px; line-height: 1.5; }
          .tag { display: inline-block; background: #dbeafe; color: #1d4ed8; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 6px; margin-bottom: 8px; }
        `}</style>
      </head>
      <body>
        <h1>📱 Setup Kamera di HP</h1>
        <p className="sub">Ikuti langkah berikut agar kamera bisa digunakan</p>

        <div className="card">
          <span className="tag">Langkah 1</span>
          <h2>Download &amp; Install Sertifikat</h2>
          <p style={{fontSize:14, color:'#6b7280', marginBottom:14, lineHeight:1.6}}>
            Sertifikat ini diperlukan agar HP mempercayai koneksi HTTPS lokal dari Mac Anda.
          </p>
          <a className="btn" href="/rootCA.crt" download="ECamScanner-CA.crt">
            ⬇️ Download Sertifikat CA
          </a>
          <div className="note">
            Setelah download, buka file tersebut dan ikuti instruksi di langkah 2.
          </div>
        </div>

        <div className="card">
          <span className="tag">Langkah 2 — Android</span>
          <h2>Install di Android</h2>
          <ol>
            <li>Buka file <b>ECamScanner-CA.crt</b> yang sudah didownload</li>
            <li>Jika tidak langsung terbuka, buka <b>Pengaturan → Keamanan → Enkripsi &amp; Kredensial</b></li>
            <li>Pilih <b>Pasang sertifikat → CA certificate</b></li>
            <li>Pilih file <b>ECamScanner-CA.crt</b></li>
            <li>Konfirmasi dengan PIN/password perangkat</li>
            <li>Buka Chrome → ketuk ikon 🔒 → pastikan <b>Koneksi aman</b></li>
          </ol>
        </div>

        <div className="card">
          <span className="tag">Langkah 2 — iPhone / iPad</span>
          <h2>Install di iOS / iPadOS</h2>
          <ol>
            <li>Setelah download, buka <b>Pengaturan</b></li>
            <li>Akan muncul notifikasi <b>&quot;Profil telah diunduh&quot;</b> — ketuk</li>
            <li>Ketuk <b>Pasang</b> di sudut kanan atas, masukkan passcode</li>
            <li>Buka <b>Pengaturan → Umum → Tentang → Pengaturan Kepercayaan Sertifikat</b></li>
            <li>Aktifkan toggle di sebelah <b>mkcert...</b></li>
            <li>Ketuk <b>Lanjutkan</b> pada dialog konfirmasi</li>
          </ol>
        </div>

        <div className="card">
          <span className="tag">Langkah 3</span>
          <h2>Buka Aplikasi</h2>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="btn2" href="/">
            🔙 Kembali ke ECamScanner
          </a>
          <p style={{fontSize:13, color:'#9ca3af', marginTop:10, textAlign:'center'}}>
            Pastikan HP dan Mac terhubung ke WiFi yang sama
          </p>
        </div>
      </body>
    </html>
  );
}
