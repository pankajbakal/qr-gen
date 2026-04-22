/**
 * LogoPay.js — Logo-infused QR & Barcode Generation Library
 * Version: 1.0.0
 * License: MIT
 *
 * Generates QR codes and Code-128 barcodes where the empty (white) spaces
 * are filled with your image/logo, while dark modules stay solid black
 * for reliable scanning.
 *
 * Exports:
 *   LogoPay.QRCode    — QR code generator (returns canvas or SVG)
 *   LogoPay.Barcode   — Code-128 barcode generator (returns canvas or SVG)
 *   LogoPay.ImageTool — Image resize / format converter utility
 */

(function (root, factory) {
  var lib = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = lib;                // CommonJS / Node
  } else if (typeof define === 'function' && define.amd) {
    define([], function () { return lib; }); // AMD
  }
  // Always expose as a browser global so that plain <script> usage works
  // even in environments where module / define are also present (e.g. Electron).
  if (typeof window !== 'undefined') {
    window.LogoPay = lib;
  } else {
    root.LogoPay = lib;
  }
}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  //  INTERNAL: GF(256) + Reed-Solomon for QR
  // ═══════════════════════════════════════════════════════════════
  const _GF = (() => {
    const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x = (x << 1) ^ (x & 0x80 ? 0x11D : 0);
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    const mul = (a, b) => (a && b) ? EXP[(LOG[a] + LOG[b]) % 255] : 0;

    function poly(n) {
      let g = [1];
      for (let i = 0; i < n; i++) {
        const r = new Array(g.length + 1).fill(0);
        for (let j = 0; j < g.length; j++) { r[j] ^= g[j]; r[j+1] ^= mul(g[j], EXP[i]); }
        g = r;
      }
      return g;
    }
    function encode(data, n) {
      const g = poly(n), rem = new Array(n).fill(0);
      for (const b of data) {
        const lead = b ^ rem.shift(); rem.push(0);
        for (let j = 0; j < rem.length; j++) rem[j] ^= mul(g[j+1], lead);
      }
      return rem;
    }
    return { mul, poly, encode };
  })();

  // ═══════════════════════════════════════════════════════════════
  //  INTERNAL: QR Matrix Builder (versions 1-7, ECC Medium)
  // ═══════════════════════════════════════════════════════════════
  function _buildQRMatrix(text) {
    // Version table: [totalDataBytes, ecBytesPerBlock, numBlocks]
    const VER = [null,
      {D:16,E:10,B:1}, {D:28,E:16,B:1}, {D:44,E:26,B:1},
      {D:64,E:18,B:2}, {D:86,E:24,B:2}, {D:108,E:16,B:4}, {D:124,E:18,B:4}
    ];
    // Alignment centre positions per version (index = version)
    const ALIGN = [null, null, [6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38]];

    const bytes = [...new TextEncoder().encode(text)];
    let version = -1;
    for (let v = 1; v <= 7; v++) {
      if (VER[v].D >= bytes.length + 2) { version = v; break; }
    }
    if (version < 0) throw new Error('Data too long for QR version 1-7. Use fewer characters.');

    const {D, E, B} = VER[version];
    const dcPB = Math.floor(D / B);
    const size  = version * 4 + 17;

    // Build bitstream (byte mode)
    const bits = [];
    const pb = (v, n) => { for (let i = n-1; i >= 0; i--) bits.push((v>>i)&1); };
    pb(4, 4); pb(bytes.length, 8);
    for (const b of bytes) pb(b, 8);
    pb(0, Math.min(4, D*B*8 - bits.length));
    while (bits.length % 8) bits.push(0);
    let tog = 0;
    while (bits.length < D*B*8) { pb(tog ? 0x11 : 0xEC, 8); tog ^= 1; }
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0; for (let j = 0; j < 8; j++) b = (b<<1)|bits[i+j]; cw.push(b);
    }

    // ECC + interleave
    const DB = [], EB = [];
    for (let b = 0; b < B; b++) {
      const blk = cw.slice(b*dcPB, (b+1)*dcPB);
      DB.push(blk); EB.push(_GF.encode(blk, E));
    }
    const out = [];
    for (let i = 0; i < dcPB; i++) for (const b of DB) out.push(b[i]);
    for (let i = 0; i < E;    i++) for (const b of EB) out.push(b[i]);

    // Matrix
    const mat = Array.from({length:size}, () => new Array(size).fill(-1));
    const fn  = Array.from({length:size}, () => new Uint8Array(size));
    const ok  = (r,c) => r>=0 && r<size && c>=0 && c<size;
    function put(r,c,v) { if(ok(r,c)){ mat[r][c]=v; fn[r][c]=1; } }
    function fill(r,c,h,w,v) { for(let dr=0;dr<h;dr++) for(let dc=0;dc<w;dc++) put(r+dr,c+dc,v); }

    // Finder + separators
    function finder(tr,tc) {
      fill(tr,tc,7,7,1); fill(tr+1,tc+1,5,5,0); fill(tr+2,tc+2,3,3,1);
      for(let i=-1;i<=7;i++){put(tr-1,tc+i,0);put(tr+7,tc+i,0);put(tr+i,tc-1,0);put(tr+i,tc+7,0);}
    }
    finder(0,0); finder(0,size-7); finder(size-7,0);

    // Timing
    for(let i=8;i<size-8;i++){put(6,i,i%2?0:1);put(i,6,i%2?0:1);}
    put(4*version+9,8,1); // dark module

    // Alignment patterns
    if (version >= 2) {
      const ap = ALIGN[version];
      for (const ar of ap) for (const ac of ap) {
        if (fn[ar][ac]) continue;
        fill(ar-2,ac-2,5,5,1); fill(ar-1,ac-1,3,3,0); put(ar,ac,1);
      }
    }

    // Reserve format strips
    for(let i=0;i<=8;i++){if(!fn[8][i])put(8,i,0);if(!fn[i][8])put(i,8,0);}
    for(let i=size-8;i<size;i++){put(8,i,0);put(i,8,0);}

    // Place data
    let bit=0, up=true;
    for(let col=size-1;col>=1;col-=2){
      if(col===6)col=5;
      for(let idx=0;idx<size;idx++){
        const r=up?size-1-idx:idx;
        for(let dx=0;dx<=1;dx++){
          const c=col-dx;
          if(ok(r,c)&&!fn[r][c]){
            const bi=Math.floor(bit/8),bp=7-(bit%8);
            mat[r][c]=bi<out.length?(out[bi]>>bp)&1:0; bit++;
          }
        }
      }
      up=!up;
    }

    // Mask selection
    function applyMask(id){
      const nm=mat.map(r=>[...r]);
      for(let r=0;r<size;r++) for(let c=0;c<size;c++){
        if(fn[r][c]||nm[r][c]<0)continue;
        let f=false;
        switch(id){
          case 0:f=(r+c)%2===0;break; case 1:f=r%2===0;break;
          case 2:f=c%3===0;break;     case 3:f=(r+c)%3===0;break;
          case 4:f=(Math.floor(r/2)+Math.floor(c/3))%2===0;break;
          case 5:f=(r*c)%2+(r*c)%3===0;break;
          case 6:f=((r*c)%2+(r*c)%3)%2===0;break;
          case 7:f=((r+c)%2+(r*c)%3)%2===0;break;
        }
        if(f)nm[r][c]^=1;
      }
      return nm;
    }
    function pen(nm){
      let p=0;
      for(let r=0;r<size;r++){let k=1;for(let c=1;c<size;c++){if(nm[r][c]===nm[r][c-1]){k++;if(k===5)p+=3;else if(k>5)p++;}else k=1;}}
      for(let c=0;c<size;c++){let k=1;for(let r=1;r<size;r++){if(nm[r][c]===nm[r-1][c]){k++;if(k===5)p+=3;else if(k>5)p++;}else k=1;}}
      for(let r=0;r<size-1;r++)for(let c=0;c<size-1;c++)if(nm[r][c]===nm[r+1][c]&&nm[r][c]===nm[r][c+1]&&nm[r][c]===nm[r+1][c+1])p+=3;
      return p;
    }
    let bm=0,bp=Infinity;
    for(let mk=0;mk<8;mk++){const p=pen(applyMask(mk));if(p<bp){bp=p;bm=mk;}}
    const final=applyMask(bm);

    // Format info
    const fd=(0b00<<3)|bm;
    let fr=fd<<10;
    for(let i=14;i>=10;i--)if(fr&(1<<i))fr^=0x537<<(i-10);
    const fw=((fd<<10)|fr)^0x5412;
    const fb=i=>(fw>>(14-i))&1;
    const fpos=[[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    for(let i=0;i<15;i++)final[fpos[i][0]][fpos[i][1]]=fb(i);
    for(let i=0;i<7;i++) final[size-1-i][8]=fb(i);
    for(let i=7;i<15;i++)final[8][size-15+i]=fb(i);
    final[4*version+9][8]=1;
    for(let r=0;r<size;r++)for(let c=0;c<size;c++)if(final[r][c]<0)final[r][c]=0;

    return { matrix: final, size, version };
  }

  // ═══════════════════════════════════════════════════════════════
  //  INTERNAL: Code-128B encoder → array of bar widths
  // ═══════════════════════════════════════════════════════════════
  function _buildCode128(text) {
    // Code 128-B patterns (11-bit each, 1=bar 0=space)
    const PATTERNS = [
      '11011001100','11001101100','11001100110','10010011000','10010001100',
      '10001001100','10011001000','10011000100','10001100100','11001001000',
      '11001000100','11000100100','10110011100','10011011100','10011001110',
      '10111001100','10011101100','10011100110','11001110010','11001011100',
      '11001001110','11011100100','11001110100','11101101110','11101001100',
      '11100101100','11100100110','11101100100','11100110100','11100110010',
      '11011011000','11011000110','11000110110','10100011000','10001011000',
      '10001000110','10110001000','10001101000','10001100010','11010001000',
      '11000101000','11000100010','10110111000','10110001110','10001101110',
      '10111011000','10111000110','10001110110','11101110110','11010001110',
      '11000101110','11011101000','11011100010','11011101110','11101011000',
      '11101000110','11100010110','11101101000','11101100010','11100011010',
      '11101111010','11001000010','11110001010','10100110000','10100001100',
      '10010110000','10010000110','10000101100','10000100110','10110010000',
      '10110000100','10011010000','10011000010','10000110100','10000110010',
      '11000010010','11001010000','11110111010','11000010100','10001111010',
      '10100111100','10010111100','10010011110','10111100100','10011110100',
      '10011110010','11110100100','11110010100','11110010010','11011011110',
      '11011110110','11110110110','10101111000','10100011110','10001011110',
      '10111101000','10111100010','11110101000','11110100010','10111011110',
      '10111101110','11101011110','11110101110','11010000100','11010010000',
      '11010011100','1100011101011' // stop
    ];
    const START_B = 104;
    const charVal = ch => {
      const code = ch.charCodeAt(0);
      if (code >= 32 && code <= 126) return code - 32;
      return -1;
    };

    const vals = [START_B];
    let checksum = START_B;
    for (let i = 0; i < text.length; i++) {
      const v = charVal(text[i]);
      if (v < 0) continue;
      vals.push(v);
      checksum += v * (i + 1);
    }
    vals.push(checksum % 103); // check character

    // Build bit string
    let bits = '';
    for (const v of vals) bits += PATTERNS[v < PATTERNS.length ? v : 0];
    bits += PATTERNS[PATTERNS.length - 1]; // stop pattern
    bits += '11'; // final bars

    return bits;
  }

  // ═══════════════════════════════════════════════════════════════
  //  INTERNAL: Canvas helpers
  // ═══════════════════════════════════════════════════════════════
  function _rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
    ctx.closePath();
  }

  function _makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // ═══════════════════════════════════════════════════════════════
  //  INTERNAL: Render logo background onto a canvas
  // ═══════════════════════════════════════════════════════════════
  function _renderLogoBackground(imgEl, width, height, brightness, saturation) {
    const c = _makeCanvas(width, height);
    const ctx = c.getContext('2d');
    ctx.filter = `brightness(${brightness || 1.1}) saturate(${saturation || 1.3})`;
    ctx.drawImage(imgEl, 0, 0, width, height);
    return c;
  }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  /**
   * QRCode — generate a logo-filled QR code
   *
   * @param {object} options
   *   text          {string}           Data to encode (required)
   *   image         {HTMLImageElement} Logo image (optional)
   *   size          {number}           Output size in px (default 400)
   *   quietZone     {number}           Quiet zone in modules (default 3)
   *   darkColor     {string}           Dark module color (default '#000000')
   *   lightColor    {string}           Light module color when no image (default '#ffffff')
   *   cornerRadius  {number}           Module corner radius 0-0.5 (default 0.15)
   *   logoBrightness {number}          Logo brightness filter (default 1.1)
   *   logoSaturation {number}          Logo saturation filter (default 1.3)
   *
   * @returns {object}  { canvas, toSVG(), toDataURL(type), download(filename, type) }
   */
  function QRCode(options) {
    const opts = Object.assign({
      text: '',
      image: null,
      size: 400,
      quietZone: 3,
      darkColor: '#000000',
      lightColor: '#ffffff',
      cornerRadius: 0.15,
      logoBrightness: 1.1,
      logoSaturation: 1.3,
    }, options);

    if (!opts.text) throw new Error('LogoPay.QRCode: text is required');

    const qr      = _buildQRMatrix(opts.text);
    const { matrix, size: qrSize } = qr;
    const quiet   = opts.quietZone;
    const totalMods = qrSize + quiet * 2;
    const modPx   = opts.size / totalMods;
    const canvasPx = opts.size;

    const canvas = _makeCanvas(canvasPx, canvasPx);
    const ctx    = canvas.getContext('2d');

    // White base
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasPx, canvasPx);

    // Logo background (if provided)
    if (opts.image) {
      const logoBg = _renderLogoBackground(opts.image, canvasPx, canvasPx, opts.logoBrightness, opts.logoSaturation);
      ctx.drawImage(logoBg, 0, 0);
    } else {
      ctx.fillStyle = opts.lightColor;
      ctx.fillRect(0, 0, canvasPx, canvasPx);
    }

    // Draw dark modules on top
    const rad = modPx * Math.max(0, Math.min(0.5, opts.cornerRadius));
    for (let row = 0; row < qrSize; row++) {
      for (let col = 0; col < qrSize; col++) {
        if (matrix[row][col] !== 1) continue;
        const x = (col + quiet) * modPx;
        const y = (row + quiet) * modPx;
        ctx.fillStyle = opts.darkColor;
        _rrect(ctx, x + 0.5, y + 0.5, modPx - 1, modPx - 1, rad);
        ctx.fill();
      }
    }

    // White quiet zone border (scanners require clean border)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasPx, quiet * modPx);
    ctx.fillRect(0, (qrSize + quiet) * modPx, canvasPx, quiet * modPx);
    ctx.fillRect(0, quiet * modPx, quiet * modPx, qrSize * modPx);
    ctx.fillRect((qrSize + quiet) * modPx, quiet * modPx, quiet * modPx, qrSize * modPx);

    // ── SVG export ─────────────────────────────────────
    function toSVG() {
      const svgSize = opts.size;
      const parts = [];
      parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
      parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${svgSize}" height="${svgSize}" viewBox="0 0 ${svgSize} ${svgSize}">`);

      // White background
      parts.push(`<rect width="${svgSize}" height="${svgSize}" fill="white"/>`);

      // Embed logo as base64 image if provided
      if (opts.image) {
        const imgCanvas = _makeCanvas(svgSize, svgSize);
        const imgCtx = imgCanvas.getContext('2d');
        imgCtx.filter = `brightness(${opts.logoBrightness}) saturate(${opts.logoSaturation})`;
        imgCtx.drawImage(opts.image, 0, 0, svgSize, svgSize);
        const b64 = imgCanvas.toDataURL('image/png');
        parts.push(`<image x="0" y="0" width="${svgSize}" height="${svgSize}" xlink:href="${b64}"/>`);
      }

      // White quiet zone
      const qpx = quiet * modPx;
      const dataPx = qrSize * modPx;
      parts.push(`<rect x="0" y="0" width="${svgSize}" height="${qpx}" fill="white"/>`);
      parts.push(`<rect x="0" y="${qpx+dataPx}" width="${svgSize}" height="${qpx}" fill="white"/>`);
      parts.push(`<rect x="0" y="${qpx}" width="${qpx}" height="${dataPx}" fill="white"/>`);
      parts.push(`<rect x="${qpx+dataPx}" y="${qpx}" width="${qpx}" height="${dataPx}" fill="white"/>`);

      // Dark modules
      const r = rad.toFixed(2);
      for (let row = 0; row < qrSize; row++) {
        for (let col = 0; col < qrSize; col++) {
          if (matrix[row][col] !== 1) continue;
          const x = ((col + quiet) * modPx + 0.5).toFixed(2);
          const y = ((row + quiet) * modPx + 0.5).toFixed(2);
          const w = (modPx - 1).toFixed(2);
          parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${w}" rx="${r}" ry="${r}" fill="${opts.darkColor}"/>`);
        }
      }

      parts.push(`</svg>`);
      return parts.join('\n');
    }

    // ── Helpers ────────────────────────────────────────
    function toDataURL(type) {
      return canvas.toDataURL(type || 'image/png');
    }

    function download(filename, type) {
      const fmt = type || 'png';
      const name = (filename || 'logopay-qr') + '.' + fmt;
      if (fmt === 'svg') {
        const blob = new Blob([toSVG()], { type: 'image/svg+xml' });
        const url  = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const a = document.createElement('a');
        a.download = name; a.href = canvas.toDataURL('image/' + fmt); a.click();
      }
    }

    return { canvas, toSVG, toDataURL, download, meta: qr };
  }

  // ───────────────────────────────────────────────────────────────

  /**
   * Barcode — generate a logo-filled Code-128 barcode
   *
   * @param {object} options
   *   text          {string}           Data to encode (required)
   *   image         {HTMLImageElement} Logo image (optional)
   *   width         {number}           Canvas width px (default 600)
   *   height        {number}           Bar height px (default 150)
   *   barScale      {number}           Pixels per narrow bar unit (default 3)
   *   quietZonePx   {number}           Quiet zone pixels each side (default 20)
   *   darkColor     {string}           Bar color (default '#000000')
   *   lightColor    {string}           Background color (default '#ffffff')
   *   showText      {boolean}          Show text below bars (default true)
   *   logoBrightness {number}          (default 1.1)
   *   logoSaturation {number}          (default 1.3)
   *
   * @returns {object}  { canvas, toSVG(), toDataURL(type), download(filename, type) }
   */
  function Barcode(options) {
    const opts = Object.assign({
      text: '',
      image: null,
      width: 600,
      height: 150,
      barScale: 3,
      quietZonePx: 20,
      darkColor: '#000000',
      lightColor: '#ffffff',
      showText: true,
      logoBrightness: 1.1,
      logoSaturation: 1.3,
    }, options);

    if (!opts.text) throw new Error('LogoPay.Barcode: text is required');

    const bits = _buildCode128(opts.text);
    const textAreaH = opts.showText ? 22 : 0;
    const barH      = opts.height - textAreaH;
    const totalBits = bits.length;
    const scale     = opts.barScale;
    const barsTotalW = totalBits * scale;
    const canvasW   = Math.max(opts.width, barsTotalW + opts.quietZonePx * 2);
    const canvasH   = opts.height;
    const offsetX   = Math.floor((canvasW - barsTotalW) / 2); // center bars

    const canvas = _makeCanvas(canvasW, canvasH);
    const ctx    = canvas.getContext('2d');

    // White base
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Logo background
    if (opts.image) {
      const logoBg = _renderLogoBackground(opts.image, canvasW, barH, opts.logoBrightness, opts.logoSaturation);
      ctx.drawImage(logoBg, 0, 0);
    } else {
      ctx.fillStyle = opts.lightColor;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }

    // Draw bars (dark only — light spaces let logo show through)
    for (let i = 0; i < totalBits; i++) {
      if (bits[i] === '1') {
        ctx.fillStyle = opts.darkColor;
        ctx.fillRect(offsetX + i * scale, 0, scale, barH);
      }
    }

    // Text below
    if (opts.showText) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, barH, canvasW, textAreaH);
      ctx.fillStyle = '#222222';
      ctx.font      = '13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(opts.text, canvasW / 2, barH + 16);
    }

    // SVG export
    function toSVG() {
      const parts = [];
      parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
      parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">`);
      parts.push(`<rect width="${canvasW}" height="${canvasH}" fill="white"/>`);

      if (opts.image) {
        const imgCanvas = _makeCanvas(canvasW, barH);
        const imgCtx = imgCanvas.getContext('2d');
        imgCtx.filter = `brightness(${opts.logoBrightness}) saturate(${opts.logoSaturation})`;
        imgCtx.drawImage(opts.image, 0, 0, canvasW, barH);
        const b64 = imgCanvas.toDataURL('image/png');
        parts.push(`<image x="0" y="0" width="${canvasW}" height="${barH}" xlink:href="${b64}"/>`);
      }

      for (let i = 0; i < totalBits; i++) {
        if (bits[i] === '1') {
          parts.push(`<rect x="${offsetX + i*scale}" y="0" width="${scale}" height="${barH}" fill="${opts.darkColor}"/>`);
        }
      }

      if (opts.showText) {
        parts.push(`<rect x="0" y="${barH}" width="${canvasW}" height="${textAreaH}" fill="white"/>`);
        parts.push(`<text x="${canvasW/2}" y="${barH+16}" font-family="monospace" font-size="13" text-anchor="middle" fill="#222">${_escXML(opts.text)}</text>`);
      }
      parts.push(`</svg>`);
      return parts.join('\n');
    }

    function toDataURL(type) { return canvas.toDataURL(type || 'image/png'); }

    function download(filename, type) {
      const fmt = type || 'png';
      const name = (filename || 'logopay-barcode') + '.' + fmt;
      if (fmt === 'svg') {
        const blob = new Blob([toSVG()], { type: 'image/svg+xml' });
        const url  = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const a = document.createElement('a');
        a.download = name; a.href = canvas.toDataURL('image/' + fmt); a.click();
      }
    }

    return { canvas, toSVG, toDataURL, download };
  }

  // ───────────────────────────────────────────────────────────────

  /**
   * ImageTool — resize, crop, and convert images
   *
   * @param {HTMLImageElement|HTMLCanvasElement|File|string} source
   *   Accepts an img element, canvas, File object, or data URL string
   *
   * Methods (all return Promise<ImageTool> unless noted):
   *   .load(source)                   Load / reload source
   *   .resize(width, height, mode)    Resize: mode = 'fit'|'fill'|'stretch' (default 'fit')
   *   .crop(x, y, width, height)      Crop to region
   *   .toCanvas()                     Returns HTMLCanvasElement (sync)
   *   .toDataURL(type, quality)       Returns data URL string (sync)
   *   .toSVG()                        Returns SVG string with embedded raster (sync)
   *   .toBlob(type, quality)          Returns Promise<Blob>
   *   .download(filename, type)       Triggers browser download
   *   .getImageElement()              Returns HTMLImageElement (sync, after load)
   */
  function ImageTool(source) {
    let _canvas = _makeCanvas(1, 1);
    let _ready  = false;

    function _loadFromImg(img) {
      _canvas = _makeCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
      _canvas.getContext('2d').drawImage(img, 0, 0);
      _ready = true;
    }

    function load(src) {
      return new Promise((resolve, reject) => {
        if (!src) { reject(new Error('No source provided')); return; }

        if (src instanceof HTMLCanvasElement) {
          _canvas = _makeCanvas(src.width, src.height);
          _canvas.getContext('2d').drawImage(src, 0, 0);
          _ready = true; resolve(tool); return;
        }

        if (src instanceof HTMLImageElement) {
          if (src.complete && src.naturalWidth) { _loadFromImg(src); resolve(tool); return; }
          src.onload  = () => { _loadFromImg(src); resolve(tool); };
          src.onerror = reject; return;
        }

        if (src instanceof File) {
          const reader = new FileReader();
          reader.onload = ev => { load(ev.target.result).then(resolve).catch(reject); };
          reader.onerror = reject;
          reader.readAsDataURL(src); return;
        }

        if (typeof src === 'string') {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload  = () => { _loadFromImg(img); resolve(tool); };
          img.onerror = reject;
          img.src = src; return;
        }

        reject(new Error('Unsupported source type'));
      });
    }

    function resize(width, height, mode) {
      if (!_ready) throw new Error('ImageTool: call load() first');
      mode = mode || 'fit';
      const sw = _canvas.width, sh = _canvas.height;
      let dw = width, dh = height;
      let sx=0, sy=0, sWidth=sw, sHeight=sh;

      if (mode === 'fit') {
        const ratio = Math.min(width/sw, height/sh);
        dw = Math.round(sw * ratio); dh = Math.round(sh * ratio);
      } else if (mode === 'fill') {
        const ratio = Math.max(width/sw, height/sh);
        const scaledW = Math.round(sw*ratio), scaledH = Math.round(sh*ratio);
        sx = Math.floor((scaledW - width)  / 2 / ratio);
        sy = Math.floor((scaledH - height) / 2 / ratio);
        sWidth  = Math.round(width  / ratio);
        sHeight = Math.round(height / ratio);
        dw = width; dh = height;
      }

      const out = _makeCanvas(dw, dh);
      out.getContext('2d').drawImage(_canvas, sx, sy, sWidth, sHeight, 0, 0, dw, dh);
      _canvas = out;
      return tool;
    }

    function crop(x, y, width, height) {
      if (!_ready) throw new Error('ImageTool: call load() first');
      const out = _makeCanvas(width, height);
      out.getContext('2d').drawImage(_canvas, x, y, width, height, 0, 0, width, height);
      _canvas = out;
      return tool;
    }

    function toCanvas() { return _canvas; }

    function toDataURL(type, quality) {
      return _canvas.toDataURL(type || 'image/png', quality);
    }

    function toSVG() {
      const w = _canvas.width, h = _canvas.height;
      const b64 = _canvas.toDataURL('image/png');
      return [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
        `<image x="0" y="0" width="${w}" height="${h}" xlink:href="${b64}"/>`,
        `</svg>`
      ].join('\n');
    }

    function toBlob(type, quality) {
      return new Promise(resolve => _canvas.toBlob(resolve, type || 'image/png', quality));
    }

    function download(filename, type) {
      const fmt  = (type || 'png').toLowerCase().replace('image/', '');
      const name = (filename || 'logopay-image') + '.' + fmt;
      if (fmt === 'svg') {
        const blob = new Blob([toSVG()], { type: 'image/svg+xml' });
        const url  = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const a = document.createElement('a');
        a.download = name;
        a.href = _canvas.toDataURL('image/' + fmt);
        a.click();
      }
    }

    function getImageElement() {
      const img = new Image();
      img.src = _canvas.toDataURL('image/png');
      return img;
    }

    const tool = { load, resize, crop, toCanvas, toDataURL, toSVG, toBlob, download, getImageElement };

    // Auto-load if source provided at construction
    if (source) load(source);

    return tool;
  }

  // ── XML escape helper ──────────────────────────────────────────
  function _escXML(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Public API surface ─────────────────────────────────────────
  return {
    QRCode,
    Barcode,
    ImageTool,
    version: '1.0.0',
  };

}));
