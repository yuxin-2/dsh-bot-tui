// Copy text without pretending a terminal can do it. OSC 52 is tried first
// because it also works over SSH; if the escape cannot be written, pbcopy is the
// local fallback. Both paths report success only when the write/child actually
// succeeded.
import { spawn as nodeSpawn } from 'node:child_process'

function base64(text) {
  return Buffer.from(String(text ?? ''), 'utf8').toString('base64')
}

function viaPbcopy(text, spawn) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] })
    } catch {
      resolve({ ok: false, path: 'pbcopy' })
      return
    }
    if (child === undefined || child === null || typeof child.on !== 'function' || child.stdin === undefined) {
      resolve({ ok: false, path: 'pbcopy' })
      return
    }
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok, path: 'pbcopy' })
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
      finish(false)
    }, 2000)
    child.on('error', () => finish(false))
    child.on('close', (code) => finish(code === 0))
    try {
      child.stdin.on('error', () => finish(false))
      child.stdin.end(String(text ?? ''))
    } catch {
      finish(false)
    }
  })
}

/** Copy text, returning which path actually succeeded. */
export async function copyText(text, options = {}) {
  const value = String(text ?? '')
  if (value === '') return { ok: false, path: 'empty' }
  const write = options.write ?? ((chunk) => process.stdout.write(chunk))
  const spawn = options.spawn ?? nodeSpawn
  try {
    // Clipboard selection `c`; BEL terminates the escape on every terminal that
    // implements OSC 52. A failed write means this terminal cannot take it, so
    // fall through instead of claiming success.
    write(`\x1b]52;c;${base64(value)}\x07`)
    return { ok: true, path: 'osc52' }
  } catch {
    // Fall through to pbcopy.
  }
  return viaPbcopy(value, spawn)
}

function stripMarkdown(line) {
  let value = line
  value = value.replace(/^\s{0,3}(?:[-*_]\s*){3,}$/, '')
  value = value.replace(/^\s{0,3}#{1,6}\s+/, '')
  value = value.replace(/^\s{0,3}>\s?/, '')
  value = value.replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/, '')
  value = value.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  value = value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  value = value.replace(/`([^`]*)`/g, '$1')
  value = value.replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
  value = value.replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,!?:;]|$)/g, '$1$2')
  value = value.replace(/<[^>]+>/g, '')
  return value
}

/**
 * Reduce a reply to plain text. Fenced code keeps its contents verbatim (the
 * fence lines themselves are dropped); markdown markers outside a fence are
 * removed. Tool-call blocks never enter this function because only text blocks
 * are collected by the caller.
 */
export function plainText(input) {
  const source = String(input ?? '').replace(/\r\n?/g, '\n')
  const lines = source.split('\n')
  const out = []
  let fenced = false
  for (const line of lines) {
    if (/^\s{0,3}(?:```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    out.push(fenced ? line : stripMarkdown(line))
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
