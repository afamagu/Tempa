/**
 * Tempa Places — First Edition.
 *
 * Repository metadata only: artwork remains on the administrator's device
 * until the authenticated bulk importer uploads it directly to the existing
 * postcard-artwork bucket. Filenames are exact and intentionally preserve
 * accents/case so selection can be validated before any upload begins.
 */
export type PostcardImportEntry = {
  key: string
  title: string
  countryCode: string
  location: string
  imageFilename: string
  motionFilename: string | null
  searchTerms: string[]
}

export const POSTCARD_IMPORT_COLLECTION = 'Tempa Places — First Edition'

export const POSTCARD_IMPORT_MANIFEST: readonly PostcardImportEntry[] = [
  {
    key: 'amsterdam-canal-ring',
    title: 'Amsterdam',
    countryCode: 'NL',
    location: 'Canal Ring, Netherlands',
    imageFilename: 'AmsterdamCanal Ring, Netherlands.png',
    motionFilename: 'Amsterdam.mp4',
    searchTerms: ['Holland', 'canals'],
  },
  {
    key: 'bangkok-2',
    title: 'Bangkok',
    countryCode: 'TH',
    location: 'Bangkok, Thailand',
    imageFilename: 'Bangkok Thailand image 2.png',
    motionFilename: 'Bangkok 2.mp4',
    searchTerms: ['Thailand'],
  },
  {
    key: 'buenos-aires-rio-de-la-plata',
    title: 'Buenos Aires',
    countryCode: 'AR',
    location: 'Río de la Plata, Argentina',
    imageFilename: 'Buenos Aires Río de la Plata, Argentina.png',
    motionFilename: 'Buenos Aires.mp4',
    searchTerms: ['Argentina'],
  },
  {
    key: 'cape-town-cape-of-good-hope',
    title: 'Cape Town',
    countryCode: 'ZA',
    location: 'Cape of Good Hope, South Africa',
    imageFilename: 'Cape TownCape of Good Hope, South Africa.png',
    motionFilename: 'capetown.mp4',
    searchTerms: ['South Africa'],
  },
  {
    key: 'cartagena-caribbean',
    title: 'Cartagena',
    countryCode: 'CO',
    location: 'Caribbean Colombia',
    imageFilename: 'CartagenaCaribbean Colombia.png',
    motionFilename: 'cartagena.mp4',
    searchTerms: ['Colombia', 'Caribbean'],
  },
  {
    key: 'dhaka-buriganga',
    title: 'Dhaka',
    countryCode: 'BD',
    location: 'Buriganga, Bangladesh',
    imageFilename: 'Dhaka Buriganga, Bangladesh.png',
    motionFilename: 'dhaka.mp4',
    searchTerms: ['Bangladesh', 'Buriganga River'],
  },
  {
    key: 'dubai',
    title: 'Dubai',
    countryCode: 'AE',
    location: 'United Arab Emirates',
    imageFilename: 'Dubai united arab emirates.png',
    motionFilename: 'Dubai, United Arab Emirates.mp4',
    searchTerms: ['UAE', 'Emirates'],
  },
  {
    key: 'george-town-penang',
    title: 'George Town',
    countryCode: 'MY',
    location: 'Penang, Malaysia',
    imageFilename: 'George TownPenang, Malaysia.png',
    motionFilename: 'George town.mp4',
    searchTerms: ['Malaysia', 'Penang'],
  },
  {
    key: 'heidelberg',
    title: 'Heidelberg',
    countryCode: 'DE',
    location: 'Germany',
    imageFilename: 'germany heidelberg.png',
    motionFilename: 'Heidelberg.mp4',
    searchTerms: ['Germany'],
  },
  {
    key: 'hoi-an',
    title: 'Hội An',
    countryCode: 'VN',
    location: 'Central Vietnam',
    imageFilename: 'Hội AnCentral Vietnam.png',
    motionFilename: 'Hoi An.mp4',
    searchTerms: ['Vietnam', 'Hoi An'],
  },
  {
    key: 'varanasi',
    title: 'Varanasi',
    countryCode: 'IN',
    location: 'India',
    imageFilename: 'India Yaranasi.png',
    motionFilename: 'Varanasi.mp4',
    searchTerms: ['India', 'Benares', 'Banaras', 'Ganges'],
  },
  {
    key: 'isfahan',
    title: 'Isfahan',
    countryCode: 'IR',
    location: 'Iran',
    imageFilename: 'isfahan still.png',
    motionFilename: 'isfahan.mp4',
    searchTerms: ['Iran', 'Esfahan'],
  },
  {
    key: 'istanbul-bosphorus',
    title: 'Istanbul',
    countryCode: 'TR',
    location: 'The Bosphorus, Türkiye',
    imageFilename: 'IstanbulThe Bosphorus, Türkiye.png',
    motionFilename: 'Istanbul.mp4',
    searchTerms: ['Turkey', 'Türkiye', 'Bosphorus'],
  },
  {
    key: 'jiufen',
    title: 'Jiufen',
    countryCode: 'TW',
    location: 'Northern Taiwan',
    imageFilename: 'Jiufen Northern Taiwan.png',
    motionFilename: 'Jiufen.mp4',
    searchTerms: ['Taiwan'],
  },
  {
    key: 'krakow',
    title: 'Kraków',
    countryCode: 'PL',
    location: 'Old Poland',
    imageFilename: 'Kraków Old Poland.png',
    motionFilename: 'Kraków.mp4',
    searchTerms: ['Poland', 'Krakow'],
  },
  {
    key: 'kyoto-old-capital',
    title: 'Kyoto',
    countryCode: 'JP',
    location: 'Old Capital, Japan',
    imageFilename: 'KyotoOld Capital, Japan.png',
    motionFilename: 'kyoto.mp4',
    searchTerms: ['Japan'],
  },
  {
    key: 'lagos',
    title: 'Lagos',
    countryCode: 'NG',
    location: 'Nigeria',
    imageFilename: 'lagos nigeria.png',
    motionFilename: 'Lagos. Nigeria.mp4',
    searchTerms: ['Nigeria'],
  },
  {
    key: 'lahore-badshahi-gardens',
    title: 'Lahore',
    countryCode: 'PK',
    location: 'Badshahi Gardens, Punjab, Pakistan',
    imageFilename: 'LahorePunjab, Pakistan.png',
    motionFilename: 'Lahoe 1.mp4',
    searchTerms: ['Pakistan', 'Punjab', 'Badshahi Mosque'],
  },
  {
    key: 'lahore-walled-city',
    title: 'Lahore',
    countryCode: 'PK',
    location: 'Walled City, Punjab, Pakistan',
    imageFilename: 'Lahore 2 Punjab, Pakistan.png',
    motionFilename: null,
    searchTerms: ['Pakistan', 'Punjab', 'Walled City'],
  },
  {
    key: 'lisbon-tagus-light',
    title: 'Lisbon',
    countryCode: 'PT',
    location: 'Tagus Light, Portugal',
    imageFilename: 'LisbonTagus Light, Portugal.png',
    motionFilename: 'Lisbon.mp4',
    searchTerms: ['Portugal', 'Tagus'],
  },
  {
    key: 'london-thames',
    title: 'London',
    countryCode: 'GB',
    location: 'The Thames, United Kingdom',
    imageFilename: 'LondonThe Thames, Britain.png',
    motionFilename: 'london.mp4',
    searchTerms: ['Britain', 'United Kingdom', 'England', 'UK'],
  },
  {
    key: 'new-york',
    title: 'New York',
    countryCode: 'US',
    location: 'New York, United States',
    imageFilename: 'usa newyork.png',
    motionFilename: 'new york.mp4',
    searchTerms: ['USA', 'United States', 'New York City'],
  },
  {
    key: 'oaxaca',
    title: 'Oaxaca',
    countryCode: 'MX',
    location: 'Southern Mexico',
    imageFilename: 'OaxacaSouthern Mexico.png',
    motionFilename: 'oaxaca.mp4',
    searchTerms: ['Mexico'],
  },
  {
    key: 'paris-montmartre',
    title: 'Paris',
    countryCode: 'FR',
    location: 'Montmartre, France',
    imageFilename: 'Paris, Montmartre, France.png',
    motionFilename: 'Paris.mp4',
    searchTerms: ['France', 'Montmartre'],
  },
  {
    key: 'quebec-city',
    title: 'Québec City',
    countryCode: 'CA',
    location: 'St Lawrence, Canada',
    imageFilename: 'Québec City St Lawrence, Canada.png',
    motionFilename: 'Quebec.mp4',
    searchTerms: ['Canada', 'Quebec', 'St Lawrence'],
  },
  {
    key: 'rio-de-janeiro',
    title: 'Rio de Janeiro',
    countryCode: 'BR',
    location: 'Brazil',
    imageFilename: 'rio brazil.png',
    motionFilename: 'Rio.mp4',
    searchTerms: ['Brazil', 'Rio'],
  },
  {
    key: 'seoul-old-city',
    title: 'Seoul',
    countryCode: 'KR',
    location: 'Old Seoul, South Korea',
    imageFilename: 'SeoulOld Seoul, Korea.png',
    motionFilename: 'seoul.mp4',
    searchTerms: ['South Korea', 'Korea'],
  },
  {
    key: 'seville-andalusia',
    title: 'Seville',
    countryCode: 'ES',
    location: 'Andalusia, Spain',
    imageFilename: 'SevilleAndalusia, Spain.png',
    motionFilename: 'seville.mp4',
    searchTerms: ['Spain', 'Andalusia', 'Sevilla'],
  },
  {
    key: 'singapore-island-city',
    title: 'Singapore',
    countryCode: 'SG',
    location: 'Island City, Singapore',
    imageFilename: 'SingaporeIsland City, Singapore.png',
    motionFilename: 'singapour.mp4',
    searchTerms: ['Singapore'],
  },
  {
    key: 'st-petersburg',
    title: 'St Petersburg',
    countryCode: 'RU',
    location: 'Russia',
    imageFilename: 'St Petersburg.png',
    motionFilename: 'St Petersburg.mp4',
    searchTerms: ['Russia', 'Saint Petersburg'],
  },
  {
    key: 'suzhou-jiangnan',
    title: 'Suzhou',
    countryCode: 'CN',
    location: 'Jiangnan, China',
    imageFilename: 'SuzhouJiangnan, China.png',
    motionFilename: 'suzhou.mp4',
    searchTerms: ['China', 'Jiangnan'],
  },
  {
    key: 'sydney-harbour',
    title: 'Sydney',
    countryCode: 'AU',
    location: 'Sydney Harbour, Australia',
    imageFilename: 'SydneyHarbour, Australia.png',
    motionFilename: 'sydney.mp4',
    searchTerms: ['Australia', 'Sydney Harbour'],
  },
  {
    key: 'venice-lagoon',
    title: 'Venice',
    countryCode: 'IT',
    location: 'The Lagoon, Italy',
    imageFilename: 'VeniceThe Lagoon, Italy.png',
    motionFilename: 'Venice.mp4',
    searchTerms: ['Italy', 'Venezia', 'Lagoon'],
  },
  {
    key: 'vigan-ilocos',
    title: 'Vigan',
    countryCode: 'PH',
    location: 'Ilocos, Philippines',
    imageFilename: 'Vigan Ilocos, Philippines.png',
    motionFilename: 'Vigan.mp4',
    searchTerms: ['Philippines', 'Ilocos'],
  },
  {
    key: 'yogyakarta-old-quarter',
    title: 'Yogyakarta',
    countryCode: 'ID',
    location: 'Old Quarter, Java, Indonesia',
    imageFilename: 'YogyakartaJava, Indonesia.png',
    motionFilename: 'Yogyakarta 2.mp4',
    searchTerms: ['Indonesia', 'Java', 'Jogja', 'Old Quarter'],
  },
  {
    key: 'yogyakarta-borobudur-sunrise',
    title: 'Yogyakarta',
    countryCode: 'ID',
    location: 'Borobudur at Sunrise, Java, Indonesia',
    imageFilename: 'Yogyakarta 2 Java, Indonesia.png',
    motionFilename: 'Yogyakarta 1.mp4',
    searchTerms: ['Indonesia', 'Java', 'Jogja', 'Borobudur', 'Merapi'],
  },
] as const

export const POSTCARD_IMPORT_IGNORED_FILES = ['Dhaka 2 Buriganga, Bangladesh.png'] as const

export type PostcardImportSelection = {
  ready: PostcardImportEntry[]
  skipped: PostcardImportEntry[]
  missing: string[]
  unrecognized: string[]
  ignored: string[]
}

/** Pure folder preflight. Existing catalogue keys are skipped, making a
 * stopped import safe to resume without demanding their local files again. */
export function inspectPostcardImportSelection(
  filenames: readonly string[],
  existingKeys: ReadonlySet<string>,
): PostcardImportSelection {
  const selected = new Set(filenames)
  const expected = new Set<string>()
  const ignoredNames = new Set<string>(POSTCARD_IMPORT_IGNORED_FILES)
  const ready: PostcardImportEntry[] = []
  const skipped: PostcardImportEntry[] = []
  const missing: string[] = []

  for (const entry of POSTCARD_IMPORT_MANIFEST) {
    expected.add(entry.imageFilename)
    if (entry.motionFilename) expected.add(entry.motionFilename)
    if (existingKeys.has(entry.key)) {
      skipped.push(entry)
      continue
    }
    const required = [entry.imageFilename, entry.motionFilename].filter((name): name is string => Boolean(name))
    const absent = required.filter((name) => !selected.has(name))
    if (absent.length > 0) missing.push(...absent)
    else ready.push(entry)
  }

  return {
    ready,
    skipped,
    missing: [...new Set(missing)].sort(),
    unrecognized: [...selected].filter((name) => !expected.has(name) && !ignoredNames.has(name)).sort(),
    ignored: [...selected].filter((name) => ignoredNames.has(name)).sort(),
  }
}

export function validatePostcardImportManifest(entries: readonly PostcardImportEntry[]) {
  const keys = new Set<string>()
  const images = new Set<string>()
  const motions = new Set<string>()
  const errors: string[] = []

  for (const entry of entries) {
    if (!/^[a-z0-9-]+$/.test(entry.key)) errors.push(`Invalid key: ${entry.key}`)
    if (keys.has(entry.key)) errors.push(`Duplicate key: ${entry.key}`)
    if (images.has(entry.imageFilename)) errors.push(`Duplicate image: ${entry.imageFilename}`)
    if (entry.motionFilename && motions.has(entry.motionFilename))
      errors.push(`Duplicate motion: ${entry.motionFilename}`)
    if (!/^[A-Z]{2}$/.test(entry.countryCode)) errors.push(`Invalid country code: ${entry.countryCode}`)
    keys.add(entry.key)
    images.add(entry.imageFilename)
    if (entry.motionFilename) motions.add(entry.motionFilename)
  }

  return { errors, keys, images, motions }
}
