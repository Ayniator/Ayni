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

**Source:** supplied as raw SVG path data, described as coming from
[SVG Repo](https://www.svgrepo.com/).

**Licence: NOT VERIFIED — attribution given anyway.** SVG Repo does not use a
single licence; its collections are variously CC0, MIT and Creative Commons
Attribution, and only the last requires credit (see
[SVG Repo licensing](https://www.svgrepo.com/page/licensing/)). The asset
reached this repo as bare path data rather than a collection URL, so the
specific licence could not be identified. Attribution is recorded here
regardless, because crediting an asset that did not require it costs a line,
while omitting credit from a CC BY asset is a licence breach.

**To close this properly:** supply the SVG Repo page URL for the icon, and this
entry can name the collection, the author and the exact licence — or record that
none is required. Until then, treat the credit above as provisional.

The file is our own copy: 525 bytes, no script, no external reference, no
network request of any kind.
