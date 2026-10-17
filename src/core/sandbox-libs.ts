// Library sources scripts can require() inside the sandbox. Embedded at build time (Vite ?raw), so
// the sandbox never touches the filesystem and the CLI/app carry the exact same versions.

import cryptoJs from 'crypto-js/crypto-js.js?raw'
import lodash from 'lodash/lodash.min.js?raw'

export const SANDBOX_LIBRARIES: Record<string, string> = {
  'crypto-js': cryptoJs,
  lodash
}
