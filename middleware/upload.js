const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const MAX_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '10');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function makeStorage(subdir) {
  return multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(__dirname, '..', 'public', 'uploads', subdir);
      ensureDir(dir);
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext  = path.extname(file.originalname).toLowerCase();
      const base = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      cb(null, `${base}${ext}`);
    },
  });
}

function imageFilter(req, file, cb) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(new Error(`Invalid file type: ${file.mimetype}. Only images are allowed.`));
}

const logoUpload = multer({
  storage: makeStorage('logos'),
  fileFilter: imageFilter,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

const templateUpload = multer({
  storage: makeStorage('templates'),
  fileFilter: imageFilter,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

const assetUpload = multer({
  storage: makeStorage('assets'),
  fileFilter: imageFilter,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

// Generic single field uploader
function single(subdir, field = 'file') {
  return multer({
    storage: makeStorage(subdir),
    fileFilter: imageFilter,
    limits: { fileSize: MAX_MB * 1024 * 1024 },
  }).single(field);
}

// Media filter — accepts images + video
function mediaFilter(req, file, cb) {
  const allowed = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
  ];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(new Error(`Invalid file type: ${file.mimetype}. Only images and videos are allowed.`));
}

const AUTOPOSTER_MAX_MB = parseInt(process.env.AUTOPOSTER_MAX_FILE_SIZE_MB || '100');

const autoposterUpload = multer({
  storage: makeStorage('autoposter'),
  fileFilter: mediaFilter,
  limits: { fileSize: AUTOPOSTER_MAX_MB * 1024 * 1024 },
});

// Resolve a stored path to absolute FS path safely
function resolveUpload(filePath) {
  const base = path.join(__dirname, '..', 'public');
  const resolved = path.resolve(base, filePath.replace(/^\//, ''));
  if (!resolved.startsWith(base)) throw new Error('Invalid path');
  return resolved;
}

module.exports = { logoUpload, templateUpload, assetUpload, autoposterUpload, single, resolveUpload };
