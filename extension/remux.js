/* remux.js — converte MP4 fragmentado (fMP4: moof+mdat, formato usado pelo
   X/Twitter e HLS) em MP4 progressivo (ftyp+moov+mdat único) que abre em
   qualquer player. Retorna null se o arquivo não for fragmentado ou se não
   der para remuxar.
   Uso: __igdwnRemuxFragmented(ArrayBuffer) -> ArrayBuffer | null. */

(() => {
  'use strict';

  const CH = (u8, p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);

  function boxAt(u8, view, start, limit) {
    if (start + 8 > limit) return null;
    const size32 = view.getUint32(start);
    let size = size32;
    let hdr = 8;
    if (size === 1) {
      if (start + 16 > limit) return null;
      const hi = view.getUint32(start + 8);
      const lo = view.getUint32(start + 12);
      if (hi > 0x1fffff) return null;
      size = hi * 0x100000000 + lo;
      hdr = 16;
    } else if (size === 0) {
      size = limit - start;
    }
    if (size < hdr || start + size > limit) return null;
    return { type: CH(u8, start + 4), start, size, hdr, end: start + size };
  }

  function children(u8, view, b) {
    const out = [];
    let p = b.start + b.hdr;
    while (p + 8 <= b.end) {
      const c = boxAt(u8, view, p, b.end);
      if (!c) break;
      out.push(c);
      p = c.end;
    }
    return out;
  }

  const find = (list, type) => list.find((b) => b.type === type);

  function mkBox(type, ...parts) {
    let len = 8;
    for (const p of parts) len += p.byteLength;
    const out = new Uint8Array(len);
    const v = new DataView(out.buffer);
    v.setUint32(0, len);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    let off = 8;
    for (const p of parts) {
      out.set(p, off);
      off += p.byteLength;
    }
    return out;
  }

  function remuxFragmented(buf) {
    if (!buf || buf.byteLength < 16) return null;
    const u8 = new Uint8Array(buf);
    if (u8[4] !== 0x66 || u8[5] !== 0x74 || u8[6] !== 0x79 || u8[7] !== 0x70) return null;
    const view = new DataView(buf);
    const n = u8.byteLength;

    const top = [];
    let p = 0;
    while (p + 8 <= n) {
      const b = boxAt(u8, view, p, n);
      if (!b) return null;
      top.push(b);
      p = b.end;
    }
    if (!top.some((b) => b.type === 'moof')) return null;
    const moov = find(top, 'moov');
    if (!moov) return null;

    // ---------- trilhas (tkhd/mdhd/hdlr/stsd copiados verbatim) ----------
    const traks = [];
    for (const trak of children(u8, view, moov)) {
      if (trak.type !== 'trak') continue;
      const tkhd = find(children(u8, view, trak), 'tkhd');
      if (!tkhd) continue;
      const tv = u8[tkhd.start + tkhd.hdr];
      const trackId =
        tv === 1
          ? Number(view.getBigUint64(tkhd.start + tkhd.hdr + 20))
          : view.getUint32(tkhd.start + tkhd.hdr + 12);
      const mdia = find(children(u8, view, trak), 'mdia');
      if (!mdia) continue;
      const mdiaKids = children(u8, view, mdia);
      const mdhd = find(mdiaKids, 'mdhd');
      const hdlr = find(mdiaKids, 'hdlr');
      if (!mdhd || !hdlr) continue;
      const mv = u8[mdhd.start + mdhd.hdr];
      const timescale = view.getUint32(mdhd.start + mdhd.hdr + (mv === 1 ? 20 : 12));
      const handler = CH(u8, hdlr.start + hdlr.hdr + 8);
      const minf = find(children(u8, view, mdia), 'minf');
      if (!minf) continue;
      const minfKids = children(u8, view, minf);
      const stbl = find(minfKids, 'stbl');
      if (!stbl) continue;
      const stsd = find(children(u8, view, stbl), 'stsd');
      if (!stsd) continue;
      const vmhd = find(minfKids, 'vmhd') || find(minfKids, 'smhd') || null;
      const dinf = find(minfKids, 'dinf') || null;
      const sl = (b) => (b ? u8.slice(b.start, b.end) : null);
      traks.push({
        id: trackId,
        handler,
        timescale,
        tkhd: sl(tkhd),
        mdhd: sl(mdhd),
        hdlr: sl(hdlr),
        vmhd: sl(vmhd),
        dinf: sl(dinf),
        stsd: sl(stsd),
        trex: null,
        samples: [],
      });
    }
    if (traks.length === 0) return null;
    const byId = new Map(traks.map((t) => [t.id, t]));

    // ---------- defaults por trilha (mvex/trex) ----------
    const mvex = find(children(u8, view, moov), 'mvex');
    if (mvex) {
      for (const trex of children(u8, view, mvex)) {
        if (trex.type !== 'trex') continue;
        const t = byId.get(view.getUint32(trex.start + trex.hdr));
        if (t) {
          t.trex = {
            dur: view.getUint32(trex.start + trex.hdr + 12),
            size: view.getUint32(trex.start + trex.hdr + 16),
            flags: view.getUint32(trex.start + trex.hdr + 20),
          };
        }
      }
    }

    // ---------- amostras dos moofs ----------
    for (const moof of top) {
      if (moof.type !== 'moof') continue;
      for (const traf of children(u8, view, moof)) {
        if (traf.type !== 'traf') continue;
        const tfhd = find(children(u8, view, traf), 'tfhd');
        if (!tfhd) continue;
        const f = view.getUint32(tfhd.start + tfhd.hdr);
        const track = byId.get(view.getUint32(tfhd.start + tfhd.hdr + 4));
        if (!track) continue;
        let q = tfhd.start + tfhd.hdr + 8;
        let base = null;
        if (f & 0x000001) {
          base = Number(view.getBigUint64(q));
          q += 8;
        }
        if (f & 0x000002) q += 4;
        let dDur = null;
        let dSize = null;
        let dFlags = null;
        if (f & 0x000008) {
          dDur = view.getUint32(q);
          q += 4;
        }
        if (f & 0x000010) {
          dSize = view.getUint32(q);
          q += 4;
        }
        if (f & 0x000020) {
          dFlags = view.getUint32(q);
          q += 4;
        }
        const baseIsMoof = !!(f & 0x020000);
        const tx = track.trex;
        const dDurF = dDur != null ? dDur : (tx ? tx.dur : 0);
        const dSizeF = dSize != null ? dSize : (tx ? tx.size : 0);
        const dFlagsF = dFlags != null ? dFlags : (tx ? tx.flags : 0);

        for (const trun of children(u8, view, traf)) {
          if (trun.type !== 'trun') continue;
          const tf = view.getUint32(trun.start + trun.hdr);
          const count = view.getUint32(trun.start + trun.hdr + 4);
          if (count > 1000000) return null;
          let q2 = trun.start + trun.hdr + 8;
          let dataOff = null;
          if (tf & 0x000001) {
            dataOff = view.getUint32(q2);
            q2 += 4;
          }
          let firstFlags = null;
          if (tf & 0x000004) {
            firstFlags = view.getUint32(q2);
            q2 += 4;
          }
          let abs = null;
          if (dataOff != null) {
            const b0 = base != null ? base : baseIsMoof ? moof.start : 0;
            abs = b0 + dataOff;
          } else if (base != null) {
            abs = base + 8;
          }
          if (abs == null) return null;
          for (let i = 0; i < count; i++) {
            let dur = dDurF;
            let size = dSizeF;
            let flags = dFlagsF;
            let cts = 0;
            if (tf & 0x000100) {
              dur = view.getUint32(q2);
              q2 += 4;
            }
            if (tf & 0x000200) {
              size = view.getUint32(q2);
              q2 += 4;
            }
            if (tf & 0x000400) {
              flags = view.getUint32(q2);
              q2 += 4;
            } else if (i === 0 && firstFlags != null) {
              flags = firstFlags;
            }
            if (tf & 0x000800) {
              cts = view.getInt32(q2);
              q2 += 4;
            }
            if (!size || abs + size > n) return null;
            track.samples.push({ size, dur, flags, cts, abs });
            abs += size;
          }
        }
      }
    }
    for (const t of traks) if (t.samples.length === 0) return null;

    // ---------- layout: vídeo primeiro, depois áudio ----------
    const order = [...traks].sort((a, b) => (a.handler === 'vide' ? 0 : 1) - (b.handler === 'vide' ? 0 : 1));
    let dataLen = 0;
    for (const t of order) {
      t.region = dataLen;
      for (const s of t.samples) {
        s.out = dataLen;
        dataLen += s.size;
      }
      t.regionLen = dataLen - t.region;
    }

    // ---------- stbl reconstruído ----------
    const sttsOf = (samples) => {
      const entries = [];
      for (const s of samples) {
        const last = entries[entries.length - 1];
        if (last && last.d === s.dur) last.c += 1;
        else entries.push({ c: 1, d: s.dur });
      }
      const body = new Uint8Array(8 + entries.length * 8);
      const v = new DataView(body.buffer);
      v.setUint32(0, 0);
      v.setUint32(4, entries.length);
      entries.forEach((e, i) => {
        v.setUint32(8 + i * 8, e.c);
        v.setUint32(12 + i * 8, e.d);
      });
      return mkBox('stts', body);
    };
    const stszOf = (samples) => {
      const body = new Uint8Array(8 + samples.length * 4);
      const v = new DataView(body.buffer);
      v.setUint32(0, 0);
      v.setUint32(4, samples.length);
      samples.forEach((s, i) => v.setUint32(8 + i * 4, s.size));
      return mkBox('stsz', body);
    };
    const stscOf = (n) => {
      const body = new Uint8Array(20);
      const v = new DataView(body.buffer);
      v.setUint32(0, 0);
      v.setUint32(4, 1);
      v.setUint32(8, 1);
      v.setUint32(12, n);
      v.setUint32(16, 1);
      return mkBox('stsc', body);
    };
    const stssOf = (samples) => {
      const list = [];
      samples.forEach((s, i) => {
        if (!(s.flags & 0x00010000)) list.push(i + 1);
      });
      if (list.length === samples.length || list.length === 0) return null;
      const body = new Uint8Array(8 + list.length * 4);
      const v = new DataView(body.buffer);
      v.setUint32(0, 0);
      v.setUint32(4, list.length);
      list.forEach((x, i) => v.setUint32(8 + i * 4, x));
      return mkBox('stss', body);
    };
    const cttsOf = (samples) => {
      if (!samples.some((s) => s.cts !== 0)) return null;
      const entries = [];
      for (const s of samples) {
        const last = entries[entries.length - 1];
        if (last && last.o === s.cts) last.c += 1;
        else entries.push({ c: 1, o: s.cts });
      }
      const neg = entries.some((e) => e.o < 0);
      const body = new Uint8Array(8 + entries.length * 8);
      const v = new DataView(body.buffer);
      v.setUint32(0, neg ? 1 : 0);
      v.setUint32(4, entries.length);
      entries.forEach((e, i) => {
        v.setUint32(8 + i * 8, e.c);
        if (neg) v.setInt32(12 + i * 8, e.o);
        else v.setUint32(12 + i * 8, e.o);
      });
      return mkBox('ctts', body);
    };

    // ---------- moov ----------
    const moovParts = [];
    const mvhd = find(children(u8, view, moov), 'mvhd');
    moovParts.push(mvhd ? u8.slice(mvhd.start, mvhd.end) : mkBox('mvhd', new Uint8Array(20)));
    for (const t of order) {
      const boxes = [t.stsd, sttsOf(t.samples), stscOf(t.samples.length), stszOf(t.samples)];
      const stss = stssOf(t.samples);
      if (stss) boxes.push(stss);
      const ctts = cttsOf(t.samples);
      if (ctts) boxes.push(ctts);
      const stcoBody = new Uint8Array(12);
      new DataView(stcoBody.buffer).setUint32(4, 1);
      boxes.push(mkBox('stco', stcoBody));
      const minfKids = [t.vmhd, t.dinf, mkBox('stbl', ...boxes)].filter(Boolean);
      const mdiaBox = mkBox('mdia', t.mdhd, t.hdlr, mkBox('minf', ...minfKids));
      moovParts.push(mkBox('trak', t.tkhd, mdiaBox));
    }
    const moovBox = mkBox('moov', ...moovParts);

    const ftyp = (() => {
      const f = find(top, 'ftyp');
      if (f) return u8.slice(f.start, f.end);
      const body = new Uint8Array(16);
      const w = (s, o) => {
        for (let i = 0; i < 4; i++) body[o + i] = s.charCodeAt(i);
      };
      w('isom', 0);
      w('iso2', 8);
      w('avc1', 12);
      return mkBox('ftyp', body);
    })();

    const mdatStart = ftyp.byteLength + moovBox.byteLength + 8;

    // ---------- corrigir stco (offsets absolutos no mdat) ----------
    let idx = 0;
    (function patch(boxBytes) {
      let q = 0;
      while (q + 8 <= boxBytes.byteLength) {
        const size = new DataView(boxBytes.buffer, boxBytes.byteOffset + q).getUint32(0);
        if (size < 8) break;
        const type = CH(boxBytes, q + 4);
        if (type === 'stco') {
          new DataView(boxBytes.buffer, boxBytes.byteOffset + q + 16).setUint32(
            0,
            mdatStart + order[idx].region
          );
          idx += 1;
          q += size;
        } else {
          patch(boxBytes.subarray(q + 8, q + size));
          q += size;
        }
      }
    })(moovBox);

    // ---------- saída: ftyp + moov + mdat único ----------
    const total = ftyp.byteLength + moovBox.byteLength + 8 + dataLen;
    const out = new Uint8Array(total);
    let w = 0;
    out.set(ftyp, w);
    w += ftyp.byteLength;
    out.set(moovBox, w);
    w += moovBox.byteLength;
    const ov = new DataView(out.buffer);
    ov.setUint32(w, 8 + dataLen);
    out[w + 4] = 0x6d;
    out[w + 5] = 0x64;
    out[w + 6] = 0x61;
    out[w + 7] = 0x74;
    w += 8;
    for (const t of order) {
      for (const s of t.samples) {
        out.set(u8.subarray(s.abs, s.abs + s.size), w + s.out);
      }
    }
    return out.buffer;
  }

  const root = typeof window !== 'undefined' ? window : self;
  root.__igdwnRemuxFragmented = remuxFragmented;
})();