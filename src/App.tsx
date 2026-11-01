import { useCallback, useEffect, useState } from 'react';
import type { Prefs, Project, ThemeInfo } from './types';
import { api } from './lib/api';
import { applyTheme } from './lib/theme';
import { setCodeTheme } from './lib/highlight';
import { ProjectsHome } from './components/ProjectsHome';
import { ProjectView } from './components/ProjectView';
import { SettingsDialog } from './components/SettingsDialog';
import { Spinner } from './components/bits';

export default function App() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [theme, setTheme] = useState<ThemeInfo | null>(null);
  const [themeVersion, setThemeVersion] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);

  const useTheme = useCallback(async (t: ThemeInfo | null) => {
    applyTheme(t);
    setTheme(t);
    await setCodeTheme(t);
    setThemeVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    applyTheme(null);
    Promise.all([api.listProjects(), api.getPrefs(), api.getTheme()]).then(([p, pr, t]) => {
      setProjects(p);
      setPrefs(pr);
      useTheme(t);
    });
    return api.onTheme(useTheme);
  }, [useTheme]);

  const updatePrefs = useCallback((changes: Partial<Prefs>) => {
    setPrefs((cur) => (cur ? { ...cur, ...changes } : cur));
    api.setPrefs(changes).then(setPrefs);
  }, []);

  if (!projects || !prefs) {
    return (
      <div className="boot">
        <Spinner size={20} />
      </div>
    );
  }

  const open = projects.find((p) => p.id === openId) || null;

  return (
    <>
      {open ? (
        <ProjectView
          key={open.id}
          project={open}
          prefs={prefs}
          onPrefs={updatePrefs}
          onHome={() => setOpenId(null)}
          onSettings={() => setSettings(true)}
          onProjectChange={(p) => setProjects((list) => list && list.map((x) => (x.id === p.id ? { ...x, ...p } : x)))}
          themeVersion={themeVersion}
        />
      ) : (
        <ProjectsHome projects={projects} onOpen={(p) => setOpenId(p.id)} onProjects={setProjects} onSettings={() => setSettings(true)} />
      )}
      {settings ? <SettingsDialog prefs={prefs} theme={theme} onPrefs={updatePrefs} onClose={() => setSettings(false)} /> : null}
    </>
  );
}
