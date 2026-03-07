#!/bin/bash
# ============================================
#  EscalaFlow — Desbloqueio macOS
# ============================================
# O macOS bloqueia apps baixados da internet
# que nao possuem certificado Apple Developer.
# Este script remove o bloqueio com seguranca.
# ============================================

clear
echo "============================================"
echo "  EscalaFlow — Desbloqueio macOS"
echo "============================================"
echo ""

APP_PATH="/Applications/EscalaFlow.app"

if [ -d "$APP_PATH" ]; then
    echo "Removendo bloqueio do macOS..."
    xattr -cr "$APP_PATH"
    echo ""
    echo "Pronto! Abrindo EscalaFlow..."
    open "$APP_PATH"
else
    echo "EscalaFlow nao encontrado em /Applications."
    echo ""
    echo "1. Abra o arquivo .dmg que voce baixou"
    echo "2. Arraste o EscalaFlow para a pasta Aplicacoes"
    echo "3. Execute este script novamente"
    echo ""
    echo "Ou rode manualmente no Terminal:"
    echo "  xattr -cr /Applications/EscalaFlow.app"
fi

echo ""
echo "(Pode fechar esta janela)"
