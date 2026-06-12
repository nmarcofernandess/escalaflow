import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const MODEL_ID = 'parakeet-tdt-0.6b-v3-int8'
const MODEL_URL = 'https://blob.handy.computer/parakeet-v3-int8.tar.gz'
const MODEL_DIR = path.join(ROOT, 'models', 'stt', MODEL_ID)
const REQUIRED_FILES = [
  'config.json',
  'decoder_joint-model.int8.onnx',
  'encoder-model.int8.onnx',
  'nemo128.onnx',
  'vocab.txt',
]

function hasModel() {
  return REQUIRED_FILES.every((file) => fs.existsSync(path.join(MODEL_DIR, file)))
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http
    const request = client.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        download(new URL(response.headers.location, url).toString(), destination).then(resolve, reject)
        return
      }

      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Download falhou: HTTP ${response.statusCode}`))
        return
      }

      const file = fs.createWriteStream(destination)
      response.pipe(file)
      file.on('finish', () => file.close(resolve))
      file.on('error', reject)
    })
    request.on('error', reject)
  })
}

if (hasModel()) {
  console.log(`STT model already present: ${MODEL_DIR}`)
  process.exit(0)
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'escalaflow-stt-model-'))
const archivePath = path.join(tmpDir, 'parakeet-v3-int8.tar.gz')

try {
  fs.mkdirSync(path.dirname(MODEL_DIR), { recursive: true })
  console.log(`Downloading STT model: ${MODEL_URL}`)
  await download(MODEL_URL, archivePath)

  const tar = spawnSync('tar', ['-xzf', archivePath, '-C', path.dirname(MODEL_DIR)], {
    stdio: 'inherit',
  })
  if (tar.status !== 0) {
    throw new Error(`tar exited with status ${tar.status}`)
  }

  if (!hasModel()) {
    throw new Error(`STT model extracted without required files at ${MODEL_DIR}`)
  }

  console.log(`STT model ready: ${MODEL_DIR}`)
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}
