import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("clipsWorker", {
  getState: () => ipcRenderer.invoke("get-worker-state"),
  retry: () => ipcRenderer.invoke("retry-worker"),
  logout: () => ipcRenderer.invoke("logout-worker"),
  openLogs: () => ipcRenderer.invoke("open-logs"),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on("worker-state", listener);
    return () => ipcRenderer.off("worker-state", listener);
  }
});
