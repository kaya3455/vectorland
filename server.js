const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { trace } = require('potrace');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const app = express();
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Allowed raster formats (sharp metadata.format)
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'tiff', 'gif', 'bmp']);

// Helper: write temp file
function writeTempFile(prefix, ext, buffer) {
  const id = uuidv4();
  const filename = `${prefix}-${id}.${ext}`;
  const full = path.join(tmpDir, filename);
  fs.writeFileSync(full, buffer);
  return full;
}

// Cleanup temp files older than MAX_AGE_MS periodically
const MAX_AGE_MS = 1000 * 60 * 60; // 1 hour
setInterval(() => {
  try {
    const files = fs.readdirSync(tmpDir);
    const now = Date.now();
    for (const f of files) {
      try {
        const full = path.join(tmpDir, f);
        const stat = fs.statSync(full);
        if (now - stat.mtimeMs > MAX_AGE_MS) {
          fs.unlinkSync(full);
        }
      } catch (e) {
        // ignore individual errors
      }
    }
  } catch (e) {
    console.error('Cleanup failed', e);
  }
}, 1000 * 60 * 30); // run every 30 minutes

// Helper to parse boolean-ish values from form
function parseBool(v) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

// POST /api/vectorize
// Accepts form-data:
// - image (file)
// - turdSize (number, optional)
// - optCurve (bool, optional)
// - threshold (number 0..1, optional)
// - turnPolicy (string: black|white|left|right|minority, optional)
// - maxWidth (number, optional)
app.post('/api/vectorize', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Basic validation: check image format using sharp.metadata
    let metadata;
    try {
      metadata = await sharp(req.file.buffer).metadata();
    } catch (e) {
      return res.status(400).json({ error: 'Uploaded file is not a valid image' });
    }
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
      return res.status(400).json({ error: `Unsupported image format: ${metadata.format}` });
    }

    // Read and sanitize options from form fields
    const turdSize = Number.isFinite(Number(req.body.turdSize)) ? Math.max(0, Math.floor(Number(req.body.turdSize))) : undefined;
    const optCurve = parseBool(req.body.optCurve);
    const threshold = Number.isFinite(Number(req.body.threshold)) ? Number(req.body.threshold) : undefined;
    const turnPolicy = typeof req.body.turnPolicy === 'string' && req.body.turnPolicy.length > 0 ? req.body.turnPolicy : undefined;
    const maxWidth = Number.isFinite(Number(req.body.maxWidth)) ? Math.max(64, Math.floor(Number(req.body.maxWidth))) : 2048;

    // Preprocess with sharp: normalize, limit max width for performance
    const pngBuffer = await sharp(req.file.buffer)
      .ensureAlpha()
      .flatten({ background: '#ffffff' })
      .resize({ width: maxWidth, withoutEnlargement: true })
      .png()
      .toBuffer();

    // Build potrace options object with safe values
    const potraceOptions = { color: 'black', background: 'white' };
    if (turdSize !== undefined) potraceOptions.turdSize = turdSize;
    if (optCurve !== undefined) potraceOptions.optCurve = !!optCurve;
    if (threshold !== undefined) {
      // potrace npm accepts 'threshold' 0..255 or 'threshold' function; here use 0..1 -> 0..255
      const t = Math.max(0, Math.min(1, Number(threshold)));
      potraceOptions.threshold = Math.round(t * 255);
    }
    if (turnPolicy) {
      // Accept human-friendly values; Potrace accepts strings in many bindings
      const allowedPolicies = ['black', 'white', 'left', 'right', 'minority'];
      if (allowedPolicies.includes(turnPolicy)) potraceOptions.turnPolicy = turnPolicy;
    }

    trace(pngBuffer, potraceOptions, (err, svg) => {
      if (err) {
        console.error('Potrace error', err);
        return res.status(500).json({ error: 'Vectorization failed' });
      }

      const svgPath = writeTempFile('out', 'svg', Buffer.from(svg));
      const id = path.basename(svgPath, '.svg').replace(/^out-/, '');

      res.json({
        id,
        svg,
        options: potraceOptions,
        downloads: {
          svg: `/download/${id}.svg`,
          pdf: `/download/${id}.pdf`,
          eps: `/download/${id}.eps`
        }
      });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /download/:id.ext
app.get('/download/:file', async (req, res) => {
  const requested = req.params.file;
  const m = requested.match(/^([0-9a-fA-F-]+)\.(svg|pdf|eps)$/);
  if (!m) return res.status(400).send('Bad request');

  const id = m[1];
  const ext = m[2];
  const svgPath = path.join(tmpDir, `out-${id}.svg`);
  if (!fs.existsSync(svgPath)) return res.status(404).send('Not found');

  if (ext === 'svg') {
    res.type('image/svg+xml');
    return fs.createReadStream(svgPath).pipe(res);
  }

  const outPath = path.join(tmpDir, `${id}.${ext}`);
  if (fs.existsSync(outPath)) {
    return res.download(outPath);
  }

  const exportType = ext === 'pdf' ? 'pdf' : 'eps';
  const args = [svgPath, `--export-type=${exportType}`, `--export-filename=${outPath}`];

  execFile('inkscape', args, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('Inkscape conversion failed', err, stderr);
      return res.status(500).send('Conversion failed: ensure Inkscape is installed on server');
    }
    res.download(outPath);
  });
});

// Lightweight temp cleanup endpoint (demo-only)
app.post('/cleanup', (req, res) => {
  try {
    const files = fs.readdirSync(tmpDir);
    for (const f of files) {
      try { fs.unlinkSync(path.join(tmpDir, f)); } catch (e) {}
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Cleanup failed' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Vectorizer server listening on ${port}`));