# Jarvis Pessoal

Assistente pessoal por voz, em português, que roda no seu PC. É construído em cima do [OpenJarvis](https://github.com/open-jarvis/openjarvis) (Stanford, licença Apache 2.0), com estas adições:

- **Tela de comando (HUD)** em `/hud`: núcleo animado que muda de cor quando escuta, pensa e fala, espectro de áudio ao vivo, cards de relógio, clima e sistema, conversa e registro de atividades. Abre sozinha ao iniciar.
- **Voz em português**: transcrição local (Whisper) e voz local brasileira (Kokoro). Sem esses, ele usa o reconhecimento e a voz do navegador.
- **Palavra de ativação**: ligue "Ativação" e diga "Jarvis, ..." (no Chrome ou Edge). Ou segure **Espaço** para falar, ou clique no núcleo.
- **Controle do PC**: abrir programas e sites, tocar no YouTube, volume, mídia e bloquear a tela.
- **Clima grátis** (Open-Meteo, sem chave).
- **Preset `jarvis-pt`**: personalidade em português, IA local pelo Ollama, tudo grátis.

## Instalar no Windows

1. Baixe este repositório (botão verde **Code > Download ZIP**, ou `git clone`).
2. Dê dois cliques em **`iniciar-jarvis.bat`**.

Na primeira vez ele instala o que falta (uv, Ollama, Node.js, eSpeak), prepara o Python, configura em português e baixa o modelo de IA (uns 3 GB). Depois disso, é só abrir o mesmo arquivo. A tela de comando abre no navegador.

**Máquina:** 8 GB de RAM já rodam o modelo `qwen3.5:4b`. Com placa de vídeo de 8 GB ou mais, troque para `qwen3.5:9b` em `%USERPROFILE%\.openjarvis\config.toml`, que entende bem melhor.

## Usar o Gemini em vez da IA local (opcional, também grátis)

Se o PC for fraco, dá pra usar o Google Gemini no plano gratuito: abra **Settings** no menu lateral, cole sua chave do Gemini nos provedores de nuvem e escolha um modelo `gemini-...` na lista (Ctrl+K). A chave fica só no seu PC.

## Exemplos

- "Jarvis, como está o tempo em Recife?"
- "Toca Legião Urbana no YouTube"
- "Abre o Spotify" / "Aumenta o volume" / "Pausa a música"
- "Pesquisa as notícias de hoje sobre tecnologia"
- "Bloqueia a tela"

## Personalizar

- **Personalidade e modelo:** `%USERPROFILE%\.openjarvis\config.toml` (veja `configs/openjarvis/examples/jarvis-pt.toml`).
- **Mais programas:** crie `%USERPROFILE%\.openjarvis\apps.json`, por exemplo `{ "discord": "C:\\Users\\voce\\AppData\\Local\\Discord\\Update.exe", "steam": "steam:" }`.
- **Voz:** `voice_id = "pf_dora"` para voz feminina, `"pm_alex"` para masculina.
- **Palavra de ativação e cidade do clima:** direto na tela HUD.

## Onde está cada coisa

| Arquivo | O que é |
|---|---|
| `frontend/src/pages/HudPage.tsx`, `hud.css` | Tela de comando |
| `src/openjarvis/tools/pc_control.py` | Ferramentas de controle do PC e clima |
| `configs/openjarvis/examples/jarvis-pt.toml` | Preset em português |
| `iniciar-jarvis.bat` | Instalador e inicializador do Windows |

O resto é o OpenJarvis original. Veja o `README.md` para a documentação completa dele.
