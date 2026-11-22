// A small PDF writer, just enough for the map export: one page, vector paths, text in the built-in Helvetica,
// pictures (JPEG, or RGB with a soft mask), clipping and transparency. No library: the PDF operators are plain
// text, and the page is compressed with the browser's own CompressionStream.
//
//   const pdf = new Pdf(widthPt, heightPt);
//   pdf.op('0.2 0.4 0.6 rg 10 10 100 50 re f');       // raw operators; y runs UP from the bottom, in points
//   const im = pdf.image({ width, height, jpeg });    // or { width, height, rgb, alpha }
//   const gs = pdf.opacity(0.8);                       // use as `/${gs} gs`
//   const bytes = await pdf.build();

const enc = new TextEncoder();
const num = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '') || '0');
export { num };

// Text goes out as WinAnsi bytes. Latin-1 passes straight through; a few typographic marks have their own codes;
// anything else is replaced (a subscript 2 becomes a plain 2).
const WIN = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '€': 0x80, '…': 0x85, '₂': 0x32, '≥': 0x3e, '≤': 0x3c };
export function winAnsi(text) {
  const out = [];
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    out.push(WIN[ch] ?? (c < 256 ? c : 0x3f));
  }
  return out;
}
// A text-showing operator: `(…) Tj`, with the characters that need escaping in a PDF string escaped.
export function showText(text) {
  let s = '(';
  for (const b of winAnsi(text)) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) s += '\\' + b.toString(8).padStart(3, '0');
    else s += String.fromCharCode(b);
  }
  return `${s}) Tj`;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class Pdf {
  constructor(width, height) {
    this.width = width; this.height = height;
    this.parts = [];            // content stream, as strings
    this.images = [];           // { name, obj }
    this.gstates = new Map();   // opacity -> name
    this.forms = [];            // transparency groups: { name, parts, bbox }
  }
  op(s) { this.parts.push(s); }
  opacity(a, stroke = false) {
    const key = `${a}${stroke ? 's' : 'f'}`;
    if (!this.gstates.has(key)) this.gstates.set(key, { name: `G${this.gstates.size}`, a, stroke });
    return this.gstates.get(key).name;
  }
  // A transparency group: its paths are painted opaque, overlapping harmlessly, and the group is then drawn as one (use
  // `/${name} Do`, after setting the opacity with `gs`). Without it, pieces that overlap would show as darker seams.
  group(parts, bbox) {
    const name = `Fm${this.forms.length}`;
    this.forms.push({ name, parts, bbox });
    return name;
  }
  // Pictures: `jpeg` (bytes of a JPEG file) or `rgb` (width*height*3 bytes) with an optional `alpha` (width*height bytes).
  image({ width, height, jpeg, rgb, alpha }) {
    const name = `Im${this.images.length}`;
    this.images.push({ name, width, height, jpeg, rgb, alpha });
    return name;
  }
  async build() {
    const objs = [];                      // index = object number - 1; each is an array of Uint8Array/strings
    const add = (...chunks) => { objs.push(chunks); return objs.length; };
    const stream = async (dict, data, compress = true) => {
      const body = compress ? await deflate(data) : data;
      return [`<< ${dict}${compress ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>\nstream\n`, body, '\nendstream'];
    };
    const catalog = add('');            // placeholders so the numbers are known
    const pages = add('');
    const page = add('');
    const content = add('');
    const font1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const font2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const xobjects = [];
    for (const im of this.images) {
      let smask = '';
      if (im.alpha) {
        const a = await stream(`/Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceGray /BitsPerComponent 8`, im.alpha);
        smask = ` /SMask ${add(...a)} 0 R`;
      }
      const common = `/Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${smask}`;
      const n = im.jpeg
        ? add(`<< ${common} /Filter /DCTDecode /Length ${im.jpeg.length} >>\nstream\n`, im.jpeg, '\nendstream')
        : add(...await stream(common, im.rgb));
      xobjects.push(`/${im.name} ${n} 0 R`);
    }
    for (const f of this.forms) {
      const n = add(...await stream(`/Type /XObject /Subtype /Form /BBox [${f.bbox.map(num).join(' ')}] /Group << /S /Transparency /CS /DeviceRGB >> /Resources << >>`, enc.encode(f.parts.join('\n'))));
      xobjects.push(`/${f.name} ${n} 0 R`);
    }
    const gs = [...this.gstates.values()].map((g) => `/${g.name} << /${g.stroke ? 'CA' : 'ca'} ${g.a} >>`).join(' ');
    objs[catalog - 1] = [`<< /Type /Catalog /Pages ${pages} 0 R >>`];
    objs[pages - 1] = [`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`];
    objs[page - 1] = [`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] /Contents ${content} 0 R ` +
      `/Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> /XObject << ${xobjects.join(' ')} >> /ExtGState << ${gs} >> >> >>`];
    objs[content - 1] = await stream('', enc.encode(this.parts.join('\n')));

    // Assemble: header, objects with their byte offsets, cross-reference table, trailer.
    const chunks = [enc.encode('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n')];
    let offset = chunks[0].length;
    const offsets = [];
    objs.forEach((parts, i) => {
      const head = enc.encode(`${i + 1} 0 obj\n`), tail = enc.encode('\nendobj\n');
      offsets.push(offset);
      const body = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p));
      for (const c of [head, ...body, tail]) { chunks.push(c); offset += c.length; }
    });
    const xref = ['xref', `0 ${objs.length + 1}`, '0000000000 65535 f '];
    for (const o of offsets) xref.push(`${String(o).padStart(10, '0')} 00000 n `);
    chunks.push(enc.encode(`${xref.join('\n')}\ntrailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
    return new Blob(chunks, { type: 'application/pdf' });
  }
}
