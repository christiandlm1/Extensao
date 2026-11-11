/* strip.js — remove metadados de arquivos MP4 progressivos.
   Remove boxes udta/meta (título, comentário, encoder, etc.) em qualquer nível,
   zera tempos de criação/modificação (mvhd/tkhd/mdhd) e corrige os offsets
   absolutos de stco/co64 afetados pela remoção. Arquivos fragmentados (moof)
   são ignorados (offets absolutos em trun — não mexe).
   Uso: __igdwnStripMp4Metadata(ArrayBuffer) -> { buf, removed, times } | null.
   Funciona em content script, service worker e páginas da extensão. */

(() => {
  'use strict';

  const DESCEND = { moov: 1, trak: 1, mdia: 1, minf: 1, stbl: 1 };
  const REMOVE = { udta: 1, meta: 1 };
  const PATCH_TIMES = { mvhd: 1, tkhd: 1, mdhd: 1 };

  function stripMp4Metadata(buf) {
    if (!buf || buf.byteLength < 16) return null;
    const u8 = new Uint8Array(buf);
    if (u8[4] !== 0x66 || u8[5] !== 0x74 || u8[6] !== 0x79 || u8[7] !== 0x70) return null;
    const view = new DataView(buf);
    const n = buf.byteLength;

    const removed = [];
    const stco = [];
    const times = [];
    const containers = [];
    let fragmented = false;
    let mdatStart = -1;
    let mdatEnd = -1;

    function boxAt(start, limit) {
      if (start + 8 > limit) return null;
      const size32 = view.getUint32(start);
      const type = String.fromCharCode(
        u8[start + 4], u8[start + 5], u8[start + 6], u8[start + 7]
      );
      let size = size32;
      let headerLen = 8;
      if (size === 1) {
        if (start + 16 > limit) return null;
        const hi = view.getUint32(start + 8);
        const lo = view.getUint32(start + 12);
        if (hi > 0x1fffff) return null;
        size = hi * 0x100000000 + lo;
        headerLen = 16;
      } else if (size === 0) {
        size = limit - start;
      }
      if (size < headerLen || start + size > limit) return null;
      return { start, size, type, headerLen, end: start + size };
    }

    function walk(box) {
      let pos = box.start + box.headerLen;
      const limit = box.end;
      let removedInside = false;
      while (pos + 8 <= limit) {
        const c = boxAt(pos, limit);
        if (!c) return;
        if (DESCEND[c.type]) {
          const before = removed.length;
          walk(c);
          if (removed.length > before) removedInside = true;
        } else if (REMOVE[c.type]) {
          removed.push([c.start, c.end]);
          removedInside = true;
        } else if (PATCH_TIMES[c.type]) {
          times.push({ start: c.start, headerLen: c.headerLen, version: u8[c.start + c.headerLen] });
        } else if (c.type === 'stco' || c.type === 'co64') {
          const entrySize = c.type === 'co64' ? 8 : 4;
          const count = view.getUint32(c.start + c.headerLen + 4);
          if (count > 0 && count * entrySize + c.headerLen + 8 <= c.size) {
            stco.push({
              start: c.start,
              headerLen: c.headerLen,
              entrySize,
              count,
              entriesStart: c.start + c.headerLen + 8,
            });
          }
        }
        pos = c.end;
      }
      if (removedInside) containers.push({ start: box.start, headerLen: box.headerLen, size: box.size, end: box.end });
    }

    let pos = 0;
    while (pos + 8 <= n) {
      const b = boxAt(pos, n);
      if (!b) return null;
      if (b.type === 'moof') fragmented = true;
      if (b.type === 'mdat' && mdatStart < 0) {
        mdatStart = b.start;
        mdatEnd = b.end;
      }
      if (b.type === 'moov') {
        walk(b);
      } else if (REMOVE[b.type]) {
        removed.push([b.start, b.end]);
      }
      pos = b.end;
    }

    if (fragmented) return null;
    if (removed.length === 0 && times.length === 0) return null;

    for (const s of stco) {
      for (let i = 0; i < s.count; i++) {
        const off = s.entrySize === 8
          ? Number(view.getBigUint64(s.entriesStart + i * 8))
          : view.getUint32(s.entriesStart + i * 4);
        if (off < mdatStart || off >= mdatEnd) return null;
      }
    }

    function shiftFor(off) {
      let shift = 0;
      for (const [rs, re] of removed) if (rs < off) shift += re - rs;
      return shift;
    }

    const totalRemoved = removed.reduce((a, [s, e]) => a + (e - s), 0);
    const out = new Uint8Array(n - totalRemoved);
    let w = 0;
    let src = 0;
    const sorted = [...removed].sort((a, b) => a[0] - b[0]);
    for (const [rs, re] of sorted) {
      out.set(u8.subarray(src, rs), w);
      w += rs - src;
      src = re;
    }
    out.set(u8.subarray(src), w);

    const outView = new DataView(out.buffer);
    for (const s of stco) {
      const oStart = s.start - shiftFor(s.start);
      for (let i = 0; i < s.count; i++) {
        const oldOff = s.entrySize === 8
          ? Number(view.getBigUint64(s.entriesStart + i * 8))
          : view.getUint32(s.entriesStart + i * 4);
        const newOff = oldOff - shiftFor(oldOff);
        const at = oStart + (s.entriesStart - s.start) + i * s.entrySize;
        if (s.entrySize === 8) outView.setBigUint64(at, BigInt(newOff));
        else outView.setUint32(at, newOff);
      }
    }

    for (const t of times) {
      const oStart = t.start - shiftFor(t.start);
      const rel = t.headerLen + 4;
      if (t.version === 1) {
        if (oStart + rel + 16 <= out.length) {
          outView.setBigUint64(oStart + rel, 0n);
          outView.setBigUint64(oStart + rel + 8, 0n);
        }
      } else if (oStart + rel + 8 <= out.length) {
        outView.setUint32(oStart + rel, 0);
        outView.setUint32(oStart + rel + 4, 0);
      }
    }

    for (const c of containers) {
      const oStart = c.start - shiftFor(c.start);
      let gone = 0;
      for (const [rs, re] of removed) {
        if (rs >= c.start && re <= c.end) gone += re - rs;
      }
      const newSize = c.size - gone;
      if (newSize < 0) return null;
      if (c.headerLen === 16) {
        if (oStart + 16 <= out.length) outView.setBigUint64(oStart, BigInt(newSize));
      } else if (oStart + 8 <= out.length && newSize < 0x100000000) {
        outView.setUint32(oStart, newSize);
      }
    }

    return { buf: out.buffer, removed: removed.length, times: times.length };
  }

  const root = typeof window !== 'undefined' ? window : self;
  root.__igdwnStripMp4Metadata = stripMp4Metadata;
})();