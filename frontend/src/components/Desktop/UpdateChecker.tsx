import React, { useState, useEffect, useCallback, useRef } from 'react';

type UpdateState = 'idle' | 'available' | 'downloading' | 'ready' | 'error';

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutos
const DISABLED_KEY = 'oj-auto-update-disabled';

export function isAutoUpdateDisabled(): boolean {
  try {
    return localStorage.getItem(DISABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAutoUpdateDisabled(disabled: boolean): void {
  try {
    if (disabled) {
      localStorage.setItem(DISABLED_KEY, '1');
    } else {
      localStorage.removeItem(DISABLED_KEY);
    }
  } catch {}
}

export function UpdateChecker() {
  const [state, setState] = useState<UpdateState>('idle');
  const [version, setVersion] = useState('');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const updateRef = useRef<any>(null);
  const handleDownloadRef = useRef<(() => Promise<void>) | null>(null);

  const checkForUpdate = useCallback(async () => {
    if (isAutoUpdateDisabled() || updateRef.current) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const latest = await invoke<string | null>('jarvis_check_update');
      if (latest) {
        updateRef.current = latest;
        setVersion(latest);
        setDismissed(false);
        // Jarvis Pessoal: atualiza sozinho, sem perguntar.
        void handleDownloadRef.current?.();
      }
    } catch {
      // Sem internet ou sem versão publicada: tenta de novo mais tarde.
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return;
    }
    if (isAutoUpdateDisabled()) return;

    // Local dev escape hatch: skip the auto-update poll if explicitly
    // disabled. Vite exposes any ``VITE_``-prefixed env var on
    // ``import.meta.env``, so a frontend dev can ``export
    // VITE_OPENJARVIS_NO_UPDATER=1`` before ``npm run tauri dev`` to
    // silence the 30-min poll. See docs/desktop-auto-update.md.
    const noUpdater = (import.meta as any).env?.VITE_OPENJARVIS_NO_UPDATER;
    if (noUpdater === '1' || noUpdater === 'true') {
      return;
    }

    checkForUpdate();
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [checkForUpdate]);

  const handleDownload = useCallback(async () => {
    if (!updateRef.current) return;
    setState('downloading');
    setProgress(0);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // Baixa, instala em silêncio e reabre o Jarvis (o app fecha sozinho).
      await invoke('jarvis_install_update');
      setState('ready');
    } catch (e: any) {
      updateRef.current = null;
      setErrorMsg(e?.message || String(e) || 'falha no download');
      setState('error');
      setTimeout(() => setState('idle'), 5000);
    }
  }, []);

  handleDownloadRef.current = handleDownload;

  const handleRelaunch = useCallback(async () => {
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch {
      setErrorMsg('feche e abra o Jarvis de novo');
      setState('error');
      setTimeout(() => setState('idle'), 5000);
    }
  }, []);

  const handleDisable = useCallback(() => {
    setAutoUpdateDisabled(true);
    setState('idle');
    setDismissed(false);
  }, []);

  if (state === 'idle' || dismissed) return null;

  return (
    <div style={styles.banner}>
      {state === 'available' && (
        <div style={styles.row}>
          <span>Nova versão do Jarvis: <strong>v{version}</strong></span>
          <div style={styles.actions}>
            <button style={styles.primaryBtn} onClick={handleDownload}>Atualizar</button>
            <button style={styles.secondaryBtn} onClick={() => setDismissed(true)}>Depois</button>
            <button style={styles.muteBtn} onClick={handleDisable}>Desativar atualizações</button>
          </div>
        </div>
      )}

      {state === 'downloading' && (
        <div style={styles.row}>
          <span>Atualizando o Jarvis para a v{version}... ele vai fechar e abrir sozinho.</span>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${progress}%` }} />
          </div>
        </div>
      )}

      {state === 'ready' && (
        <div style={styles.row}>
          <span style={{ color: '#a6e3a1' }}>Atualização instalada.</span>
          <div style={styles.actions}>
            <button style={styles.successBtn} onClick={handleRelaunch}>Reiniciar agora</button>
            <button style={styles.secondaryBtn} onClick={() => setDismissed(true)}>Depois</button>
          </div>
        </div>
      )}

      {state === 'error' && (
        <div style={styles.row}>
          <span style={{ color: '#f38ba8' }}>Erro na atualização: {errorMsg}</span>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    color: '#d8f3ff',
    padding: '10px 24px',
    backgroundColor: '#181825',
    borderBottom: '1px solid #313244',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    fontSize: '13px',
  },
  actions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  primaryBtn: {
    padding: '4px 14px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: '#89b4fa',
    color: '#1e1e2e',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  successBtn: {
    padding: '4px 14px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: '#a6e3a1',
    color: '#1e1e2e',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '4px 14px',
    border: '1px solid #45475a',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    color: '#a6adc8',
    fontSize: '12px',
    cursor: 'pointer',
  },
  muteBtn: {
    padding: '0',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#585b70',
    fontSize: '11px',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  progressBar: {
    flex: 1,
    maxWidth: '300px',
    height: '6px',
    backgroundColor: '#313244',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#89b4fa',
    borderRadius: '3px',
    transition: 'width 0.3s ease',
  },
};
