/**
 * Stands in for the `electron` module during integration checks.
 *
 * The main-process modules reach for `app.getPath('userData')` to locate the
 * database. Aliasing the module to this stub points them at a throwaway
 * directory, so a check can never read or write the real user's recordings.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const paths = {
  userData: fs.mkdtempSync(path.join(os.tmpdir(), 'mempill-stub-')),
};

exports.app = {
  getPath: (name) => paths[name] ?? paths.userData,
  setPath: (name, value) => { paths[name] = value; },
};
