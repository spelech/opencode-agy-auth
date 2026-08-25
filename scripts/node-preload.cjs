const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

if (process.platform === 'win32') {
  const oldNodeLoader = require.extensions['.node'];
  if (oldNodeLoader) {
    require.extensions['.node'] = function (module, filename) {
      const cleanPath = filename.replace(/^\\\\\?\\/, '');
      if (!cleanPath.toLowerCase().startsWith(os.tmpdir().toLowerCase())) {
        const tmp = path.join(os.tmpdir(), path.basename(cleanPath));
        try {
          fs.copyFileSync(cleanPath, tmp);
          return process.dlopen(module, tmp);
        } catch {}
      }
      return oldNodeLoader(module, filename);
    };
  }
}
