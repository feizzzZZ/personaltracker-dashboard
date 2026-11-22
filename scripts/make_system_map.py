# Builds docs/system-map.html from scripts/system_map.tpl.html (the 96 bot ticks on the timeline are generated, not hand-typed)
#   python3 scripts/make_system_map.py
# Edit the diagrams here and the text sections in the template, then re-run — don't hand-edit docs/system-map.html.
import os
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'docs', 'system-map.html')

# ── 24-hour timeline ─────────────────────────────────────────
X0, X1 = 180, 970
PX = (X1 - X0) / 24
x = lambda h: round(X0 + h * PX, 1)
grid = ''.join(f'<line class="grid" x1="{x(h)}" y1="18" x2="{x(h)}" y2="226"/>' for h in range(0, 25, 3))
ticks = ''.join(f'<text class="tick" x="{x(h)}" y="246" text-anchor="middle">{h:02d}:00</text>' for h in range(0, 25, 3))
bot = ''.join(f'<line class="bot" x1="{round(X0 + i * (X1 - X0) / 96, 1)}" y1="145" x2="{round(X0 + i * (X1 - X0) / 96, 1)}" y2="157"/>' for i in range(96))
def ev(h, y, label, cls):
    return (f'<circle class="ev {cls}" cx="{x(h)}" cy="{y}" r="6.5"/>'
            f'<text class="el" x="{x(h) + 12}" y="{y + 4}">{label}</text>')
timeline = f'''<svg viewBox="0 0 1000 256" role="img" aria-label="Over 24 hours: market data runs at 06:30 and 18:30, the portfolio summary at 08:00, the price-anomaly check at 20:00, the paper bot every 15 minutes, and the app syncs whenever it is opened">
  {grid}
  <line class="axis" x1="{X0}" y1="226" x2="{X1}" y2="226"/>
  {ticks}
  <text class="lt" x="8" y="40">Market data</text><text class="ls" x="8" y="56">GitHub Actions</text>
  <line class="lane" x1="{X0}" y1="44" x2="{X1}" y2="44"/>
  {ev(6.5, 44, '<tspan class="b">06:30</tspan> prices · signals · paper bot', 'k-gh')}
  {ev(18.5, 44, '<tspan class="b">18:30</tspan> evening run', 'k-gh')}
  <text class="lt" x="8" y="96">Alerts</text><text class="ls" x="8" y="112">GitHub Actions</text>
  <line class="lane" x1="{X0}" y1="100" x2="{X1}" y2="100"/>
  {ev(8, 100, '<tspan class="b">08:00</tspan> daily portfolio summary', 'k-gh')}
  {ev(20, 100, '<tspan class="b">20:00</tspan> price anomalies', 'k-gh')}
  <text class="lt" x="8" y="148">Paper bot</text><text class="ls" x="8" y="164">Cloudflare Worker</text>
  <text class="el" x="{X0}" y="136">every 15 min · checks its rules and trades in the paper portfolio (no real money)</text>
  {bot}
  <text class="lt" x="8" y="198">Your app</text><text class="ls" x="8" y="214">any time</text>
  <rect class="band" x="{X0}" y="186" width="{X1 - X0}" height="20" rx="4"/>
  <text class="el" x="{X0 + 10}" y="200">open the app, or come back after 15 min → it syncs the latest sheet data by itself</text>
</svg>'''

# ── architecture diagram ───────────────────────────────────────
def node(cls, x0, y0, w, h, title, *subs, ty=None):
    cx = x0 + w / 2
    ty = ty if ty is not None else y0 + 26
    out = f'<g class="node {cls}"><rect x="{x0}" y="{y0}" width="{w}" height="{h}" rx="10"/>'
    out += f'<text class="t1" x="{cx}" y="{ty}" text-anchor="middle">{title}</text>'
    for i, (s, c) in enumerate(subs):
        out += f'<text class="{c}" x="{cx}" y="{ty + 20 + i * 18}" text-anchor="middle">{s}</text>'
    return out + '</g>'

def item(y, title, sub):
    return (f'<g class="item"><rect x="405" y="{y}" width="200" height="42" rx="7"/>'
            f'<text class="t4" x="417" y="{y + 18}">{title}</text>'
            f'<text class="t3" x="417" y="{y + 34}">{sub}</text></g>')

arch = f'''<svg viewBox="0 -36 1000 522" role="img" aria-label="The phone app reads and writes Google Sheets directly, gets its files and market data from GitHub Pages, which GitHub Actions updates twice a day from Yahoo, SEC, World Bank and BLS. GitHub Actions also reads the sheet read-only for alert summaries and deploys the Cloudflare Worker, which runs the paper bot and reads live balances from Binance and MetaMask">
  <defs>
    <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker>
  </defs>
  {node('k-google', 20, 140, 230, 132, 'Google Sheets', ('Your source of truth', 't2'), ('Transaction · Asset_Tracker', 't3'), ('Reconcile · Debts · Insurance · …', 't3'))}
  {node('k-google', 20, 300, 230, 64, 'Google Drive', ('Document files (read-only)', 't2'))}
  {node('k-google', 20, 398, 230, 64, 'Google Login', ('Read/write access to sheets', 't2'))}
  {node('k-gh', 385, 18, 240, 82, 'GitHub Pages', ('Serves the app + data/*.json', 't2'), ('…/personaltracker-dashboard/', 't3'))}
  <g class="node k-app app"><rect x="385" y="150" width="240" height="326" rx="12"/>
    <text class="t1" x="505" y="178" text-anchor="middle">Finance OS app</text>
    <text class="t2" x="505" y="198" text-anchor="middle">iPhone / browser (PWA)</text></g>
  {item(214, 'Pages · + button', 'index.html')}
  {item(264, 'Calculations', 'shared.js · balances · cost')}
  {item(314, 'Password lock', 'vault.js · encrypts on device')}
  {item(364, 'Live portfolio', 'liveport.js')}
  {item(414, 'Works offline', 'service-worker.js')}
  {node('k-mkt', 760, 16, 220, 56, 'Market data sources', ('Yahoo · SEC · World Bank · BLS', 't2'), ty=38)}
  {node('k-gh', 760, 110, 220, 130, 'GitHub Actions', ('Market data 06:30 · 18:30', 't2'), ('Alerts 08:00 · 20:00', 't2'), ('Weekly · monthly summaries', 't2'), ('Tests on PRs · Worker deploy', 't2'), ty=134)}
  {node('k-cf', 760, 270, 220, 98, 'Cloudflare Worker', ('Paper bot every 15 min', 't2'), ('Live balances (read-only)', 't2'), ty=296)}
  {node('k-mkt', 760, 408, 106, 62, 'Binance', ('Account · prices', 't2'), ty=432)}
  {node('k-mkt', 874, 408, 106, 62, 'MetaMask', ('via RPC', 't2'), ty=432)}

  <g class="edges">
    <polyline class="edge" points="135,138 135,-14 740,-14 740,124 756,124" marker-end="url(#ah)"/>
    <text class="el" x="437" y="-21" text-anchor="middle">read-only · service account · balances for the alert summaries</text>
    <line class="edge" x1="252" y1="200" x2="381" y2="200" marker-end="url(#ah)"/>
    <text class="el" x="316" y="192" text-anchor="middle">read · Sync</text>
    <line class="edge" x1="383" y1="228" x2="254" y2="228" marker-end="url(#ah)"/>
    <text class="el" x="318" y="246" text-anchor="middle">write · + forms</text>
    <line class="edge" x1="252" y1="332" x2="381" y2="332" marker-end="url(#ah)"/>
    <text class="el" x="316" y="324" text-anchor="middle">file list</text>
    <line class="edge" x1="252" y1="430" x2="381" y2="430" marker-end="url(#ah)"/>
    <text class="el" x="316" y="422" text-anchor="middle">token</text>
    <line class="edge" x1="505" y1="102" x2="505" y2="146" marker-end="url(#ah)"/>
    <text class="el" x="497" y="128" text-anchor="end">app files · data/*.json</text>
    <polyline class="edge" points="758,148 705,148 705,60 629,60" marker-end="url(#ah)"/>
    <text class="el" x="698" y="96" text-anchor="end">commit</text>
    <text class="el mono" x="698" y="110" text-anchor="end">data/*.json</text>
    <line class="edge" x1="870" y1="74" x2="870" y2="106" marker-end="url(#ah)"/>
    <text class="el" x="878" y="94">prices · macro</text>
    <polyline class="edge" points="758,200 690,200 690,250 629,250" marker-end="url(#ah)"/>
    <text class="el" x="684" y="224" text-anchor="end">alerts</text>
    <text class="el" x="684" y="238" text-anchor="end">Push</text>
    <line class="edge" x1="870" y1="242" x2="870" y2="266" marker-end="url(#ah)"/>
    <text class="el" x="878" y="259">deploy on merge</text>
    <line class="edge" x1="629" y1="318" x2="756" y2="318" marker-start="url(#ah)" marker-end="url(#ah)"/>
    <text class="el" x="692" y="310" text-anchor="middle">rules · balances</text>
    <text class="el mono" x="692" y="334" text-anchor="middle">Bearer token</text>
    <line class="edge" x1="812" y1="406" x2="812" y2="372" marker-end="url(#ah)"/>
    <text class="el" x="820" y="386">balances</text><text class="el" x="820" y="400">trades</text>
    <line class="edge" x1="927" y1="406" x2="927" y2="372" marker-end="url(#ah)"/>
    <text class="el" x="934" y="393">balances</text>
    <line class="edge" x1="758" y1="446" x2="629" y2="446" marker-end="url(#ah)"/>
    <text class="el" x="694" y="438" text-anchor="middle">live prices</text><text class="el mono" x="694" y="462" text-anchor="middle">WebSocket</text>
  </g>
</svg>'''

tpl = open(os.path.join(HERE, 'system_map.tpl.html'), encoding='utf-8').read()
open(OUT, 'w', encoding='utf-8').write(tpl.replace('%%ARCH%%', arch).replace('%%TIMELINE%%', timeline))
print(OUT, os.path.getsize(OUT))
