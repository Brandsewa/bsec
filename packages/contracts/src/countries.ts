/**
 * Every country a store can sell to (ISO 3166-1 alpha-2) with the currency it uses by default. Pure and dependency-free so the
 * admin market form, the storefront checkout and the domain validation read the same list. Names come from the runtime's
 * `Intl.DisplayNames`, so they follow the viewer's language without a second table to keep in sync.
 *
 * Territories without a currency of their own (e.g. Antarctica) are left out. XK (Kosovo) is not an ISO code but every payment
 * and shipping provider accepts it.
 */
const COUNTRY_CURRENCY =
  "AD:EUR,AE:AED,AF:AFN,AG:XCD,AI:XCD,AL:ALL,AM:AMD,AO:AOA,AR:ARS,AS:USD,AT:EUR,AU:AUD,AW:AWG,AX:EUR,AZ:AZN," +
  "BA:BAM,BB:BBD,BD:BDT,BE:EUR,BF:XOF,BG:BGN,BH:BHD,BI:BIF,BJ:XOF,BL:EUR,BM:BMD,BN:BND,BO:BOB,BQ:USD,BR:BRL,BS:BSD,BT:BTN,BV:NOK,BW:BWP,BY:BYN,BZ:BZD," +
  "CA:CAD,CC:AUD,CD:CDF,CF:XAF,CG:XAF,CH:CHF,CI:XOF,CK:NZD,CL:CLP,CM:XAF,CN:CNY,CO:COP,CR:CRC,CU:CUP,CV:CVE,CW:ANG,CX:AUD,CY:EUR,CZ:CZK," +
  "DE:EUR,DJ:DJF,DK:DKK,DM:XCD,DO:DOP,DZ:DZD,EC:USD,EE:EUR,EG:EGP,EH:MAD,ER:ERN,ES:EUR,ET:ETB,FI:EUR,FJ:FJD,FK:FKP,FM:USD,FO:DKK,FR:EUR," +
  "GA:XAF,GB:GBP,GD:XCD,GE:GEL,GF:EUR,GG:GBP,GH:GHS,GI:GIP,GL:DKK,GM:GMD,GN:GNF,GP:EUR,GQ:XAF,GR:EUR,GS:GBP,GT:GTQ,GU:USD,GW:XOF,GY:GYD," +
  "HK:HKD,HM:AUD,HN:HNL,HR:EUR,HT:HTG,HU:HUF,ID:IDR,IE:EUR,IL:ILS,IM:GBP,IN:INR,IO:USD,IQ:IQD,IR:IRR,IS:ISK,IT:EUR," +
  "JE:GBP,JM:JMD,JO:JOD,JP:JPY,KE:KES,KG:KGS,KH:KHR,KI:AUD,KM:KMF,KN:XCD,KP:KPW,KR:KRW,KW:KWD,KY:KYD,KZ:KZT," +
  "LA:LAK,LB:LBP,LC:XCD,LI:CHF,LK:LKR,LR:LRD,LS:LSL,LT:EUR,LU:EUR,LV:EUR,LY:LYD," +
  "MA:MAD,MC:EUR,MD:MDL,ME:EUR,MF:EUR,MG:MGA,MH:USD,MK:MKD,ML:XOF,MM:MMK,MN:MNT,MO:MOP,MP:USD,MQ:EUR,MR:MRU,MS:XCD,MT:EUR,MU:MUR,MV:MVR,MW:MWK,MX:MXN,MY:MYR,MZ:MZN," +
  "NA:NAD,NC:XPF,NE:XOF,NF:AUD,NG:NGN,NI:NIO,NL:EUR,NO:NOK,NP:NPR,NR:AUD,NU:NZD,NZ:NZD,OM:OMR," +
  "PA:PAB,PE:PEN,PF:XPF,PG:PGK,PH:PHP,PK:PKR,PL:PLN,PM:EUR,PN:NZD,PR:USD,PS:ILS,PT:EUR,PW:USD,PY:PYG,QA:QAR," +
  "RE:EUR,RO:RON,RS:RSD,RU:RUB,RW:RWF,SA:SAR,SB:SBD,SC:SCR,SD:SDG,SE:SEK,SG:SGD,SH:SHP,SI:EUR,SJ:NOK,SK:EUR,SL:SLE,SM:EUR,SN:XOF,SO:SOS,SR:SRD,SS:SSP,ST:STN,SV:USD,SX:ANG,SY:SYP,SZ:SZL," +
  "TC:USD,TD:XAF,TF:EUR,TG:XOF,TH:THB,TJ:TJS,TK:NZD,TL:USD,TM:TMT,TN:TND,TO:TOP,TR:TRY,TT:TTD,TV:AUD,TW:TWD,TZ:TZS," +
  "UA:UAH,UG:UGX,UM:USD,US:USD,UY:UYU,UZ:UZS,VA:EUR,VC:XCD,VE:VES,VG:USD,VI:USD,VN:VND,VU:VUV,WF:XPF,WS:WST,XK:EUR,YE:YER,YT:EUR,ZA:ZAR,ZM:ZMW,ZW:USD";

const CURRENCY_BY_COUNTRY: ReadonlyMap<string, string> = new Map(COUNTRY_CURRENCY.split(",").map((p) => p.split(":") as [string, string]));

/** All sellable country codes, alphabetical by code. */
export const COUNTRY_CODES: readonly string[] = [...CURRENCY_BY_COUNTRY.keys()];

export function isCountryCode(code: string): boolean {
  return CURRENCY_BY_COUNTRY.has(code.trim().toUpperCase());
}

/** The currency a country uses by default ("IN" -> "INR"), or undefined for an unknown code. */
export function defaultCurrencyForCountry(code: string): string | undefined {
  return CURRENCY_BY_COUNTRY.get(code.trim().toUpperCase());
}

/** The currency to suggest for a set of countries: the first country's (when they share one, that is the shared one). */
export function suggestCurrencyForCountries(codes: readonly string[]): string | undefined {
  return codes.map(defaultCurrencyForCountry).find((c): c is string => !!c);
}

/** Currencies in use by at least one country: the list a market can be priced in. */
export const COUNTRY_CURRENCIES: readonly string[] = [...new Set(CURRENCY_BY_COUNTRY.values())].sort();

const nameCache = new Map<string, Intl.DisplayNames | null>();
function displayNames(locale: string, type: "region" | "currency"): Intl.DisplayNames | null {
  const key = `${locale}|${type}`;
  if (!nameCache.has(key)) {
    try {
      nameCache.set(key, new Intl.DisplayNames([locale], { type }));
    } catch {
      nameCache.set(key, null);
    }
  }
  return nameCache.get(key) ?? null;
}

export function countryName(code: string, locale = "en"): string {
  const c = code.trim().toUpperCase();
  try {
    return displayNames(locale, "region")?.of(c) ?? c;
  } catch {
    return c;
  }
}

/** Every country as `{ code, name }`, sorted by name. */
export function listCountries(locale = "en"): Array<{ code: string; name: string }> {
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) => a.name.localeCompare(b.name, locale));
}
