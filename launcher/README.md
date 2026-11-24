# Jarvis.exe

Inicializador do Windows. Para recompilar (de qualquer sistema com Go):

```
cd launcher
GOOS=windows GOARCH=amd64 go build -ldflags "-s -w" -o ../Jarvis.exe .
```

O ícone e os metadados estão em `rsrc_windows_*.syso` (gerados com `go-winres simply --icon icon.png`).
