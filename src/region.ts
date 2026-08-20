export interface RegionRestrictions {
  exclusive_countries: string[]
  disallowed_countries: string[]
}

const ISO_COUNTRY_CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(
    ' '
  )

const normalizeCountryCode = (code: string): string => code.trim().toUpperCase()

export const normalizeCountryCodes = (codes?: readonly string[]): string[] =>
  Array.from(
    new Set((codes ?? []).map(normalizeCountryCode).filter((code) => /^[A-Z]{2}$/.test(code)))
  ).sort()

export const hasRegionRestrictions = (restrictions: RegionRestrictions): boolean =>
  restrictions.exclusive_countries.length > 0 || restrictions.disallowed_countries.length > 0

export const isRegionRedeemableIn = (
  restrictions: RegionRestrictions,
  countryCode: string
): boolean => {
  const country = normalizeCountryCode(countryCode)
  if (!/^[A-Z]{2}$/.test(country)) return false

  const exclusive = restrictions.exclusive_countries
  const disallowed = restrictions.disallowed_countries

  return (!exclusive.length || exclusive.includes(country)) && !disallowed.includes(country)
}

export const serializeRegionRestrictions = (restrictions: RegionRestrictions): string =>
  `${restrictions.exclusive_countries.join(',')}|${restrictions.disallowed_countries.join(',')}`

export const parseRegionRestrictions = (value: string): RegionRestrictions => {
  const [exclusive = '', disallowed = ''] = value.split('|', 2)

  return {
    exclusive_countries: exclusive ? exclusive.split(',') : [],
    disallowed_countries: disallowed ? disallowed.split(',') : [],
  }
}

export const getRegionCountryCodes = (restrictions: RegionRestrictions[]): string[] =>
  Array.from(
    new Set([
      ...ISO_COUNTRY_CODES,
      ...restrictions.flatMap(({ exclusive_countries, disallowed_countries }) => [
        ...exclusive_countries,
        ...disallowed_countries,
      ]),
    ])
  ).sort()
