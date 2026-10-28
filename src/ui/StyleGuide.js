import './styleguide.css';

const CONTRAST_ROWS = [
  ['Primary button', 'Parchment on emerald', '5.89:1'],
  ['Primary button pressed', 'Parchment on emerald', '5.89:1'],
  ['Secondary button', 'Teak on parchment', '17.09:1'],
  ['Danger button', 'Parchment on coral-700', '4.81:1'],
  ['Ghost button', 'Teak on parchment', '17.09:1'],
  ['Card', 'Teak on parchment', '17.09:1'],
  ['HUD pill', 'Parchment on emerald', '5.89:1'],
  ['Badge', 'Teak on brass gold', '8.68:1'],
  ['Toast', 'Parchment on teak', '17.09:1'],
  ['Loading title', 'Parchment on teak outline', '17.09:1'],
  ['Loading copy', 'Teak on parchment', '17.09:1'],
  ['Guide kicker', 'Dark emerald on parchment', '9.68:1'],
  ['Contrast PASS label', 'Dark emerald on parchment', '9.68:1'],
  ['Contrast table heading', 'Parchment on emerald', '5.89:1'],
  ['Title primary action', 'Parchment on emerald', '5.89:1'],
  ['Title multiplayer action', 'Teak on parchment', '17.09:1'],
  ['Title stats', 'Parchment on teak', '17.09:1'],
  ['Bottom icon row', 'Teak on parchment', '17.09:1'],
  ['How to play card', 'Teak on parchment', '17.09:1'],
  ['In-run HUD text', 'Teak on parchment', '17.09:1'],
  ['Game-over card', 'Teak on parchment', '17.09:1'],
  ['Party card', 'Teak on parchment', '17.09:1'],
  ['Multiplayer road standings', 'Parchment on teak', '17.09:1'],
  ['Chat message', 'Teak on parchment', '17.09:1'],
  ['Toast / edge indicator', 'Teak on brass gold', '8.68:1'],
];

const COLORS = [
  ['Mosque Dome Emerald', '--color-green-500', '#0D6E52'],
  ['Deep Emerald', '--color-green-700', '#084A39'],
  ['Brass Lamp Gold', '--color-gold-400', '#E5A93C'],
  ['Deep Brass', '--color-gold-600', '#A76F13'],
  ['Parchment secondary', '--color-sky-400', '#FDF8EE'],
  ['Malabar Teak', '--color-sky-600', '#1E140C'],
  ['Coral 500', '--color-coral-500', '#FF5D4A'],
  ['Coral 700', '--color-coral-700', '#C93A2B'],
  ['Warm Parchment', '--color-cloud', '#FDF8EE'],
  ['Deep Malabar Teak', '--color-ink', '#1E140C'],
  ['Parchment surface', '--color-white', '#FDF8EE'],
];

export function mountStyleGuide() {
  document.getElementById('game')?.setAttribute('hidden', '');
  document.getElementById('ui')?.setAttribute('hidden', '');
  document.body.classList.add('styleguide-mode');

  const page = document.createElement('main');
  page.className = 'styleguide-page';
  page.innerHTML = `
    <header class="styleguide-header">
      <div>
        <p class="styleguide-eyebrow">MUSLIYARKUTTI · MALABAR RUNNER</p>
        <h1>UI design system</h1>
        <p>Shared colour, type and component foundations used across the game screens.</p>
      </div>
      <a class="btn-ghost" href="/" aria-label="Return to the game">Back to game</a>
    </header>

    <section class="styleguide-section" aria-labelledby="palette-title">
      <h2 id="palette-title">Palette</h2>
      <div class="styleguide-swatches">${COLORS.map(([name, token, hex]) => `
        <div class="styleguide-swatch">
          <span class="styleguide-swatch-color" style="--swatch:var(${token})" aria-hidden="true"></span>
          <span>${name}</span><code>${hex}</code>
        </div>`).join('')}
      </div>
    </section>

    <section class="styleguide-section styleguide-grid" aria-label="Type and spacing">
      <article class="card styleguide-type">
        <h2>Fredoka · variable</h2>
        <p class="styleguide-font-sample">Friendly words for the Malabar road</p>
        <p class="styleguide-system-sample">മലയാളം · കോഴിക്കോട് &nbsp; | &nbsp; <span lang="ar" dir="rtl">حروف عربية · ا ل م</span></p>
        <small>Latin UI uses self-hosted Fredoka. Malayalam and Arabic fall through to system fonts; coin lettering keeps its existing Noto Sans Arabic canvas face.</small>
      </article>
      <article class="card">
        <h2>Spacing, corners &amp; motion</h2>
        <div class="styleguide-scale"><code>4</code><code>8</code><code>12</code><code>16</code><code>24</code><code>32 px</code></div>
        <div class="styleguide-radius"><span>12 px</span><span>16 px</span><span>999 px</span></div>
        <p>Motion: 120 / 200 / 320 ms · bouncy easing · reduced-motion support</p>
      </article>
    </section>

    <section class="styleguide-section" aria-labelledby="components-title">
      <h2 id="components-title">Shared components</h2>
      <div class="styleguide-components">
        <button class="btn-primary" type="button">Primary action</button>
        <button class="btn-secondary" type="button">Secondary</button>
        <button class="btn-danger" type="button">Danger</button>
        <button class="btn-ghost" type="button">Ghost</button>
        <span class="pill">COINS <strong>24</strong></span>
        <span class="badge">NEW GOAL</span>
      </div>
      <article class="card styleguide-card"><strong>Card</strong><span>White surface · 16 px radius · 3 px ink outline</span></article>
      <div class="toast" role="status">Toast · Arabic-letter coin collected</div>
    </section>

    <section class="styleguide-section" aria-labelledby="contrast-title">
      <h2 id="contrast-title">Text contrast · WCAG AA</h2>
      <p>Every text pair used by the shared components meets or exceeds 4.5:1. Dark palette tones are decorative button edges, not text surfaces.</p>
      <div class="styleguide-table-wrap">
        <table>
          <thead><tr><th scope="col">Component</th><th scope="col">Text / background</th><th scope="col">Contrast</th><th scope="col">Result</th></tr></thead>
          <tbody>${CONTRAST_ROWS.map(([component, pair, ratio]) => `
            <tr><th scope="row">${component}</th><td>${pair}</td><td>${ratio}</td><td class="styleguide-pass">PASS</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>
    <footer>Shared design tokens · /?styleguide=1</footer>
  `;
  document.body.appendChild(page);
}
