// Builds app/index.html from the editor source (the same file that runs on claude.ai).
// Usage: node scripts/sync-app.js path/to/clip-studio.html
const fs = require('fs');
const path = require('path');
const src = process.argv[2] || path.join(__dirname, '..', '..', 'clip-studio.html');
let html = fs.readFileSync(src, 'utf8');
if (!/<!doctype/i.test(html)) {
  html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' app: blob: data:; script-src 'self' app: 'unsafe-inline' 'unsafe-eval' blob: 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' app: blob: data:; media-src 'self' app: blob: data:; connect-src 'self' app: blob: data:; worker-src 'self' app: blob:">
<script src="desktop.js"></script>
</head>
<body>
${html}
</body>
</html>
`;
}
html = html.replace('https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/dist/face-api.js', 'face-api.js');
fs.writeFileSync(path.join(__dirname, '..', 'app', 'index.html'), html);
console.log('app/index.html', (html.length / 1024).toFixed(0) + 'KB');
