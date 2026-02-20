#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
VENV_DIR="${SCRIPT_DIR}/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if [[ ! -d "${VENV_DIR}" ]]; then
  "${PYTHON_BIN}" -m venv "${VENV_DIR}"
fi

MODE="${1:-solver}"
shift || true

# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"

install_solver_deps() {
  pip install "ortools>=9.9"
}

install_extractor_deps() {
  pip install -r "${SCRIPT_DIR}/requirements.txt"
}

case "${MODE}" in
  solver)
    install_solver_deps
    if [[ $# -gt 0 ]]; then
      python "${SCRIPT_DIR}/solver_python/solver_ortools.py" "$@"
    else
      python "${SCRIPT_DIR}/solver_python/solver_ortools.py" "${PROJECT_ROOT}/data/escalaflow.db"
    fi
    ;;
  compare)
    python "${SCRIPT_DIR}/comparador/comparar.py" "$@"
    ;;
  both)
    install_solver_deps
    python "${SCRIPT_DIR}/solver_python/solver_ortools.py" "$@"
    python "${SCRIPT_DIR}/comparador/comparar.py"
    ;;
  build-data)
    install_solver_deps
    pip install "openpyxl>=3.1.0"
    python "${PROJECT_ROOT}/scripts/build_caixa_comparison_data.py" "$@"
    ;;
  extract)
    install_extractor_deps
    python "${SCRIPT_DIR}/extrator/extrair_pdf.py" "$@"
    ;;
  *)
    echo "Uso: ${0} [solver|compare|both|build-data|extract] [args...]"
    exit 1
    ;;
esac
