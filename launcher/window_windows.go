//go:build windows

package main

import (
	"os/exec"
	"strconv"
	"syscall"
)

var (
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	user32   = syscall.NewLazyDLL("user32.dll")
)

// minimizeConsole tira a janela preta da frente: o Jarvis passa a ser só a
// janela do app. Ela continua na barra de tarefas para quem quiser ver o log.
func minimizeConsole() {
	hwnd, _, _ := kernel32.NewProc("GetConsoleWindow").Call()
	if hwnd != 0 {
		user32.NewProc("ShowWindow").Call(hwnd, 6) // SW_MINIMIZE
	}
}

func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}

// killTree encerra o processo e tudo que ele abriu (servidor, Vite, Node).
func killTree(pid int) {
	c := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(pid))
	hideWindow(c)
	_ = c.Run()
}
