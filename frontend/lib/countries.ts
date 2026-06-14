// ISO-3166-1 alpha-2 countries grouped by continent. Powers the foundation
// directory's continent → country grouping and the Country selector in the
// profile editor. Codes are uppercase alpha-2, matched against the on-chain
// CircleCountry.code. (Transcontinental states are placed pragmatically.)

export type Continent =
  | "Africa" | "Asia" | "Europe" | "North America" | "South America" | "Oceania" | "Antarctica";

export interface Country { code: string; name: string; continent: Continent }

export const CONTINENT_ORDER: Continent[] = [
  "Africa", "Asia", "Europe", "North America", "South America", "Oceania", "Antarctica",
];

const RAW: Record<Continent, string> = {
  "Africa":
    "DZ:Algeria, AO:Angola, BJ:Benin, BW:Botswana, BF:Burkina Faso, BI:Burundi, CV:Cabo Verde, CM:Cameroon, CF:Central African Republic, TD:Chad, KM:Comoros, CG:Congo, CD:DR Congo, CI:Côte d'Ivoire, DJ:Djibouti, EG:Egypt, GQ:Equatorial Guinea, ER:Eritrea, SZ:Eswatini, ET:Ethiopia, GA:Gabon, GM:Gambia, GH:Ghana, GN:Guinea, GW:Guinea-Bissau, KE:Kenya, LS:Lesotho, LR:Liberia, LY:Libya, MG:Madagascar, MW:Malawi, ML:Mali, MR:Mauritania, MU:Mauritius, MA:Morocco, MZ:Mozambique, NA:Namibia, NE:Niger, NG:Nigeria, RW:Rwanda, ST:São Tomé and Príncipe, SN:Senegal, SC:Seychelles, SL:Sierra Leone, SO:Somalia, ZA:South Africa, SS:South Sudan, SD:Sudan, TZ:Tanzania, TG:Togo, TN:Tunisia, UG:Uganda, EH:Western Sahara, ZM:Zambia, ZW:Zimbabwe",
  "Asia":
    "AF:Afghanistan, AM:Armenia, AZ:Azerbaijan, BH:Bahrain, BD:Bangladesh, BT:Bhutan, BN:Brunei, KH:Cambodia, CN:China, GE:Georgia, IN:India, ID:Indonesia, IR:Iran, IQ:Iraq, IL:Israel, JP:Japan, JO:Jordan, KZ:Kazakhstan, KW:Kuwait, KG:Kyrgyzstan, LA:Laos, LB:Lebanon, MY:Malaysia, MV:Maldives, MN:Mongolia, MM:Myanmar, NP:Nepal, KP:North Korea, OM:Oman, PK:Pakistan, PS:Palestine, PH:Philippines, QA:Qatar, SA:Saudi Arabia, SG:Singapore, KR:South Korea, LK:Sri Lanka, SY:Syria, TW:Taiwan, TJ:Tajikistan, TH:Thailand, TL:Timor-Leste, TR:Turkey, TM:Turkmenistan, AE:United Arab Emirates, UZ:Uzbekistan, VN:Vietnam, YE:Yemen",
  "Europe":
    "AL:Albania, AD:Andorra, AT:Austria, BY:Belarus, BE:Belgium, BA:Bosnia and Herzegovina, BG:Bulgaria, HR:Croatia, CY:Cyprus, CZ:Czechia, DK:Denmark, EE:Estonia, FI:Finland, FR:France, DE:Germany, GR:Greece, HU:Hungary, IS:Iceland, IE:Ireland, IT:Italy, XK:Kosovo, LV:Latvia, LI:Liechtenstein, LT:Lithuania, LU:Luxembourg, MT:Malta, MD:Moldova, MC:Monaco, ME:Montenegro, NL:Netherlands, MK:North Macedonia, NO:Norway, PL:Poland, PT:Portugal, RO:Romania, RU:Russia, SM:San Marino, RS:Serbia, SK:Slovakia, SI:Slovenia, ES:Spain, SE:Sweden, CH:Switzerland, UA:Ukraine, GB:United Kingdom, VA:Vatican City",
  "North America":
    "AG:Antigua and Barbuda, BS:Bahamas, BB:Barbados, BZ:Belize, CA:Canada, CR:Costa Rica, CU:Cuba, DM:Dominica, DO:Dominican Republic, SV:El Salvador, GD:Grenada, GT:Guatemala, HT:Haiti, HN:Honduras, JM:Jamaica, MX:Mexico, NI:Nicaragua, PA:Panama, KN:Saint Kitts and Nevis, LC:Saint Lucia, VC:Saint Vincent and the Grenadines, TT:Trinidad and Tobago, US:United States",
  "South America":
    "AR:Argentina, BO:Bolivia, BR:Brazil, CL:Chile, CO:Colombia, EC:Ecuador, GY:Guyana, PY:Paraguay, PE:Peru, SR:Suriname, UY:Uruguay, VE:Venezuela",
  "Oceania":
    "AU:Australia, FJ:Fiji, KI:Kiribati, MH:Marshall Islands, FM:Micronesia, NR:Nauru, NZ:New Zealand, PW:Palau, PG:Papua New Guinea, WS:Samoa, SB:Solomon Islands, TO:Tonga, TV:Tuvalu, VU:Vanuatu",
  "Antarctica": "AQ:Antarctica",
};

const byCode: Record<string, Country> = {};
const all: Country[] = [];
(Object.keys(RAW) as Continent[]).forEach((continent) => {
  for (const tok of RAW[continent].split(",")) {
    const t = tok.trim();
    if (!t) continue;
    const i = t.indexOf(":");
    const code = t.slice(0, i).trim().toUpperCase();
    const name = t.slice(i + 1).trim();
    const c: Country = { code, name, continent };
    byCode[code] = c;
    all.push(c);
  }
});
all.sort((a, b) => a.name.localeCompare(b.name));

/** Every country, sorted by name (for the selector). */
export const COUNTRIES: Country[] = all;

/** Look up a country by its alpha-2 code (case-insensitive). */
export const countryByCode = (code?: string | null): Country | null =>
  code ? byCode[code.toUpperCase()] ?? null : null;
