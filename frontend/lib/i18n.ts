// Lightweight i18n for the app chrome. A flat key→string dictionary per locale,
// with English fallback for any missing key. The language switcher in the nav
// sets the locale (persisted); Arabic renders right-to-left.
//
// Coverage: navigation, brand tagline, hero, footer, and shared control labels
// (the always-visible chrome). Page bodies fall back to English where a string
// isn't translated yet — adding a key here is all that's needed to extend it.

export interface Lang {
  code: string;
  label: string; // endonym (its own name)
}

export const LANGS: Lang[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "se", label: "Sámegiella" },
  { code: "th", label: "ไทย" },
  { code: "hi", label: "हिन्दी" },
  { code: "zh", label: "中文" },
  { code: "de", label: "Deutsch" },
  { code: "sv", label: "Svenska" },
  { code: "nb", label: "Norsk" },
  { code: "da", label: "Dansk" },
  { code: "ar", label: "العربية" },
  { code: "lo", label: "ລາວ" },
  { code: "dz", label: "རྫོང་ཁ" },
  { code: "bo", label: "བོད་སྐད" },
  { code: "my", label: "မြန်မာ" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "tl", label: "Tagalog" },
];

export const RTL = new Set(["ar"]);
export const DEFAULT_LANG = "en";

export type Key =
  | "nav.find"
  | "nav.reflections"
  | "nav.documents"
  | "nav.board"
  | "nav.create"
  | "nav.me"
  | "nav.admin"
  | "brand.tagline"
  | "home.title"
  | "home.sub"
  | "footer.line"
  | "ctl.language"
  | "ctl.theme.toLight"
  | "ctl.theme.toDark";

type Dict = Partial<Record<Key, string>>;

// English is the source of truth + the fallback for every other locale.
const en: Record<Key, string> = {
  "nav.find": "Find a Circle",
  "nav.reflections": "Daily Reflections",
  "nav.documents": "Documents",
  "nav.board": "Board",
  "nav.create": "Create a Circle",
  "nav.me": "My Circle",
  "nav.admin": "Administration of my Circle",
  "brand.tagline": "Anonymous, owner-less fellowship on Solana.",
  "home.title": "Find a Circle Near You",
  "home.sub": "Ancestral Humanity Anonymous — anonymous, owner-less fellowship on Solana.",
  "footer.line": "AHA — Ancestral Humanity Anonymous · governed by group conscience, not by an owner.",
  "ctl.language": "Language",
  "ctl.theme.toLight": "Light",
  "ctl.theme.toDark": "Dark",
};

const fr: Dict = {
  "nav.find": "Trouver un Cercle",
  "nav.reflections": "Réflexions du jour",
  "nav.documents": "Documents",
  "nav.board": "Tableau",
  "nav.create": "Créer un Cercle",
  "nav.me": "Mon Cercle",
  "nav.admin": "Administration de mon Cercle",
  "brand.tagline": "Fraternité anonyme et sans propriétaire, sur Solana.",
  "home.title": "Trouvez un Cercle près de chez vous",
  "home.sub": "Ancestral Humanity Anonymous — une fraternité anonyme et sans propriétaire, sur Solana.",
  "footer.line": "AHA — Ancestral Humanity Anonymous · gouvernée par la conscience du groupe, sans propriétaire.",
  "ctl.language": "Langue",
  "ctl.theme.toLight": "Clair",
  "ctl.theme.toDark": "Sombre",
};

const es: Dict = {
  "nav.find": "Buscar un Círculo",
  "nav.reflections": "Reflexiones diarias",
  "nav.documents": "Documentos",
  "nav.board": "Tablón",
  "nav.create": "Crear un Círculo",
  "nav.me": "Mi Círculo",
  "nav.admin": "Administración de mi Círculo",
  "brand.tagline": "Hermandad anónima y sin dueño, en Solana.",
  "home.title": "Encuentra un Círculo cerca de ti",
  "home.sub": "Ancestral Humanity Anonymous — hermandad anónima y sin dueño, en Solana.",
  "footer.line": "AHA — Ancestral Humanity Anonymous · gobernada por la conciencia de grupo, no por un dueño.",
  "ctl.language": "Idioma",
  "ctl.theme.toLight": "Claro",
  "ctl.theme.toDark": "Oscuro",
};

const se: Dict = {
  "nav.find": "Gávdne biire",
  "nav.reflections": "Beaivválaš jurdagat",
  "nav.documents": "Dokumeanttat",
  "nav.board": "Diehtotávval",
  "nav.create": "Ráhkat biire",
  "nav.me": "Mu biire",
  "nav.admin": "Mu biire hálddašeapmi",
  "brand.tagline": "Anonyma, eaiggáthis searvi Solanas.",
  "home.title": "Gávnna biire lahka du",
  "home.sub": "Ancestral Humanity Anonymous — anonyma, eaiggáthis searvi Solanas.",
  "footer.line": "AHA — Ancestral Humanity Anonymous · stivrejuvvon joavkku oamedovddus.",
  "ctl.language": "Giella",
  "ctl.theme.toLight": "Čuovga",
  "ctl.theme.toDark": "Seavdnjat",
};

const th: Dict = {
  "nav.find": "ค้นหาวง",
  "nav.reflections": "บทใคร่ครวญประจำวัน",
  "nav.documents": "เอกสาร",
  "nav.board": "กระดาน",
  "nav.create": "สร้างวง",
  "nav.me": "วงของฉัน",
  "nav.admin": "การจัดการวงของฉัน",
  "brand.tagline": "กลุ่มภราดรภาพนิรนาม ไร้เจ้าของ บนโซลานา",
  "home.title": "ค้นหาวงใกล้คุณ",
  "home.sub": "Ancestral Humanity Anonymous — กลุ่มภราดรภาพนิรนาม ไร้เจ้าของ บนโซลานา",
  "footer.line": "AHA — Ancestral Humanity Anonymous · ปกครองโดยมโนธรรมของกลุ่ม ไม่ใช่เจ้าของ",
  "ctl.language": "ภาษา",
  "ctl.theme.toLight": "สว่าง",
  "ctl.theme.toDark": "มืด",
};

const hi: Dict = {
  "nav.find": "एक मंडली खोजें",
  "nav.reflections": "दैनिक चिंतन",
  "nav.documents": "दस्तावेज़",
  "nav.board": "बोर्ड",
  "nav.create": "मंडली बनाएँ",
  "nav.me": "मेरी मंडली",
  "nav.admin": "मेरी मंडली का प्रशासन",
  "brand.tagline": "सोलाना पर गुमनाम, स्वामी-रहित संगति।",
  "home.title": "अपने पास एक मंडली खोजें",
  "home.sub": "Ancestral Humanity Anonymous — सोलाना पर गुमनाम, स्वामी-रहित संगति।",
  "footer.line": "AHA — Ancestral Humanity Anonymous · समूह-विवेक द्वारा संचालित, किसी स्वामी द्वारा नहीं।",
  "ctl.language": "भाषा",
  "ctl.theme.toLight": "उजला",
  "ctl.theme.toDark": "गहरा",
};

const zh: Dict = {
  "nav.find": "寻找圈子",
  "nav.reflections": "每日省思",
  "nav.documents": "文件",
  "nav.board": "公告板",
  "nav.create": "创建圈子",
  "nav.me": "我的圈子",
  "nav.admin": "我的圈子管理",
  "brand.tagline": "匿名、无主的团契，构建于 Solana。",
  "home.title": "寻找你附近的圈子",
  "home.sub": "Ancestral Humanity Anonymous — 匿名、无主的团契，构建于 Solana。",
  "footer.line": "AHA — Ancestral Humanity Anonymous · 由群体良知治理，而非由所有者治理。",
  "ctl.language": "语言",
  "ctl.theme.toLight": "浅色",
  "ctl.theme.toDark": "深色",
};

const de: Dict = {
  "nav.find": "Einen Kreis finden",
  "nav.reflections": "Tägliche Besinnung",
  "nav.documents": "Dokumente",
  "nav.board": "Pinnwand",
  "nav.create": "Einen Kreis gründen",
  "nav.me": "Mein Kreis",
  "nav.admin": "Verwaltung meines Kreises",
  "brand.tagline": "Anonyme, herrenlose Gemeinschaft auf Solana.",
  "home.title": "Finde einen Kreis in deiner Nähe",
  "home.sub": "Ancestral Humanity Anonymous — anonyme, herrenlose Gemeinschaft auf Solana.",
  "footer.line": "AHA — Ancestral Humanity Anonymous · geleitet vom Gruppengewissen, nicht von einem Eigentümer.",
  "ctl.language": "Sprache",
  "ctl.theme.toLight": "Hell",
  "ctl.theme.toDark": "Dunkel",
};

const sv: Dict = {
  "nav.find": "Hitta en Krets",
  "nav.reflections": "Dagliga reflektioner",
  "nav.documents": "Dokument",
  "nav.board": "Anslagstavla",
  "nav.create": "Skapa en Krets",
  "nav.me": "Min Krets",
  "nav.admin": "Administration av min Krets",
  "brand.tagline": "Anonym, ägarlös gemenskap på Solana.",
  "home.title": "Hitta en Krets nära dig",
  "home.sub": "Ancestral Humanity Anonymous — anonym, ägarlös gemenskap på Solana.",
  "footer.line": "AHA — Ancestral Humanity Anonymous · styrd av gruppsamvete, inte av en ägare.",
  "ctl.language": "Språk",
  "ctl.theme.toLight": "Ljust",
  "ctl.theme.toDark": "Mörkt",
};

const nb: Dict = {
  "nav.find": "Finn en Sirkel",
  "nav.reflections": "Daglige refleksjoner",
  "nav.documents": "Dokumenter",
  "nav.board": "Oppslagstavle",
  "nav.create": "Opprett en Sirkel",
  "nav.me": "Min Sirkel",
  "nav.admin": "Administrasjon av min Sirkel",
  "brand.tagline": "Anonymt, eierløst fellesskap på Solana.",
  "home.title": "Finn en Sirkel nær deg",
  "home.sub": "Ancestral Humanity Anonymous — anonymt, eierløst fellesskap på Solana.",
  "footer.line": "AHA — Ancestral Humanity Anonymous · styrt av gruppesamvittighet, ikke av en eier.",
  "ctl.language": "Språk",
  "ctl.theme.toLight": "Lyst",
  "ctl.theme.toDark": "Mørkt",
};

const da: Dict = {
  "nav.find": "Find en Kreds",
  "nav.reflections": "Daglige refleksioner",
  "nav.documents": "Dokumenter",
  "nav.board": "Opslagstavle",
  "nav.create": "Opret en Kreds",
  "nav.me": "Min Kreds",
  "nav.admin": "Administration af min Kreds",
  "brand.tagline": "Anonymt, ejerløst fællesskab på Solana.",
  "home.title": "Find en Kreds nær dig",
  "home.sub": "Ancestral Humanity Anonymous — anonymt, ejerløst fællesskab på Solana.",
  "footer.line": "AHA — Ancestral Humanity Anonymous · styret af gruppesamvittighed, ikke af en ejer.",
  "ctl.language": "Sprog",
  "ctl.theme.toLight": "Lyst",
  "ctl.theme.toDark": "Mørkt",
};

const ar: Dict = {
  "nav.find": "ابحث عن حلقة",
  "nav.reflections": "تأملات يومية",
  "nav.documents": "المستندات",
  "nav.board": "اللوحة",
  "nav.create": "أنشئ حلقة",
  "nav.me": "حلقتي",
  "nav.admin": "إدارة حلقتي",
  "brand.tagline": "زمالة مجهولة بلا مالك، على سولانا.",
  "home.title": "ابحث عن حلقة بالقرب منك",
  "home.sub": "Ancestral Humanity Anonymous — زمالة مجهولة بلا مالك، على سولانا.",
  "footer.line": "AHA — Ancestral Humanity Anonymous · تُدار بضمير الجماعة، لا بمالك.",
  "ctl.language": "اللغة",
  "ctl.theme.toLight": "فاتح",
  "ctl.theme.toDark": "داكن",
};

const lo: Dict = {
  "nav.find": "ຊອກຫາວົງ",
  "nav.reflections": "ການໄຕ່ຕອງປະຈຳວັນ",
  "nav.documents": "ເອກະສານ",
  "nav.board": "ກະດານ",
  "nav.create": "ສ້າງວົງ",
  "nav.me": "ວົງຂອງຂ້ອຍ",
  "nav.admin": "ການຄຸ້ມຄອງວົງຂອງຂ້ອຍ",
  "brand.tagline": "ກຸ່ມສາມັກຄີນິລະນາມ ບໍ່ມີເຈົ້າຂອງ ເທິງ Solana.",
  "home.title": "ຊອກຫາວົງໃກ້ທ່ານ",
  "home.sub": "Ancestral Humanity Anonymous — ກຸ່ມສາມັກຄີນິລະນາມ ບໍ່ມີເຈົ້າຂອງ ເທິງ Solana.",
  "footer.line": "AHA — Ancestral Humanity Anonymous · ປົກຄອງໂດຍສະຕິຂອງກຸ່ມ ບໍ່ແມ່ນເຈົ້າຂອງ.",
  "ctl.language": "ພາສາ",
  "ctl.theme.toLight": "ແຈ້ງ",
  "ctl.theme.toDark": "ມືດ",
};

const dz: Dict = {
  "nav.find": "སྐོར་ལ་འཚོལ",
  "nav.reflections": "ཉིན་བསྟར་བསམ་གཞིགས",
  "nav.documents": "ཡིག་ཆ",
  "nav.board": "གསལ་བྱང",
  "nav.create": "སྐོར་གསར་བཟོ",
  "nav.me": "ངེའི་སྐོར",
  "nav.admin": "ངེའི་སྐོར་གྱི་འཛིན་སྐྱོང",
  "brand.tagline": "Solana གུ་མིང་མེད་ཅིང་བདག་པོ་མེད་པའི་མཐུན་ཚོགས།",
  "home.title": "ཁྱོད་ཀྱི་ཉེ་འཁྲིས་ཀྱི་སྐོར་འཚོལ",
  "home.sub": "Ancestral Humanity Anonymous — Solana གུ་མིང་མེད་ཅིང་བདག་པོ་མེད་པའི་མཐུན་ཚོགས།",
  "footer.line": "AHA — Ancestral Humanity Anonymous",
  "ctl.language": "སྐད་ཡིག",
  "ctl.theme.toLight": "དཀར་པོ",
  "ctl.theme.toDark": "ནག་པོ",
};

const bo: Dict = {
  "nav.find": "སྐོར་ལ་འཚོལ་བ",
  "nav.reflections": "ཉིན་རེའི་བསམ་གཞིགས",
  "nav.documents": "ཡིག་ཆ",
  "nav.board": "གསལ་བྱང",
  "nav.create": "སྐོར་གསར་པ་བཟོ་བ",
  "nav.me": "ངའི་སྐོར",
  "nav.admin": "ངའི་སྐོར་གྱི་དོ་དམ",
  "brand.tagline": "Solana ཐོག་མིང་མེད་དང་བདག་པོ་མེད་པའི་མཐུན་ཚོགས།",
  "home.title": "ཁྱེད་ཀྱི་ཉེ་འགྲམ་གྱི་སྐོར་འཚོལ",
  "home.sub": "Ancestral Humanity Anonymous — Solana ཐོག་མིང་མེད་དང་བདག་པོ་མེད་པའི་མཐུན་ཚོགས།",
  "footer.line": "AHA — Ancestral Humanity Anonymous",
  "ctl.language": "སྐད་ཡིག",
  "ctl.theme.toLight": "དཀར་པོ",
  "ctl.theme.toDark": "ནག་པོ",
};

const my: Dict = {
  "nav.find": "အသိုင်းအဝိုင်းရှာရန်",
  "nav.reflections": "နေ့စဉ်ဆင်ခြင်ချက်",
  "nav.documents": "စာရွက်စာတမ်းများ",
  "nav.board": "ဘုတ်",
  "nav.create": "အသိုင်းအဝိုင်းဖန်တီးရန်",
  "nav.me": "ကျွန်ုပ်၏အသိုင်းအဝိုင်း",
  "nav.admin": "ကျွန်ုပ်အသိုင်းအဝိုင်း စီမံခန့်ခွဲမှု",
  "brand.tagline": "Solana ပေါ်ရှိ အမည်ဝှက်၊ ပိုင်ရှင်မဲ့ မိတ်သဟာယ။",
  "home.title": "သင့်အနီးအနားရှိ အသိုင်းအဝိုင်းကိုရှာပါ",
  "home.sub": "Ancestral Humanity Anonymous — Solana ပေါ်ရှိ အမည်ဝှက်၊ ပိုင်ရှင်မဲ့ မိတ်သဟာယ။",
  "footer.line": "AHA — Ancestral Humanity Anonymous",
  "ctl.language": "ဘာသာစကား",
  "ctl.theme.toLight": "အလင်း",
  "ctl.theme.toDark": "အမှောင်",
};

const vi: Dict = {
  "nav.find": "Tìm một Vòng tròn",
  "nav.reflections": "Suy ngẫm hằng ngày",
  "nav.documents": "Tài liệu",
  "nav.board": "Bảng tin",
  "nav.create": "Tạo một Vòng tròn",
  "nav.me": "Vòng tròn của tôi",
  "nav.admin": "Quản trị Vòng tròn của tôi",
  "brand.tagline": "Cộng đồng ẩn danh, không chủ sở hữu, trên Solana.",
  "home.title": "Tìm một Vòng tròn gần bạn",
  "home.sub": "Ancestral Humanity Anonymous — cộng đồng ẩn danh, không chủ sở hữu, trên Solana.",
  "footer.line": "AHA — Ancestral Humanity Anonymous · được dẫn dắt bởi lương tâm tập thể, không phải bởi chủ sở hữu.",
  "ctl.language": "Ngôn ngữ",
  "ctl.theme.toLight": "Sáng",
  "ctl.theme.toDark": "Tối",
};

const tl: Dict = {
  "nav.find": "Maghanap ng Bilog",
  "nav.reflections": "Pang-araw-araw na Pagninilay",
  "nav.documents": "Mga Dokumento",
  "nav.board": "Pisara",
  "nav.create": "Gumawa ng Bilog",
  "nav.me": "Aking Bilog",
  "nav.admin": "Pangangasiwa ng aking Bilog",
  "brand.tagline": "Anonimo, walang-may-aring samahan, sa Solana.",
  "home.title": "Maghanap ng Bilog malapit sa iyo",
  "home.sub": "Ancestral Humanity Anonymous — anonimo, walang-may-aring samahan, sa Solana.",
  "footer.line": "AHA — Ancestral Humanity Anonymous · pinamumunuan ng budhi ng grupo, hindi ng may-ari.",
  "ctl.language": "Wika",
  "ctl.theme.toLight": "Maliwanag",
  "ctl.theme.toDark": "Madilim",
};

const DICT: Record<string, Dict> = {
  en, fr, es, se, th, hi, zh, de, sv, nb, da, ar, lo, dz, bo, my, vi, tl,
};

export function translate(lang: string, key: Key): string {
  return DICT[lang]?.[key] ?? en[key] ?? key;
}
