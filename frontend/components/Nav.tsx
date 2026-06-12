import Link from "next/link";

export default function Nav() {
  return (
    <header className="nav">
      <Link href="/" className="brand">
        <span className="dot" /> AHA · Ayni
      </Link>
      <nav>
        <Link href="/">Find a Circle</Link>
        <Link href="/reflections">Daily Reflections</Link>
        <Link href="/documents">Documents</Link>
      </nav>
    </header>
  );
}
