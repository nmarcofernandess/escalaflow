import { useCallback, useEffect, useRef, useState } from 'react'
import { encodePcm16Wav } from '@/lib/audio-wav'

const TARGET_SAMPLE_RATE = 16000
const MAX_RECORDING_MS = 60_000

type AudioContextCtor = typeof AudioContext

export function useAudioRecorder() {
  const [recording, setRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const chunksRef = useRef<Float32Array[]>([])
  const sourceSampleRateRef = useRef(48000)
  const cleanupRef = useRef<() => void>(() => {})
  const startedAtRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)

  const cleanup = useCallback(() => {
    cleanupRef.current()
    cleanupRef.current = () => {}
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    startedAtRef.current = null
    setRecording(false)
  }, [])

  useEffect(() => cleanup, [cleanup])

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true },
    })
    const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext)
    const audioContext = new Ctor()
    const source = audioContext.createMediaStreamSource(stream)
    const processor = audioContext.createScriptProcessor(4096, 1, 1)

    chunksRef.current = []
    sourceSampleRateRef.current = audioContext.sampleRate

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0)
      chunksRef.current.push(new Float32Array(input))
    }

    source.connect(processor)
    processor.connect(audioContext.destination)
    cleanupRef.current = () => {
      processor.disconnect()
      source.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      void audioContext.close()
    }
    startedAtRef.current = Date.now()
    setElapsedMs(0)
    timerRef.current = window.setInterval(() => {
      const startedAt = startedAtRef.current
      if (!startedAt) return
      const next = Date.now() - startedAt
      setElapsedMs(next)
      if (next >= MAX_RECORDING_MS) {
        cleanup()
      }
    }, 250)
    setRecording(true)
  }, [cleanup])

  const stop = useCallback(async (): Promise<Uint8Array> => {
    cleanup()
    const merged = mergeChunks(chunksRef.current)
    chunksRef.current = []
    const resampled = resampleLinear(merged, sourceSampleRateRef.current, TARGET_SAMPLE_RATE)
    return encodePcm16Wav(resampled, TARGET_SAMPLE_RATE)
  }, [cleanup])

  const cancel = useCallback(() => {
    cleanup()
    chunksRef.current = []
    setElapsedMs(0)
  }, [cleanup])

  return { recording, elapsedMs, maxRecordingMs: MAX_RECORDING_MS, start, stop, cancel }
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples
  if (samples.length === 0) return samples
  const ratio = fromRate / toRate
  const output = new Float32Array(Math.max(1, Math.floor(samples.length / ratio)))
  for (let i = 0; i < output.length; i++) {
    const sourceIndex = Math.min(samples.length - 1, Math.floor(i * ratio))
    output[i] = samples[sourceIndex]
  }
  return output
}
