import type { ElectronAPI } from '../../shared/types';

function getAPI(): ElectronAPI {
  return window.electronAPI;
}

export const api = new Proxy({} as ElectronAPI, {
  get(_target, prop: keyof ElectronAPI) {
    return getAPI()[prop];
  },
});
