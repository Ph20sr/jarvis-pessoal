//go:build !windows

package main

import (
	"os"
	"os/exec"
)

func minimizeConsole()         {}
func hideWindow(cmd *exec.Cmd) {}
func killTree(pid int) {
	if p, err := os.FindProcess(pid); err == nil {
		_ = p.Kill()
	}
}
