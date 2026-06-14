"use client";

// The "Ayni" half of the brand ("AHA powered by Ayni"). Kept OUTSIDE the home
// <Link> so its hover card can hold real links without nesting <a> in <a>.
// Hovering (or focusing) reveals a short, faithful gloss of the Quechua word
// plus the Wikipedia and project GitHub links.
export default function BrandAyni() {
  return (
    <span className="ayni-wrap" tabIndex={0} aria-label="About Ayni">
      <span className="ayni-name">Ayni</span>
      <span className="ayni-card" role="tooltip">
        <span className="ayni-desc">
          <b>Ayni</b> is a Quechua word for reciprocity — a system of mutual aid and
          reciprocal exchange among members of Andean communities.
        </span>
        <span className="ayni-links">
          <a href="https://en.wikipedia.org/wiki/Ayni" target="_blank" rel="noopener noreferrer">Wikipedia ↗</a>
          <a href="https://github.com/Ayniator/Ayni" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
        </span>
      </span>
    </span>
  );
}
