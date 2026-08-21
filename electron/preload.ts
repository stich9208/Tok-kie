import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  updateTrayTitle: (title: string) => ipcRenderer.send('update-tray-title', title),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
});
