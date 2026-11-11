const out = document.getElementById('out')
  const secure = document.getElementById('secure')
  secure.textContent = window.isSecureContext ? 'так' : 'ні (Web Locks недоступні)'
  secure.className = window.isSecureContext ? 'ok' : 'bad'
  const locks = document.getElementById('locks')
  const hasLocks = !!(navigator.locks && navigator.locks.request)
  locks.textContent = hasLocks ? 'є' : 'немає'
  locks.className = hasLocks ? 'ok' : 'bad'
  const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ')
  async function describe(input, file) {
    const lines = [`Поле ${input.id}: ${file.name}`, `розмір ${file.size} байтів, тип «${file.type || '(порожній)'}»`]
    try {
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
      lines.push(`перші 4 байти (slice): ${hex(head)} ${head[0] === 0x50 && head[1] === 0x4b ? '— ZIP' : ''}`)
      const tailStart = Math.max(0, file.size - 65558)
      const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer())
      let eocd = -1
      for (let i = tail.length - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break }
      if (eocd >= 0) {
        const view = new DataView(tail.buffer, eocd)
        lines.push(`кінець каталогу знайдено: записів ${view.getUint16(10, true)}, каталог ${view.getUint32(12, true)} байтів`)
      } else lines.push('кінець каталогу ZIP не знайдено')
      const mid = new Uint8Array(await file.slice(30, 38).arrayBuffer())
      lines.push(`ім'я першого запису: ${new TextDecoder().decode(mid)}`)
    } catch (error) {
      lines.push(`помилка читання: ${error && error.name} ${error && error.message}`)
    }
    return lines.join('\n')
  }
  for (const input of document.querySelectorAll('input[type=file]')) {
    input.addEventListener('change', async () => {
      const parts = []
      for (const file of input.files) parts.push(await describe(input, file))
      out.textContent = parts.join('\n\n') || 'Нічого не вибрано.'
    })
  }
