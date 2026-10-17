// Incremental parser for text/event-stream (WHATWG HTML §9.2). Pure.

export interface SseMessage {
  event: string
  data: string
  id?: string
  retry?: number
}

export class SseParser {
  private buffer = ''
  private data: string[] = []
  private event = ''
  private id: string | undefined
  private retry: number | undefined
  private first = true

  /** Feed a decoded chunk; returns the events completed by it. */
  push(chunk: string): SseMessage[] {
    if (this.first) {
      chunk = chunk.replace(/^﻿/, '')
      this.first = false
    }
    this.buffer += chunk
    const out: SseMessage[] = []
    let nl: RegExpExecArray | null
    const re = /\r\n|\r|\n/g
    let start = 0
    // A trailing lone \r may be the first half of \r\n, so keep it buffered.
    while ((nl = re.exec(this.buffer)) && !(nl[0] === '\r' && nl.index === this.buffer.length - 1)) {
      this.line(this.buffer.slice(start, nl.index), out)
      start = nl.index + nl[0].length
    }
    this.buffer = this.buffer.slice(start)
    return out
  }

  private line(line: string, out: SseMessage[]): void {
    if (line === '') {
      if (this.data.length) out.push({ event: this.event || 'message', data: this.data.join('\n'), id: this.id, retry: this.retry })
      this.data = []
      this.event = ''
      this.retry = undefined
      return
    }
    if (line.startsWith(':')) return // comment / keep-alive
    const i = line.indexOf(':')
    const field = i < 0 ? line : line.slice(0, i)
    let value = i < 0 ? '' : line.slice(i + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    switch (field) {
      case 'data':
        this.data.push(value)
        break
      case 'event':
        this.event = value
        break
      case 'id':
        if (!value.includes('\0')) this.id = value
        break
      case 'retry':
        if (/^\d+$/.test(value)) this.retry = Number(value)
        break
    }
  }
}
