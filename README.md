# LogoPay.js

**Logo-infused QR Code & Barcode Generation Library**  
Version 1.0.0 · MIT License

Generate QR codes and Code-128 barcodes where the empty white spaces are filled with your logo/image, while dark modules stay solid black for reliable scanning. Export as PNG, JPEG, WebP, or SVG.

---

## Quick Start

```html
<!-- Drop into any HTML page — no dependencies, no build step -->
<script src="logopay.js"></script>
```

Or via CommonJS / Node:
```js
const LogoPay = require('./logopay.js');
```

---

## API Reference

### `LogoPay.QRCode(options)` → Result

Generates a logo-filled QR code (ECC Medium, versions 1–7).

| Option | Type | Default | Description |
|---|---|---|---|
| `text` | string | *(required)* | Data to encode |
| `image` | HTMLImageElement | `null` | Logo to fill light spaces |
| `size` | number | `400` | Output size in px (square) |
| `quietZone` | number | `3` | Quiet zone in modules |
| `darkColor` | string | `'#000000'` | Dark module color |
| `lightColor` | string | `'#ffffff'` | Light area color (no image) |
| `cornerRadius` | number | `0.15` | Module corner rounding 0–0.5 |
| `logoBrightness` | number | `1.1` | Logo brightness filter |
| `logoSaturation` | number | `1.3` | Logo saturation filter |
| `lightModuleOpacity` | number | `0.5` | White overlay opacity 0-1 blended over the QR data area to keep light modules clearly brighter than dark modules. Increase toward `1` for better scannability with dark logos; decrease toward `0` for more logo color saturation. |

**Returns:**
```js
{
  canvas:      HTMLCanvasElement,   // ready to append / display
  toSVG():     string,              // full SVG with embedded logo
  toDataURL(type): string,          // base64 data URL
  download(filename, type): void,   // triggers browser download
  meta: { version, size, matrix }   // QR metadata
}
```

**Example:**
```js
const img = new Image();
img.src = 'logo.png';
img.onload = () => {
  const qr = LogoPay.QRCode({
    text:  'https://pay.example.com/invoice/0088',
    image: img,
    size:  400,
  });
  document.body.appendChild(qr.canvas);
  qr.download('payment-qr', 'png');
  qr.download('payment-qr', 'svg');
};
```

---

### `LogoPay.Barcode(options)` → Result

Generates a logo-filled Code-128 barcode.

| Option | Type | Default | Description |
|---|---|---|---|
| `text` | string | *(required)* | Printable ASCII text to encode |
| `image` | HTMLImageElement | `null` | Logo for light area fill |
| `width` | number | `600` | Canvas width px |
| `height` | number | `150` | Canvas height px |
| `barScale` | number | `3` | Pixels per narrow bar unit |
| `quietZonePx` | number | `20` | Quiet zone pixels each side |
| `darkColor` | string | `'#000000'` | Bar color |
| `lightColor` | string | `'#ffffff'` | Background (no image) |
| `showText` | boolean | `true` | Show text below bars |
| `logoBrightness` | number | `1.1` | Logo brightness |
| `logoSaturation` | number | `1.3` | Logo saturation |
| `lightModuleOpacity` | number | `0.5` | White overlay opacity 0-1 blended over light bar spaces. Higher values improve scannability with dark logos; lower values show more logo color. |

**Returns:** Same shape as QRCode (`canvas`, `toSVG()`, `toDataURL()`, `download()`)

**Example:**
```js
const bc = LogoPay.Barcode({
  text:     'INV-2024-0088',
  image:    img,
  width:    600,
  height:   150,
  barScale: 3,
  showText: true,
});
bc.download('barcode', 'svg');
```

---

### `LogoPay.ImageTool(source?)` → Tool

Resize, crop, and convert images to any format including SVG.

**Load sources:**
- `File` object (from `<input type="file">`)
- `HTMLImageElement`
- `HTMLCanvasElement`
- Data URL string

**Methods (chainable):**

| Method | Returns | Description |
|---|---|---|
| `.load(source)` | `Promise<Tool>` | Load image from any supported source |
| `.resize(w, h, mode)` | `Tool` | Resize. mode: `'fit'` / `'fill'` / `'stretch'` |
| `.crop(x, y, w, h)` | `Tool` | Crop to region |
| `.toCanvas()` | `HTMLCanvasElement` | Get current canvas (sync) |
| `.toDataURL(type, quality)` | `string` | Get base64 data URL (sync) |
| `.toSVG()` | `string` | Get SVG string with embedded image (sync) |
| `.toBlob(type, quality)` | `Promise<Blob>` | Get Blob |
| `.download(filename, type)` | `void` | Trigger browser download |
| `.getImageElement()` | `HTMLImageElement` | Get as `<img>` element |

**Supported output types:** `png`, `jpeg`, `webp`, `svg`

**Example:**
```js
const tool = LogoPay.ImageTool();
tool.load(fileInput.files[0])
  .then(t => t.resize(512, 512, 'fill'))
  .then(t => {
    t.download('thumbnail', 'png');
    t.download('thumbnail', 'svg');   // SVG with embedded raster
    t.download('thumbnail', 'webp');
  });

// Crop then resize
tool.load(imgEl)
  .then(t => {
    t.crop(50, 50, 300, 300);
    t.resize(256, 256, 'stretch');
    t.download('cropped', 'jpeg');
  });
```

---

## Size Recommendations

| Use Case | QR Size | Barcode Width |
|---|---|---|
| Mobile screen | 200–300px | 400px |
| Web / app | 400px | 600px |
| Print (business card) | 600px | 800px |
| Print (poster / signage) | 1200px+ | 1400px+ |

---

## How the Logo Fill Works

1. **White canvas** is drawn as base
2. **Logo image** is stretched across entire canvas
3. A **semi-transparent white overlay** (controlled by `lightModuleOpacity`) is blended over the data area so light modules remain clearly brighter than dark modules even when the logo contains dark areas
4. **Solid dark modules** are stamped on top with the chosen `darkColor`
5. **White quiet zone** border is restored (required for scanner lock-on)

Dark modules are always solid and never modified. The white overlay in step 3 ensures light modules stay distinguishable from dark modules regardless of logo content, keeping the QR/barcode reliably scannable.

---

## SVG Output

SVG exports embed the logo as a base64 `<image>` element, with all dark modules as `<rect>` elements. The result is a valid, scalable SVG file that can be edited in Figma, Illustrator, or Inkscape.

---

## Browser Support

Any modern browser with Canvas API support (Chrome 60+, Firefox 55+, Safari 12+, Edge 79+).

No external dependencies. No network requests. Everything runs locally.

---

## License

MIT — free for personal and commercial use.
