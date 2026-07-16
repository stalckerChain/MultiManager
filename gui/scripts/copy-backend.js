const fs = require('fs');
const path = require('path');

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

module.exports = async function(context) {
  const backendSrc = path.join(__dirname, '..', '..', 'src');
  const backendDest = path.join(context.appOutDir, 'resources', 'backend');

  if (!fs.existsSync(backendSrc)) {
    console.error(`[copy-backend] Source not found: ${backendSrc}`);
    process.exit(1);
  }

  console.log(`[copy-backend] Copying ${backendSrc} -> ${backendDest}`);
  copyDirSync(backendSrc, backendDest);
  console.log('[copy-backend] Done');
};
