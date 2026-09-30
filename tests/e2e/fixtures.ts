// Pages the e2e tests load. Served by mock-jev.ts.

const BASE = `body { background: #ffffff; color: #202124; font: 16px sans-serif; margin: 0; padding: 24px; }`;

export const FIXTURE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Fixture</title><style>
  ${BASE}
  .card { background: #f1f3f4; border: 1px solid #dadce0; border-radius: 8px; padding: 16px; }
  .btn { background: #0b57d0; color: #ffffff; border: 0; border-radius: 16px; padding: 8px 16px; transition: background-color 0.3s; }
  .danger { background: #d93025; color: #ffffff; padding: 8px; }
  a { color: #1a0dab; }
</style></head><body>
  <h1 id="title">Fixture</h1>
  <div class="card" id="card"><p id="para">Hello <a id="link" href="#">link</a></p><button class="btn" id="btn">Go</button></div>
  <div id="inline" style="background-color: rgb(255, 255, 0) !important; padding: 8px">inline !important</div>
</body></html>`;

/** A fixed header bar painted the same color as the page: the page scrolls under it. */
export const FIXED = `<!doctype html>
<html><head><meta charset="utf-8"><title>Fixed</title><style>
  ${BASE}
  body { background: #282f36; color: #ffffff; padding-top: 72px; }
  #bar { position: fixed; top: 0; left: 0; right: 0; height: 72px; background: #282f36; }
  .tile { background: #f1f3f4; color: #202124; height: 400px; margin: 16px 0; }
</style></head><body>
  <nav id="bar"><a href="#">Buy now</a></nav>
  <div class="tile">scrolls under the bar</div><div class="tile">and this</div>
</body></html>`;

/** Web components: open, closed, nested, declarative, and late-upgraded shadow roots. */
export const SHADOW = `<!doctype html>
<html><head><meta charset="utf-8"><title>Shadow</title><style>${BASE}</style></head><body>
  <x-card id="open-card"><span id="slotted" style="color: #d93025">slotted red text</span></x-card>
  <div id="closed-host"></div>
  <div id="nest-host"></div>
  <div id="dsd"><template shadowrootmode="open"><style>.panel { background: #f1f3f4; border: 1px solid #dadce0; padding: 8px; }</style><div class="panel" id="panel">declarative</div></template></div>
  <x-late id="late"></x-late>
  <script>
    const css = '.panel { background: #f1f3f4; border: 1px solid #dadce0; padding: 8px; } .btn { background: #0b57d0; color: #fff; border: 0; padding: 6px 12px; }';
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    class Card extends HTMLElement {
      constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        root.adoptedStyleSheets = [sheet]; // like Lit: replaces the whole list right after attachShadow
        root.innerHTML = '<div class="panel" id="panel">card <button class="btn" id="btn">Go</button> <slot></slot></div>';
      }
      swapStyles() {
        const next = new CSSStyleSheet();
        next.replaceSync('.panel { background: #0b57d0; color: #fff; padding: 8px; }');
        this.shadowRoot.adoptedStyleSheets = [next];
      }
    }
    customElements.define('x-card', Card);
    window.__closedRoot = document.getElementById('closed-host').attachShadow({ mode: 'closed' });
    window.__closedRoot.innerHTML = '<style>' + css + '</style><div class="panel" id="panel">closed</div>';
    document.getElementById('nest-host').attachShadow({ mode: 'open' }).innerHTML = '<x-card id="inner-card"></x-card>';
    // Defined after the page is themed: the element upgrades (and attaches its shadow) in place.
    setTimeout(() => customElements.define('x-late', class extends Card {}), 600);
  </script>
</body></html>`;

/** A small spreadsheet-like app: repeated cells, a canvas grid, CSS-in-JS, and a cross-host frame. */
export const APP = (frameUrl: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>App</title><style>
  ${BASE}
  body { font-size: 13px; padding: 0; }
  .toolbar { background: #f3f2f1; border-bottom: 1px solid #e1dfdd; padding: 6px; }
  .grid { display: grid; grid-template-columns: repeat(12, 80px); }
  .cell { border-right: 1px solid #e1dfdd; border-bottom: 1px solid #e1dfdd; height: 20px; padding: 0 4px; }
  .head { background: #0b57d0; color: #ffffff; }
  .selected { background: #cfe3fc; }
</style></head><body>
  <div class="toolbar" id="toolbar">File Home Insert <span class="late-style" id="late-style">flagged</span></div>
  <a id="hc-probe" style="background-image: url(data:image/gif;base64,R0lGODlhAQABAAAAACw=); position: absolute; left: -9999px">probe</a>
  <div class="grid" id="grid"></div>
  <canvas id="canvas" width="400" height="160"></canvas>
  <iframe id="frame" src="${frameUrl}" width="400" height="120"></iframe>
  <script>
    const grid = document.getElementById('grid');
    for (let r = 0; r < 60; r++) {
      for (let c = 0; c < 12; c++) {
        const cell = document.createElement('div');
        cell.className = r === 0 ? 'cell head' : 'cell';
        cell.textContent = r === 0 ? 'Col ' + c : String(r * c);
        grid.append(cell);
      }
    }
    // Scrolling a virtualized grid: cells are reused with new content and state.
    window.recycle = () => {
      const cells = grid.children;
      for (let i = 12; i < cells.length; i++) {
        cells[i].textContent = String(i * 7);
        cells[i].classList.toggle('selected', i % 5 === 0);
      }
    };
    // The canvas draws after it is inserted, like a spreadsheet engine booting.
    setTimeout(() => {
      const ctx = document.getElementById('canvas').getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 400, 160);
      ctx.fillStyle = '#0b57d0'; ctx.fillRect(0, 0, 400, 24);
      ctx.fillStyle = '#000000'; ctx.font = '14px sans-serif';
      for (let i = 1; i < 7; i++) ctx.fillText('Row ' + i + '    1,234.00    5,678.00', 8, 24 + i * 20);
    }, 400);
    // CSS-in-JS: a rule for an element already on screen arrives later, through insertRule.
    setTimeout(() => {
      const style = document.createElement('style');
      document.head.append(style);
      style.sheet.insertRule('.late-style { background: #fce8e6; padding: 2px; }');
    }, 800);
  </script>
</body></html>`;

export const FRAME = `<!doctype html>
<html><head><meta charset="utf-8"><style>${BASE} .note { background: #f1f3f4; padding: 8px; }</style></head>
<body><div class="note" id="note">inside a frame from another host</div></body></html>`;
