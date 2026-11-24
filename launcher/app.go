package main

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const (
	appURL    = "http://127.0.0.1:5173/hud"
	healthURL = "http://127.0.0.1:8000/health"
)

// ready espera uma URL responder 200, até o limite.
func ready(url string, limit time.Duration) bool {
	client := http.Client{Timeout: 3 * time.Second}
	end := time.Now().Add(limit)
	for time.Now().Before(end) {
		if r, err := client.Get(url); err == nil {
			r.Body.Close()
			if r.StatusCode < 500 {
				return true
			}
		}
		time.Sleep(time.Second)
	}
	return false
}

// appBrowser acha o Edge (vem em todo Windows) ou o Chrome para abrir o Jarvis
// em modo aplicativo: janela própria, sem abas nem barra de endereço.
func appBrowser() string {
	candidates := []string{}
	for _, base := range []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LOCALAPPDATA")} {
		if base == "" {
			continue
		}
		candidates = append(candidates,
			filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe"))
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

// openAppWindow abre a janela do Jarvis e retorna quando ela é fechada.
// Usa um perfil só do Jarvis: a permissão do microfone fica salva e o
// processo é separado do navegador normal, então fechar a janela = sair.
func openAppWindow(profileDir string) bool {
	exe := appBrowser()
	if exe == "" {
		return false
	}
	cmd := exec.Command(exe,
		"--app="+appURL,
		"--user-data-dir="+profileDir,
		"--window-size=1400,860",
		"--no-first-run",
		"--no-default-browser-check",
		"--autoplay-policy=no-user-gesture-required",
		"--disable-features=Translate",
	)
	if err := cmd.Start(); err != nil {
		return false
	}
	_ = cmd.Wait()
	return true
}
