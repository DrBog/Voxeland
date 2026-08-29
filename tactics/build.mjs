/* IRONWAKE — bundle the source into one self-contained page.
   Two outputs:
     dist/ironwake.html   a normal standalone page (open it from a file:// URL)
     dist/artifact.html  the same page as an Artifact fragment (no <html> shell)
   No dependencies, no minifier: the source is the shipped artefact, and it is
   meant to be readable by whoever opens it. */
import fs from 'fs';
import path from 'path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
const files = fs.readdirSync(path.join(dir, 'src')).filter(f => f.endsWith('.js')).sort();
const js = files.map(f => '/* ---- ' + f + ' ---- */\n' + fs.readFileSync(path.join(dir, 'src', f), 'utf8')).join('\n');
const shell = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

const bodyStart = shell.indexOf('<div id="app">');
const bodyEnd = shell.indexOf('<script src=');
const markup = shell.slice(bodyStart, bodyEnd).trim();

const fragment = `<title>IRONWAKE</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${css}
</style>
${markup}
<script>
${js}
</script>
`;

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1">
<meta name="theme-color" content="#0b0e16">
${fragment}</body>
</html>
`.replace('<title>IRONWAKE</title>', '<title>IRONWAKE</title>\n</head>\n<body>');

fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
fs.writeFileSync(path.join(dir, 'dist', 'artifact.html'), fragment);
fs.writeFileSync(path.join(dir, 'dist', 'ironwake.html'), page);
console.log('built dist/ironwake.html and dist/artifact.html —',
  (fragment.length / 1024).toFixed(0) + ' KB from', files.length, 'modules');
