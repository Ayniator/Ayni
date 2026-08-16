# Third-party credits

Assets and code in this repository that originate elsewhere, and what their
licences require of us. Add an entry here whenever a third-party asset is
vendored — including ones whose licence needs no attribution, so that the next
person can tell "checked, none required" from "nobody looked".

---

## `frontend/public/img/you-are-here.svg` — map location marker

A bookmark-pin icon, used as the "You are here" marker on the Find your Circle
map. Vendored into `frontend/public/` and served from our own origin: the map
must never fetch an icon from a third-party host, because a request for a marker
asset carries the viewer's IP and a `Referer` naming the page.

**Author: Ancestral Humanity Anonymous (this project).** Confirmed by the user
on 2026-08-16: the pin is the fellowship's own asset, not a third-party icon, so
there is **no external attribution obligation** — no CC BY author to credit and
no upstream licence to honour. (An earlier draft of this entry hedged it as
possibly-SVG-Repo and gave a provisional credit; that hedge is retired — the
source is us.)

The file is our own copy: 525 bytes, no script, no external reference, no
network request of any kind.
