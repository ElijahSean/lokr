'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  generatePassword, generatePassphrase, generateUsername, generatePin,
  scorePassword, type GeneratorOptions,
} from '@/lib/generator'

const CLIPBOARD_CLEAR_DELAY_MS = 30_000

const DEFAULT_OPTIONS: GeneratorOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
}

type Mode = 'password' | 'passphrase' | 'username' | 'pin'

const MODES: { id: Mode; label: string }[] = [
  { id: 'password',   label: 'Password'   },
  { id: 'passphrase', label: 'Passphrase' },
  { id: 'username',   label: 'Username'   },
  { id: 'pin',        label: 'PIN'        },
]

export default function Generator() {
  const [mode, setMode]           = useState<Mode>('password')
  const [options, setOptions]     = useState<GeneratorOptions>(DEFAULT_OPTIONS)
  const [wordCount, setWordCount] = useState(6)
  const [pinLength, setPinLength] = useState(4)
  const [generated, setGenerated] = useState('')
  const [copied, setCopied]       = useState(false)
  const [genError, setGenError]   = useState<string | null>(null)

  const regenerate = useCallback(() => {
    setGenError(null)
    try {
      if (mode === 'passphrase') setGenerated(generatePassphrase(wordCount))
      else if (mode === 'username') setGenerated(generateUsername())
      else if (mode === 'pin') setGenerated(generatePin(pinLength))
      else setGenerated(generatePassword(options))
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Generation failed')
      setGenerated('')
    }
  }, [mode, options, wordCount, pinLength])

  useEffect(() => { regenerate() }, [regenerate])

  const strength = mode === 'password' && generated ? scorePassword(generated) : null

  async function handleCopy() {
    if (!generated) return
    try {
      await navigator.clipboard.writeText(generated)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      setTimeout(async () => {
        await navigator.clipboard.writeText('').catch(() => {})
      }, CLIPBOARD_CLEAR_DELAY_MS)
    } catch {
      alert('Clipboard access denied.')
    }
  }

  function setOption<K extends keyof GeneratorOptions>(key: K, value: GeneratorOptions[K]) {
    setOptions(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-primary text-xl font-semibold mb-1">Generator</h2>
        <p className="text-slate-400 text-sm">
          All values generated using <code className="text-brand-600">crypto.getRandomValues()</code> — never Math.random().
        </p>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 p-1 bg-slate-800 rounded-xl w-fit">
        {MODES.map(m => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === m.id ? 'bg-brand-500 text-white' : 'text-slate-400 hover:text-primary'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Output card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="bg-slate-800 rounded-xl px-4 py-4 min-h-[64px] flex items-center">
          {genError ? (
            <span className="text-red-600 text-sm">{genError}</span>
          ) : (
            <span className={`flex-1 font-mono text-base break-all leading-relaxed select-all text-primary ${
              mode === 'pin' ? 'tracking-[0.4em] text-xl text-center w-full' : ''
            }`}>
              {generated || '—'}
            </span>
          )}
        </div>

        {/* Strength meter — password mode only */}
        {strength && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Strength</span>
              <span className={
                strength.label === 'weak'   ? 'text-red-600'    :
                strength.label === 'fair'   ? 'text-yellow-600' :
                strength.label === 'good'   ? 'text-blue-600'   :
                'text-green-700'
              }>
                {strength.label.charAt(0).toUpperCase() + strength.label.slice(1)} · {strength.score}/100
              </span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  strength.label === 'weak'   ? 'bg-red-500'    :
                  strength.label === 'fair'   ? 'bg-yellow-500' :
                  strength.label === 'good'   ? 'bg-blue-500'   :
                  'bg-green-500'
                }`}
                style={{ width: `${strength.score}%` }}
              />
            </div>
          </div>
        )}

        {/* Entropy note — passphrase mode */}
        {mode === 'passphrase' && (
          <p className="text-slate-500 text-xs">
            {wordCount} words × 8 bits/word = ~{wordCount * 8} bits of entropy
            {wordCount >= 6 ? ' (good)' : ' (consider more words)'}
          </p>
        )}

        {/* Info note — username mode */}
        {mode === 'username' && (
          <p className="text-slate-500 text-xs">
            Format: adjective_nounNumber. Good for accounts where you don&apos;t want to use your real name.
          </p>
        )}

        {/* Info note — PIN mode */}
        {mode === 'pin' && (
          <p className="text-slate-500 text-xs">
            {pinLength}-digit cryptographically random PIN. Never share your PIN.
          </p>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={regenerate}
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Regenerate
          </button>
          <button
            onClick={handleCopy}
            disabled={!generated || !!genError}
            className="flex-1 bg-brand-500 hover:bg-brand-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {copied ? (
              <><svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg> Copied!</>
            ) : (
              <><svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</>
            )}
          </button>
        </div>
        <p className="text-slate-600 text-xs text-center">Clipboard auto-clears after 30 seconds.</p>
      </div>

      {/* Options panel */}
      {mode !== 'username' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
          <h3 className="text-primary font-medium text-sm">Options</h3>

          {mode === 'password' && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Length</span>
                  <span className="text-primary font-mono font-medium">{options.length}</span>
                </div>
                <input
                  type="range" min={12} max={64} value={options.length}
                  onChange={e => setOption('length', Number(e.target.value))}
                  className="w-full accent-brand-500"
                />
                <div className="flex justify-between text-xs text-slate-600">
                  <span>12</span><span>64</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {([
                  ['uppercase', 'Uppercase (A–Z)'],
                  ['lowercase', 'Lowercase (a–z)'],
                  ['numbers',   'Numbers (0–9)'],
                  ['symbols',   'Symbols (!@#…)'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={options[key] as boolean}
                      onChange={e => setOption(key, e.target.checked)}
                      className="w-4 h-4 rounded accent-brand-500"
                    />
                    <span className="text-sm text-slate-400 group-hover:text-slate-200 transition-colors">
                      {label}
                    </span>
                  </label>
                ))}
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.excludeAmbiguous}
                  onChange={e => setOption('excludeAmbiguous', e.target.checked)}
                  className="w-4 h-4 rounded accent-brand-500"
                />
                <span className="text-sm text-slate-400 group-hover:text-slate-200 transition-colors">
                  Exclude ambiguous characters (0, O, 1, l, I)
                </span>
              </label>
            </>
          )}

          {mode === 'passphrase' && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Word count</span>
                <span className="text-primary font-mono font-medium">{wordCount}</span>
              </div>
              <input
                type="range" min={3} max={8} value={wordCount}
                onChange={e => setWordCount(Number(e.target.value))}
                className="w-full accent-brand-500"
              />
              <div className="flex justify-between text-xs text-slate-600">
                <span>3 words</span><span>8 words</span>
              </div>
              <p className="text-slate-500 text-xs pt-1">
                Words separated by hyphens. Example: <span className="text-slate-400 font-mono">calm-bird-grow-fuel-loud-mine</span>
              </p>
            </div>
          )}

          {mode === 'pin' && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">PIN length</span>
                <span className="text-primary font-mono font-medium">{pinLength} digits</span>
              </div>
              <input
                type="range" min={4} max={8} value={pinLength}
                onChange={e => setPinLength(Number(e.target.value))}
                className="w-full accent-brand-500"
              />
              <div className="flex justify-between text-xs text-slate-600">
                <span>4 digits</span><span>8 digits</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
