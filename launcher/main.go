// Jarvis.exe — instala, atualiza e abre o Jarvis Pessoal no Windows.
//
// Na primeira vez instala o que falta (Git, uv, Node.js, Ollama, eSpeak NG),
// baixa o projeto do GitHub, prepara o Python, aplica o preset em português e
// baixa o modelo de IA. Nas próximas vezes só atualiza e abre a tela de comando.
package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	repoURL = "https://github.com/Ph20sr/jarvis-pessoal.git"
	model   = "qwen3.5:4b"
)

func say(format string, a ...any) { fmt.Printf("  "+format+"\n", a...) }

func has(name string) bool { _, err := exec.LookPath(name); return err == nil }

func run(dir, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Stdout, cmd.Stderr, cmd.Stdin = os.Stdout, os.Stderr, os.Stdin
	return cmd.Run()
}

func output(dir, name string, args ...string) string {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	out, _ := cmd.Output()
	return string(out)
}

func addPath(dirs ...string) {
	p := os.Getenv("PATH")
	for _, d := range dirs {
		if d != "" && !strings.Contains(strings.ToLower(p), strings.ToLower(d)) {
			p = d + string(os.PathListSeparator) + p
		}
	}
	os.Setenv("PATH", p)
}

func winget(id, label string) {
	if !has("winget") {
		say("Instale manualmente: %s (o winget não está disponível).", label)
		return
	}
	say("Instalando %s...", label)
	_ = run("", "winget", "install", "-e", "--id", id, "--silent",
		"--accept-package-agreements", "--accept-source-agreements")
}

// installOllama baixa o instalador oficial e roda na tela (instala só para o
// usuário, sem precisar de administrador). O winget silencioso costuma ser
// cancelado pelo Windows (código 5), então ele fica só como plano B.
func installOllama(local string) {
	setup := filepath.Join(os.TempDir(), "OllamaSetup.exe")
	say("Baixando o Ollama (IA local)...")
	dl := exec.Command("powershell", "-NoProfile", "-Command",
		"$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing "+
			"-Uri https://ollama.com/download/OllamaSetup.exe -OutFile '"+setup+"'")
	dl.Stdout, dl.Stderr = os.Stdout, os.Stderr
	if err := dl.Run(); err == nil {
		say("Abrindo o instalador do Ollama. Clique em Install e espere terminar.")
		_ = run("", setup)
		os.Remove(setup)
	}
	if !has("ollama") {
		if _, err := os.Stat(filepath.Join(local, "Programs", "Ollama", "ollama.exe")); err == nil {
			return
		}
		say("Tentando pelo winget...")
		_ = run("", "winget", "install", "-e", "--id", "Ollama.Ollama",
			"--accept-package-agreements", "--accept-source-agreements")
	}
}

func fail(msg string) {
	fmt.Println()
	say("ERRO: %s", msg)
	pause()
	os.Exit(1)
}

func pause() {
	fmt.Println()
	say("Aperte Enter para fechar.")
	bufio.NewReader(os.Stdin).ReadString('\n')
}

// projectDir: a pasta do projeto ao lado do .exe, ou %LOCALAPPDATA%\JarvisPessoal.
func projectDir() string {
	exe, _ := os.Executable()
	here := filepath.Dir(exe)
	if _, err := os.Stat(filepath.Join(here, "pyproject.toml")); err == nil {
		return here
	}
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "JarvisPessoal")
}

func main() {
	fmt.Println()
	fmt.Println("  ================================")
	fmt.Println("        J.A.R.V.I.S  PESSOAL")
	fmt.Println("  ================================")
	fmt.Println()

	local, home := os.Getenv("LOCALAPPDATA"), os.Getenv("USERPROFILE")
	addPath(filepath.Join(home, ".local", "bin"),
		filepath.Join(local, "Programs", "Ollama"),
		`C:\Program Files\Git\cmd`, `C:\Program Files\nodejs`, `C:\Program Files\eSpeak NG`)

	// 1. pré-requisitos
	if !has("git") {
		winget("Git.Git", "Git")
	}
	if !has("uv") {
		say("Instalando o uv (gerenciador do Python)...")
		_ = run("", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
			"irm https://astral.sh/uv/install.ps1 | iex")
	}
	if !has("node") {
		winget("OpenJS.NodeJS.LTS", "Node.js")
	}
	if !has("ollama") {
		installOllama(local)
	}
	if !has("espeak-ng") {
		winget("eSpeak-NG.eSpeak-NG", "eSpeak NG (voz brasileira)")
	}
	for _, tool := range []string{"git", "uv", "node"} {
		if !has(tool) {
			fail(fmt.Sprintf("Não encontrei o %s depois de instalar. Feche e abra o Jarvis.exe de novo.", tool))
		}
	}
	// o Ollama pode ficar para depois: sem ele, dá pra usar o Gemini nas Settings
	semOllama := !has("ollama")
	if semOllama {
		say("AVISO: o Ollama não foi instalado. Instale em https://ollama.com/download")
		say("ou use o Gemini em Settings > provedores de nuvem. Continuando...")
	}

	// 2. projeto: baixa ou atualiza
	dir := projectDir()
	if _, err := os.Stat(filepath.Join(dir, "pyproject.toml")); err != nil {
		say("Baixando o Jarvis do GitHub...")
		if err := run("", "git", "clone", "--depth", "1", repoURL, dir); err != nil {
			fail("Não consegui baixar o projeto. Confira a internet e o acesso ao repositório.")
		}
	} else if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
		say("Procurando atualizações...")
		// a pasta é gerenciada pelo Jarvis.exe: alinha com o GitHub mesmo que
		// o npm ou o antivírus tenham mexido em algum arquivo
		if run(dir, "git", "fetch", "--depth", "1", "origin", "main") == nil {
			_ = run(dir, "git", "reset", "--hard", "origin/main")
		}
	}

	// 3. dependências do Python
	say("Preparando o Jarvis (a primeira vez demora alguns minutos)...")
	if err := run(dir, "uv", "sync", "--extra", "server", "--extra", "desktop",
		"--extra", "voice", "--extra", "inference-google"); err != nil {
		fail("Falhou ao instalar as dependências do Python.")
	}

	// 4. configuração em português
	if _, err := os.Stat(filepath.Join(home, ".openjarvis", "config.toml")); err != nil {
		say("Configurando em português, local e grátis...")
		if err := run(dir, "uv", "run", "jarvis", "init", "--preset", "jarvis-pt", "--force"); err != nil {
			say("AVISO: não consegui aplicar a configuração em português (veja acima).")
		}
	}

	// 5. modelo de IA
	if !semOllama && !strings.Contains(output("", "ollama", "list"), model) {
		say("Baixando o modelo de IA %s (uns 3 GB, só na primeira vez)...", model)
		_ = run("", "ollama", "pull", model)
	}

	// 6. liga o núcleo e abre o Jarvis como aplicativo
	fmt.Println()
	say("Ligando o núcleo do Jarvis (uns 30 segundos)...")
	gui := exec.Command("uv", "run", "jarvis", "gui", "--no-browser")
	gui.Dir = dir
	gui.Stdout, gui.Stderr = os.Stdout, os.Stderr
	if err := gui.Start(); err != nil {
		fail("Não consegui ligar o Jarvis: " + err.Error())
	}
	done := make(chan error, 1)
	go func() { done <- gui.Wait() }()

	if !ready(appURL, 5*time.Minute) || !ready(healthURL, 5*time.Minute) {
		say("O núcleo demorou demais para ligar. Veja as mensagens acima.")
	}
	select {
	case <-done:
		fail("O Jarvis fechou com erro. Veja as mensagens acima.")
	default:
	}

	profile := filepath.Join(os.Getenv("LOCALAPPDATA"), "JarvisPessoal", "janela")
	say("Pronto! Abrindo o Jarvis. Para sair, é só fechar a janela dele.")
	minimizeConsole()
	if openAppWindow(profile) {
		killTree(gui.Process.Pid)
		return
	}
	say("Não achei o Edge nem o Chrome. Abra %s no navegador.", appURL)
	<-done
	pause()
}
