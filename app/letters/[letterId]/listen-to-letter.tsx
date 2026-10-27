'use client'

import { useEffect, useRef, useState } from 'react'
import { stripRichBodyMarker } from '@/lib/letter-editor-doc'

const SPEEDS = [0.85, 1, 1.15, 1.3] as const
const MAX_CHUNK = 180

/** Split long letters at natural boundaries; some mobile engines silently stop long utterances. */
export function splitNarration(text: string): string[] {
  const chunks: string[] = []
  const paragraphs = text.split(/\n\s*\n/)
  for (const paragraph of paragraphs) {
    const sentences = paragraph.match(/[^.!?\n]+(?:[.!?]+|$)/g) ?? [paragraph]
    let current = ''
    for (const sentence of sentences) {
      const words = sentence.trim().split(/\s+/).filter(Boolean)
      for (const word of words) {
        if (current && current.length + word.length + 1 > MAX_CHUNK) {
          chunks.push(current)
          current = ''
        }
        // Long unbroken tokens are still bounded for speech engines.
        if (word.length > MAX_CHUNK) {
          for (let i = 0; i < word.length; i += MAX_CHUNK) chunks.push(word.slice(i, i + MAX_CHUNK))
        } else current += (current ? ' ' : '') + word
      }
    }
    if (current) chunks.push(current)
  }
  return chunks
}

export default function ListenToLetter({ body }: { body: string }) {
  const [supported, setSupported] = useState(false)
  const [status, setStatus] = useState<'idle' | 'playing' | 'paused'>('idle')
  const [speed, setSpeed] = useState(1)
  const [voiceUri, setVoiceUri] = useState('')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const generation = useRef(0)
  const chunksRef = useRef<string[]>([])
  const indexRef = useRef(0)
  const currentRef = useRef<SpeechSynthesisUtterance | null>(null)
  const statusRef = useRef<'idle' | 'playing' | 'paused'>('idle')

  function updateStatus(next: 'idle' | 'playing' | 'paused') {
    statusRef.current = next
    setStatus(next)
  }

  useEffect(() => {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return
    setSupported(true)
    const updateVoices = () => setVoices(window.speechSynthesis.getVoices())
    updateVoices()
    window.speechSynthesis.addEventListener?.('voiceschanged', updateVoices)
    return () => {
      generation.current++
      window.speechSynthesis.cancel()
      window.speechSynthesis.removeEventListener?.('voiceschanged', updateVoices)
    }
  }, [])

  function stop() {
    generation.current++
    window.speechSynthesis.cancel()
    currentRef.current = null
    chunksRef.current = []
    indexRef.current = 0
    updateStatus('idle')
  }

  function speakNext(token: number) {
    if (generation.current !== token || statusRef.current !== 'playing') return
    const chunk = chunksRef.current[indexRef.current]
    if (!chunk) {
      currentRef.current = null
      updateStatus('idle')
      return
    }
    const utterance = new SpeechSynthesisUtterance(chunk)
    const voice = voices.find((candidate) => candidate.voiceURI === voiceUri)
    if (voice) utterance.voice = voice
    utterance.lang = voice?.lang || document.documentElement.lang || navigator.language || 'en'
    utterance.rate = speed
    utterance.onend = () => {
      if (generation.current !== token || currentRef.current !== utterance) return
      indexRef.current++
      if (statusRef.current === 'playing') speakNext(token)
    }
    utterance.onerror = () => {
      if (generation.current !== token || currentRef.current !== utterance) return
      // Fail closed: don't skip text silently on an engine error.
      currentRef.current = null
      updateStatus('idle')
    }
    currentRef.current = utterance
    window.speechSynthesis.speak(utterance)
  }

  function toggle() {
    const synth = window.speechSynthesis
    if (status === 'playing') {
      synth.pause()
      updateStatus('paused')
      return
    }
    if (status === 'paused') {
      if (synth.paused) {
        updateStatus('playing')
        synth.resume()
        // A chunk may have finished just as pause was requested.
        if (!synth.speaking && !synth.pending) speakNext(generation.current)
      } else {
        // Engine abandoned playback during pause; restart current chunk.
        updateStatus('playing')
        speakNext(generation.current)
      }
      return
    }

    const { isRich, body: clean } = stripRichBodyMarker(body)
    // The stored body is plain text with a small opt-in bold/italic markup subset.
    const spoken = isRich ? clean.replace(/\\([*_\\])/g, '$1').replace(/\*\*/g, '').replace(/(^|\s)_(?=\S)|_(?=\s|$)/g, '$1') : clean
    const chunks = splitNarration(spoken)
    if (!chunks.length) return
    generation.current++
    synth.cancel()
    chunksRef.current = chunks
    indexRef.current = 0
    updateStatus('playing')
    speakNext(generation.current)
  }

  if (!supported) return null

  return (
    <div aria-label="Letter audio controls" className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-foreground/10 bg-background px-3 py-2 text-[13px]">
      <button type="button" onClick={toggle} className="rounded-md px-2 py-1 font-medium text-foreground hover:bg-foreground/5" aria-label={status === 'playing' ? 'Pause reading' : status === 'paused' ? 'Resume reading' : 'Listen to letter'}>
        {status === 'playing' ? 'Pause' : status === 'paused' ? 'Continue listening' : 'Listen to letter'}
      </button>
      {status !== 'idle' && <button type="button" onClick={stop} className="rounded-md px-2 py-1 text-muted hover:bg-foreground/5">Stop</button>}
      {voices.length > 0 && (
        <label className="flex items-center gap-2 text-muted">Voice
          <select aria-label="Reading voice" className="max-w-36 rounded border border-foreground/15 bg-background px-2 py-1 text-foreground" value={voiceUri} onChange={(event) => { if (status !== 'idle') stop(); setVoiceUri(event.target.value) }}>
            <option value="">Device default</option>
            {voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>)}
          </select>
        </label>
      )}
      <label className="ml-auto flex items-center gap-2 text-muted">Speed
        <select aria-label="Reading speed" value={speed} onChange={(event) => { if (status !== 'idle') stop(); setSpeed(Number(event.target.value)) }} className="rounded border border-foreground/15 bg-background px-2 py-1 text-foreground">
          {SPEEDS.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
      </label>
    </div>
  )
}
