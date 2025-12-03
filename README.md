```markdown
# Image Vectorizer (demo) — Geliştirilmiş

Bu proje raster görselleri SVG'ye vektörize eder ve SVG'den PDF/EPS üretip indirme sağlar. Bu sürümde kullanıcı Potrace parametrelerini UI üzerinden ayarlayabilir; sunucu dosya formatını doğrular ve tmp dizininde otomatik temizleme yapar.

Hızlı kurulum (lokal)
1. Inkscape'in komut satırı sürümü sisteminizde bulunmalı (inkscape).
2. Node.js 18+ kurulu olmalı.
3. Terminalde:
   cd backend
   npm install
   npm start
4. Tarayıcıda http://localhost:3000 açın.

Yeni özellikler
- UI üzerinden Potrace parametreleri: turdSize, optCurve, threshold, turnPolicy, maxWidth.
- Sunucu tarafında resim format doğrulama (sharp metadata).
- Temp dosyaları 1 saatten eskiyse otomatik temizleme (30 dakikada bir çalışır).
- İndirilecek formatları UI'den seçebilme (SVG/PDF/EPS).

API
- POST /api/vectorize (multipart/form-data)
  - image (file) (required)
  - turdSize (number, optional)
  - optCurve (bool, optional, '1'/'true')
  - threshold (0.0 - 1.0, optional)
  - turnPolicy (black|white|left|right|minority, optional)
  - maxWidth (number, optional)
  - returns: { id, svg, options, downloads: { svg, pdf, eps } }

- GET /download/:id.svg|pdf|eps
  - Returns generated file. SVG returned directly; PDF/EPS converted on-demand via Inkscape.

Notlar & sonraki adımlar önerileri
- Prod için: kullanıcı başına quota, rate-limiting, job queue (BullMQ + Redis) ve background worker, upload scanning, HTTPS ve auth.
- Büyük hacimlerde Inkscape'i daha ölçekli bir worker havuzunda kullanmak mantıklı.
- Potrace seçeneklerini genişletmek veya UI'ye canlı önizleme (küçük önizleme + parametre değişince re-trace) eklemek faydalı olur.
```
