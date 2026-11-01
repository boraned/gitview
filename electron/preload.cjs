'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('gitview', {
  listProjects: invoke('projects:list'),
  addProject: invoke('projects:add'),
  addFolders: invoke('projects:addFolders'),
  updateProject: invoke('projects:update'),
  removeProject: invoke('projects:remove'),
  projectSummary: invoke('projects:summary'),

  scan: invoke('scan'),
  detail: invoke('detail'),
  resetBaseline: invoke('baseline:reset'),

  commits: invoke('history:list'),
  commit: invoke('history:commit'),
  commitFile: invoke('history:file'),

  getPrefs: invoke('prefs:get'),
  setPrefs: invoke('prefs:set'),

  getTheme: invoke('theme:get'),
  onTheme(callback) {
    const listener = (_event, theme) => callback(theme);
    ipcRenderer.on('theme:changed', listener);
    return () => ipcRenderer.removeListener('theme:changed', listener);
  },

  reveal: invoke('shell:reveal'),
});
